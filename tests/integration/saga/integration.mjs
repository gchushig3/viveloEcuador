// Ejecutar despues de compilar shared-infrastructure y los tres servicios.
// Usa PostgreSQL Docker efimero, gRPC real y HTTP real. Broker/Identity/Catalog se simulan.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const services = {};
const currentContracts = await readFile(new URL('../../../packages/shared-infrastructure/dist/saga/contracts.js', import.meta.url));
for (const role of ['ms_cart', 'ms_payment', 'ms_inventory']) {
  const require = createRequire(new URL(`../../../services/${role}/package.json`, import.meta.url));
  const installedContracts = await readFile(require.resolve('@booking/infrastructure/dist/saga/contracts.js'));
  if (!installedContracts.equals(currentContracts))
    throw new Error(`${role}: infraestructura instalada obsoleta. Compile shared-infrastructure y actualice su dependencia local antes de probar.`);
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  services[role] = { require, infra: await load('@booking/infrastructure'),
    common: await load('@nestjs/common'), core: await load('@nestjs/core'),
    micro: await load('@nestjs/microservices'), config: await load('@nestjs/config') };
}
const { CartService } = await import('../../../services/ms_cart/dist/cart/cart.service.js');
const { CartController } = await import('../../../services/ms_cart/dist/cart/cart.controller.js');
const { InventoryClient } = await import('../../../services/ms_cart/dist/cart/inventory.client.js');
const { PaymentSagaService } = await import('../../../services/ms_payment/dist/saga/payment-saga.service.js');
const { PaymentSagaController } = await import('../../../services/ms_payment/dist/saga/payment-saga.controller.js');
const { InventoryService } = await import('../../../services/ms_inventory/dist/inventory.service.js');
const { InventorySagaService } = await import('../../../services/ms_inventory/dist/inventory-saga.service.js');
const { InventoryController } = await import('../../../services/ms_inventory/dist/inventory.controller.js');
const { firstValueFrom, of } = services.ms_inventory.require('rxjs');
const { Metadata, credentials } = services.ms_inventory.require('@grpc/grpc-js');
const { loadSync } = services.ms_inventory.require('@grpc/proto-loader');
const { loadPackageDefinition } = services.ms_inventory.require('@grpc/grpc-js');
const nativeFetch = globalThis.fetch;
const label = randomUUID();
const container = `booking-saga-test-${label}`;
const password = randomBytes(32).toString('hex');
const sources = {};
const apps = [];
let cart, payment, inventory, inventorySaga, grpcClient, cartClient, grpcAddress;
let ownsContainer = false;
let catalogSource, bookingReservations, bookingController, bookingInventory;
let bookingBase;
let identitySource, users, identityAdmin;
const bookingItemId = randomUUID();
const configFor = (role, extra = {}) => new services[role].config.ConfigService({
  NODE_ENV: 'test', SAGA_SIMULATION_ENABLED: 'true', PAYMENT_ALLOW_TEST_PAYLOADS: 'true',
  PAYMENT_SIMULATION_FAILURE_RATE: '0.35', RESERVATION_TTL_SECONDS: '10',
  INVENTORY_SERVICE_ID: 'NODE_ATR_TEST', INVENTORY_SYNC_API_KEY: 'test-sync-key-with-more-than-32-characters',
  INVENTORY_PROTO_PATH: fileURLToPath(new URL('../../../contracts/grpc/inventory.proto', import.meta.url)),
  INVENTORY_GRPC_URL: grpcAddress, CATALOG_BASE_URL: 'http://catalog.test/api/v2',
  IDENTITY_BASE_URL: 'http://identity.test/api/v2', BOOKING_API_KEY: 'test-booking-key-with-more-than-32-characters', ...extra,
});
function docker(args, env = process.env) { return execFileSync('docker', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

async function httpApp(role, controllers, providers) {
  const { common, core, infra, config } = services[role];
  class HarnessModule {}
  common.Module({ controllers, providers: [...providers, { provide: config.ConfigService, useValue: configFor(role) },
    { provide: core.APP_GUARD, useClass: infra.IdentityAccessGuard }] })(HarnessModule);
  const app = await core.NestFactory.create(HarnessModule, { logger: false });
  app.setGlobalPrefix('api/v2');
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  return { app, base: `http://127.0.0.1:${app.getHttpServer().address().port}/api/v2` };
}
let cartBase, paymentBase, inventoryBase;
before(async () => {
  docker(['run', '-d', '--rm', '--name', container, '--label', `booking.saga-test=${label}`,
    '--env', 'POSTGRES_PASSWORD', '-p', '127.0.0.1::5432', 'postgres:16-bookworm'], { ...process.env, POSTGRES_PASSWORD: password });
  ownsContainer = true;
  const port = Number(docker(['port', container, '5432/tcp']).match(/:(\d+)$/)[1]);
  const { Client } = services.ms_inventory.require('pg');
  let admin;
  for (let attempt = 0; attempt < 100; attempt++) {
    admin = new Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' });
    try { await admin.connect(); break; } catch { await admin.end().catch(() => {}); await delay(100); }
    if (attempt === 99) throw new Error('Temporary PostgreSQL did not start');
  }
  const sql = await readFile(new URL('../../../infrastructure/databases/02_microservicios_v2_bases_de_datos.sql', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../../../packages/shared-infrastructure/sql/saga-runtime.sql', import.meta.url), 'utf8');
  for (const role of Object.keys(services)) {
    await admin.query(`CREATE DATABASE ${role}`); // Nombres constantes de esta prueba.
    const { DataSource } = services[role].require('typeorm');
    sources[role] = await new DataSource({ type: 'postgres', host: '127.0.0.1', port, username: 'postgres',
      password, database: role, synchronize: false, extra: { max: 10 } }).initialize();
    const start = sql.indexOf(`\\connect ${role}`);
    const next = sql.indexOf('\\connect ', start + 1);
    const block = sql.slice(start, next < 0 ? undefined : next).replace(/^\\connect[^\r\n]+/m, '');
    await sources[role].query(block);
    await sources[role].query(runtime);
    await sources[role].query(await readFile(new URL(`../../../services/${role}/database/saga.sql`, import.meta.url), 'utf8'));
  }
  await admin.end();
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('http://catalog.test/')) {
      const id = String(url).split('/').pop();
      return new Response(JSON.stringify({ id: id === '11' ? bookingItemId : `attraction-${id}`, price: { currency: 'USD', adult: 20, child: 10 } }));
    }
    if (String(url).startsWith('http://identity.test/')) {
      assert.equal(options.headers['x-api-key'], 'test-booking-key-with-more-than-32-characters');
      const token = JSON.parse(options.body).access_token;
      if (token === 'invalid.payload.signature') return new Response('', { status: 401 });
      return new Response(JSON.stringify({ userId: '1', sessionId: randomUUID(), roles: token.startsWith('admin') ? ['ADMIN'] : ['CLIENTE'] }));
    }
    return nativeFetch(url, options);
  };
  const inventoryConfig = configFor('ms_inventory');
  const inventoryStore = new services.ms_inventory.infra.SagaStore(sources.ms_inventory, 'ms_inventory');
  inventory = new InventoryService(sources.ms_inventory, inventoryStore, inventoryConfig);
  inventorySaga = new InventorySagaService(sources.ms_inventory, inventoryStore, inventory);
  const stockServer = await httpApp('ms_inventory', [InventoryController], [
    { provide: InventoryService, useValue: inventory }, { provide: InventorySagaService, useValue: inventorySaga },
  ]);
  inventoryBase = stockServer.base;
  // Puerto gRPC del harness elegido por el SO mediante un listener provisional.
  const net = await import('node:net');
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const grpcPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  grpcAddress = `127.0.0.1:${grpcPort}`;
  stockServer.app.connectMicroservice(services.ms_inventory.infra.inventoryGrpcOptions(configFor('ms_inventory', {
    GRPC_HOST: '127.0.0.1', GRPC_PORT: grpcPort,
  }), true));
  await stockServer.app.startAllMicroservices();
  const pkg = loadPackageDefinition(loadSync(inventoryConfig.get('INVENTORY_PROTO_PATH'), { longs: String }));
  grpcClient = new pkg.inventory.InventoryStockService(grpcAddress, credentials.createInsecure());
  cartClient = new InventoryClient(configFor('ms_cart'));
  cart = new CartService(sources.ms_cart, new services.ms_cart.infra.SagaStore(sources.ms_cart, 'ms_cart'), cartClient, configFor('ms_cart'));
  payment = new PaymentSagaService(sources.ms_payment, new services.ms_payment.infra.SagaStore(sources.ms_payment, 'ms_payment'), configFor('ms_payment'));
  cartBase = (await httpApp('ms_cart', [CartController], [{ provide: CartService, useValue: cart }])).base;
  paymentBase = (await httpApp('ms_payment', [PaymentSagaController], [{ provide: PaymentSagaService, useValue: payment }])).base;
  const catalogRequire = createRequire(new URL('../../../services/ms-catalog/package.json', import.meta.url));
  const { DataSource } = catalogRequire('typeorm');
  await sources.ms_inventory.query('CREATE DATABASE booking_contract_test');
  catalogSource = await new DataSource({ type: 'postgres', host: '127.0.0.1', port,
    username: 'postgres', password, database: 'booking_contract_test', synchronize: false }).initialize();
  await catalogSource.query(`CREATE TABLE atraccion(atr_id bigint PRIMARY KEY,atr_uuid uuid NOT NULL,
    atr_nombre text NOT NULL,atr_estado text NOT NULL,atr_eliminado_en timestamptz)`);
  await catalogSource.query("INSERT INTO atraccion VALUES (11,$1,'Atraccion dos cupos','PUBLICADA',NULL)", [bookingItemId]);
  const { InventoryAdminService } = await import('../../../services/ms-catalog/dist/booking/inventory-admin.service.js');
  const { BookingReservationsService } = await import('../../../services/ms-catalog/dist/booking/booking-reservations.service.js');
  const { BookingContractController, BookingRootHealthController } = await import('../../../services/ms-catalog/dist/modules/attractions/booking-contract.controller.js');
  bookingInventory = new InventoryAdminService(configFor('ms_cart'));
  bookingReservations = new BookingReservationsService(catalogSource, bookingInventory);
  bookingController = new BookingContractController(catalogSource, {}, bookingReservations);
  await bookingController.onModuleInit();
  const { BookingCatalogService } = await import('../../../services/ms-catalog/dist/booking/booking-catalog.service.js');
  const { configureApplication } = await import('../../../services/ms-catalog/dist/configure-application.js');
  const { ConfigService: CatalogConfigService } = await import(pathToFileURL(catalogRequire.resolve('@nestjs/config')).href);
  class BookingHarness {}
  services.ms_cart.common.Module({ controllers: [BookingContractController, BookingRootHealthController], providers: [
    { provide: DataSource, useValue: catalogSource },
    { provide: BookingCatalogService, useValue: {} },
    { provide: BookingReservationsService, useValue: bookingReservations },
    { provide: CatalogConfigService, useValue: new CatalogConfigService() },
  ] })(BookingHarness);
  const catalogCore = await import(pathToFileURL(catalogRequire.resolve('@nestjs/core')).href);
  const bookingApp = await catalogCore.NestFactory.create(BookingHarness, { logger: ['error'], abortOnError: false });
  configureApplication(bookingApp);
  await bookingApp.listen(0, '127.0.0.1');
  apps.push(bookingApp);
  bookingBase = `http://127.0.0.1:${bookingApp.getHttpServer().address().port}/api/v3`;
  await sources.ms_inventory.query('CREATE DATABASE identity_admin_test');
  const { createIdentityDataSource } = await import('../../../services/ms_identity/dist/database/identity-domains.js');
  const { IDENTITY_ENTITIES } = await import('../../../services/ms_identity/dist/database/entities/index.js');
  identitySource = await createIdentityDataSource({ type: 'postgres', host: '127.0.0.1', port,
    username: 'postgres', password, database: 'identity_admin_test', synchronize: false, entities: IDENTITY_ENTITIES }).initialize();
  await identitySource.query(await readFile(new URL('../../../services/ms_identity/database/migrations/001-identity.sql', import.meta.url), 'utf8'));
  const [{ usu_id }] = await identitySource.query("INSERT INTO usuario(usu_correo,usu_password,usu_nombre,usu_apellido) VALUES ('admin@example.test','fixture','Admin','Prueba') RETURNING usu_id");
  await identitySource.query("INSERT INTO usuario_rol(usu_id,rol_id) SELECT $1,rol_id FROM rol WHERE rol_nombre='ADMIN'", [usu_id]);
  const sessionId = randomUUID();
  await identitySource.query("INSERT INTO sesion(ses_id,usu_id,ses_token_hash,ses_expira_en) VALUES ($1,$2,$3,now()+interval '1 hour')", [sessionId, usu_id, 'a'.repeat(64)]);
  identityAdmin = { userId: usu_id, sessionId, roles: ['ADMIN'] };
  const { UsersService } = await import('../../../services/ms_identity/dist/users/users.service.js');
  users = new UsersService(identitySource);
}, { timeout: 60000 });

after(async () => {
  globalThis.fetch = nativeFetch;
  grpcClient?.close();
  cartClient?.onApplicationShutdown();
  bookingInventory?.onApplicationShutdown();
  if (catalogSource?.isInitialized) await catalogSource.destroy();
  if (identitySource?.isInitialized) await identitySource.destroy();
  for (const app of apps.reverse()) await app.close();
  for (const source of Object.values(sources)) if (source.isInitialized) await source.destroy();
  if (ownsContainer && docker(['inspect', '--format', '{{index .Config.Labels "booking.saga-test"}}', container]) === label) docker(['rm', '--force', container]);
});

test('administradores: alta atomica, clave cifrada, duplicados y sesion revocada', async () => {
  const dto = { first_name: 'Nueva', last_name: 'Administradora', email: 'nueva@example.test', password: randomBytes(24).toString('base64url') };
  const account = await users.createAdministrator(identityAdmin, dto);
  assert.deepEqual(account.roles, ['ADMIN']);
  assert.equal(account.active, true);
  assert.equal('password' in account, false);
  const [{ usu_password }] = await identitySource.query('SELECT usu_password FROM usuario WHERE usu_id=$1', [account.id]);
  const identityRequire = createRequire(new URL('../../../services/ms_identity/package.json', import.meta.url));
  assert.equal(await identityRequire('bcrypt').compare(dto.password, usu_password), true);
  const [assignment] = await identitySource.query('SELECT usr_asignado_por FROM usuario_rol WHERE usu_id=$1', [account.id]);
  assert.equal(assignment.usr_asignado_por, identityAdmin.userId);
  await assert.rejects(users.createAdministrator(identityAdmin, dto), /already exists/);
  const concurrent = { ...dto, email: 'concurrent-admin@example.test' };
  const results = await Promise.allSettled([users.createAdministrator(identityAdmin, concurrent), users.createAdministrator(identityAdmin, concurrent)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await identitySource.query('UPDATE sesion SET ses_revocada=true WHERE ses_id=$1', [identityAdmin.sessionId]);
  await assert.rejects(users.createAdministrator(identityAdmin, { ...dto, email: 'revoked@example.test' }), /Invalid or expired/);
  const [{ count }] = await identitySource.query("SELECT count(*) FROM usuario WHERE usu_correo='revoked@example.test'");
  assert.equal(count, '0');
});

test('certificacion: 20 cupos y 2 adicionales devuelven 409 OUT_OF_STOCK', async () => {
  const date = '2099-11-04';
  await bookingInventory.register({ attractionId: '11', itemId: bookingItemId, dates: [date], timeSlots: ['15:00'], capacity: 20 });
  const input = { atraccion_id: bookingItemId, fecha: date, hora: '15:00', personas: 20,
    cliente_nombre: 'Certificacion', cliente_email: 'certificacion@example.test' };
  const post = body => nativeFetch(`${bookingBase}/atracciones/reservas`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify(body) });
  const first = await post(input);
  assert.equal(first.status, 201);
  const reservation = await first.json();
  const extra = await post({ ...input, personas: 2 });
  assert.equal(extra.status, 409);
  const problem = await extra.json();
  assert.equal(problem.code, 'OUT_OF_STOCK');
  assert.equal(problem.type, 'https://booking.epn.edu.ec/errors/sin-cupos');
  assert.equal((await bookingInventory.list(bookingItemId, date, date))[0].reserved, 20);
  await bookingController.cancelReservation(reservation.reserva_id);
  assert.equal((await bookingInventory.list(bookingItemId, date, date))[0].available, 20);
  const promotion = await nativeFetch(`${bookingBase}/atracciones/promociones/contrato`);
  assert.equal(promotion.status, 200);
  assert.deepEqual(await promotion.json(), {
    proveedor_codigo: 'NODE_ATR_GLORIA', nombre_socio: 'Vívelo Ecuador', vertical: 'ATRACCIONES',
    permite_promociones: true, porcentaje_descuento: 15,
    condiciones_combo: 'Aplica para reservas combinadas auto + atracción con Booking Central',
  });
});

test('mañana: Booking toma los dos cupos, rechaza otra compra local y libera solo una vez', async () => {
  const day = new Date(); day.setDate(day.getDate() + 1);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
  await bookingInventory.register({ attractionId: '11', itemId: bookingItemId, dates: [date], timeSlots: ['10:30'], capacity: 2 });
  const input = { atraccion_id: bookingItemId, fecha: date, hora: '10:30', personas: 2,
    cliente_nombre: 'Cliente de prueba', cliente_email: 'cupos@example.test' };
  const key = randomUUID();
  const health = await nativeFetch(`${bookingBase}/health`);
  assert.equal(health.status, 200);
  const response = await nativeFetch(`${bookingBase}/atracciones/reservas`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) });
  assert.equal(response.status, 201);
  const first = await response.json();
  const replay = await bookingController.createReservation(input, key);
  assert.equal(first.reserva_id, replay.reserva_id);
  assert.equal((await bookingInventory.list(bookingItemId, date, date))[0].available, 0);
  await assert.rejects(bookingController.createReservation({ ...input, personas: 1 }, randomUUID()), error => error.getStatus() === 409 && error.getResponse().code === 'OUT_OF_STOCK');
  await assert.rejects(cart.add('11', randomUUID(), { ...line(11), date, slotId: `slot-${date.replaceAll('-', '')}-1030` }), /Insufficient stock/);
  await assert.rejects(bookingController.createReservation({ ...input, personas: 1 }, key), /reutilizada/);
  await bookingController.cancelReservation(first.reserva_id);
  await bookingController.cancelReservation(first.reserva_id);
  assert.equal((await bookingInventory.list(bookingItemId, date, date))[0].available, 2);
  // La compra local usa exactamente los cupos liberados por Booking.
  await cart.add('11', randomUUID(), { ...line(11), date, slotId: `slot-${date.replaceAll('-', '')}-1030` });
  const local = await cart.checkout('11', randomUUID(), { testMode: 'test_success' });
  await pump();
  assert.equal((await cart.reservation('11', local.reservationId)).state, 'CONFIRMED');
  await assert.rejects(bookingController.createReservation(input, randomUUID()), error => error.getStatus() === 409 && error.getResponse().code === 'OUT_OF_STOCK');
  assert.equal((await bookingInventory.list(bookingItemId, date, date))[0].reserved, 2);
});

test('Booking concurrente no sobrevende y una cancelacion adelantada no resucita', async () => {
  const date = '2099-06-01';
  await bookingInventory.register({ attractionId: '11', itemId: bookingItemId, dates: [date], timeSlots: ['11:00'], capacity: 2 });
  const input = { atraccion_id: bookingItemId, fecha: date, hora: '11:00', personas: 2,
    cliente_nombre: 'Concurrencia', cliente_email: 'concurrente@example.test' };
  const results = await Promise.allSettled([bookingController.createReservation(input, randomUUID()), bookingController.createReservation(input, randomUUID())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await bookingInventory.list(bookingItemId, date, date))[0].reserved, 2);
  const id = randomUUID();
  await bookingInventory.releaseBooking(id);
  await assert.rejects(bookingInventory.reserveBooking({ reservationId: id, itemId: bookingItemId, date, timeSlot: '11:00', quantity: 1 }), /already released/);
});

test('Booking recupera respuestas perdidas de reserva y cancelacion sin duplicar ni resucitar cupos', async () => {
  const date = '2099-06-02';
  await bookingInventory.register({ attractionId: '11', itemId: bookingItemId, dates: [date], timeSlots: ['11:00'], capacity: 2 });
  const input = { atraccion_id: bookingItemId, fecha: date, hora: '11:00', personas: 2,
    cliente_nombre: 'Respuesta perdida', cliente_email: 'retry@example.test' };
  const key = randomUUID();
  const reserve = bookingInventory.reserveBooking.bind(bookingInventory);
  bookingInventory.reserveBooking = async body => { await reserve(body); throw new Error('Respuesta perdida'); };
  try { await assert.rejects(bookingController.createReservation(input, key), /Respuesta perdida/); }
  finally { bookingInventory.reserveBooking = reserve; }
  const first = await bookingController.createReservation(input, key);
  assert.equal((await bookingInventory.list(bookingItemId, date, date))[0].reserved, 2);
  const release = bookingInventory.releaseBooking.bind(bookingInventory);
  bookingInventory.releaseBooking = async id => { await release(id); throw new Error('Respuesta perdida'); };
  try { await assert.rejects(bookingController.cancelReservation(first.reserva_id), /Respuesta perdida/); }
  finally { bookingInventory.releaseBooking = release; }
  await assert.rejects(bookingController.createReservation(input, key), /cancelacion en proceso/);
  await bookingController.cancelReservation(first.reserva_id);
  assert.equal((await bookingInventory.list(bookingItemId, date, date))[0].available, 2);
});

test('HTTP: solo ADMIN puede consultar las reservas de todos los clientes', async () => {
  const url = `${cartBase}/cart/admin/reservations`;
  assert.equal((await nativeFetch(url)).status, 401);
  assert.equal((await nativeFetch(url, { headers: { authorization: 'Bearer client.payload.signature' } })).status, 403);
  const response = await nativeFetch(url, { headers: { authorization: 'Bearer admin.payload.signature' } });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(await response.json()));
});

async function pump() {
  for (let pass = 0; pass < 30; pass++) {
    let count = 0;
    for (const [role, source] of Object.entries(sources)) {
      const events = await source.query('SELECT event_id,payload FROM saga_outbox WHERE published_at IS NULL ORDER BY created_at,event_id');
      for (const row of events) {
        const event = services[role].infra.validateSagaEvent(row.payload);
        for (const [consumer, handler] of [['ms_cart', cart], ['ms_payment', payment], ['ms_inventory', inventorySaga]]) {
          if (services[role].infra.sagaBindings[consumer].includes(event.tipo)) {
            await handler.event(event);
            await handler.event(event); // Redelivery despues de commit, antes de ack.
          }
        }
        await source.query('UPDATE saga_outbox SET published_at=now() WHERE event_id=$1', [row.event_id]);
        count++;
      }
    }
    if (!count) return;
  }
  throw new Error('Saga event loop did not settle');
}
const slot = (id) => ({ attractionId: String(id), itemId: `attraction-${id}`, date: '2099-01-01', timeSlot: '10:30:00', capacity: 10 });
const line = (id, adults = 2) => ({ attractionId: String(id), date: '2099-01-01', timeSlot: '10:30:00', slotId: 'slot-20990101-1030', adults, children: 0 });
async function create(user, id, mode) {
  await cart.add(user, randomUUID(), line(id));
  return cart.checkout(user, randomUUID(), { ...(mode ? { testMode: mode } : {}) });
}
async function rpc(method, value, metadata = new Metadata()) {
  return new Promise((resolve, reject) => grpcClient[method](value, metadata, { deadline: Date.now() + 5000 }, (error, result) => error ? reject(error) : resolve(result)));
}

test('gRPC exacto: registro ADMIN, disponibilidad, snapshots monotonicos y streaming deduplicado', async () => {
  const key = randomUUID();
  const registered = await fetch(`${inventoryBase}/inventory/slots`, { method: 'POST', headers: {
    authorization: 'Bearer admin.payload.signature', 'content-type': 'application/json', 'idempotency-key': key,
  }, body: JSON.stringify(slot(1)) });
  assert.equal(registered.status, 201);
  const body = await registered.json();
  const request = { serviceId: body.serviceId, itemId: body.itemId, date: body.date, timeSlot: body.timeSlot, slotId: body.slotId };
  assert.equal((await rpc('getSlotAvailability', request)).availableUnits, 10);
  await assert.rejects(rpc('pushStockUpdate', { ...request, availableUnits: 8, timestamp: '100' }), (error) => error.code === 16);
  const metadata = new Metadata(); metadata.set('x-api-key', 'test-sync-key-with-more-than-32-characters');
  assert.equal((await rpc('pushStockUpdate', { ...request, availableUnits: 8, timestamp: '100' }, metadata)).currentAvailable, 8);
  assert.equal((await rpc('pushStockUpdate', { ...request, availableUnits: 20, timestamp: '99' }, metadata)).errorCode, 'STALE_TIMESTAMP_IGNORED');
  const change = { ...request, eventId: randomUUID(), delta: -2, timestamp: '101' };
  const summary = new Promise((resolve, reject) => {
    const call = grpcClient.streamInventoryChanges(metadata, { deadline: Date.now() + 5000 }, (error, result) => error ? reject(error) : resolve(result));
    call.write(change); call.write(change); call.end();
  });
  assert.equal((await summary).totalEventsProcessed, 1);
  assert.equal((await rpc('getSlotAvailability', request)).availableUnits, 6);
  await rpc('pushStockUpdate', { ...request, availableUnits: 0, timestamp: '102' }, metadata);
  assert.equal((await rpc('getSlotAvailability', request)).availableUnits, 0);
  const zeroDelta = { ...request, eventId: randomUUID(), delta: 1, timestamp: '103' };
  await inventory.delta(zeroDelta);
  assert.equal((await rpc('getSlotAvailability', request)).availableUnits, 1);
});

test('camino feliz: checkout idempotente, pago unico, carrito confirmado y aforo descontado una vez', async () => {
  await inventory.register('1', randomUUID(), slot(2));
  const addKey = randomUUID();
  const [a, b] = await Promise.all([cart.add('2', addKey, line(2)), cart.add('2', addKey, line(2))]);
  assert.deepEqual(a, b);
  await assert.rejects(cart.add('2', addKey, line(2, 3)), (error) => error.getStatus() === 409);
  const checkoutKey = randomUUID();
  const [first, retry] = await Promise.all([cart.checkout('2', checkoutKey, { testMode: 'test_success' }), cart.checkout('2', checkoutKey, { testMode: 'test_success' })]);
  assert.equal(first.reservationId, retry.reservationId);
  await pump();
  assert.equal((await cart.reservation('2', first.reservationId)).state, 'CONFIRMED');
  assert.equal((await payment.get('2', first.reservationId, [])).state, 'APPROVED');
  const [{ dis_cupo_reservado }] = await sources.ms_inventory.query('SELECT d.dis_cupo_reservado FROM disponibilidad d JOIN saga_inventory_slot s USING(dis_id) WHERE s.item_id=$1', ['attraction-2']);
  assert.equal(dis_cupo_reservado, 2);
});

test('pago fallido cancela y libera una sola vez incluso con entregas duplicadas', async () => {
  await inventory.register('1', randomUUID(), slot(3));
  const reservation = await create('3', 3, 'test_fail');
  await pump();
  assert.equal((await cart.reservation('3', reservation.reservationId)).state, 'CANCELLED');
  assert.equal((await payment.get('3', reservation.reservationId, [])).state, 'FAILED');
  const [{ dis_cupo_reservado }] = await sources.ms_inventory.query('SELECT d.dis_cupo_reservado FROM disponibilidad d JOIN saga_inventory_slot s USING(dis_id) WHERE s.item_id=$1', ['attraction-3']);
  assert.equal(dis_cupo_reservado, 0);
  const [{ count }] = await sources.ms_inventory.query("SELECT count(*) FROM saga_outbox WHERE payload->>'tipo'='inventario_liberado' AND payload->>'correlationId'=$1", [reservation.reservationId]);
  assert.equal(count, '1');
});

test('cancelacion pagada: reembolso idempotente cancela el carrito y devuelve el aforo', async () => {
  await inventory.register('1', randomUUID(), slot(12));
  const reservation = await create('12', 12, 'test_success');
  await pump();
  assert.equal((await cart.reservation('12', reservation.reservationId)).state, 'CONFIRMED');
  const refund = { eventoId: randomUUID(), correlationId: reservation.reservationId,
    data: { rem_numero: 'RF-PRUEBA', rem_monto: 40 } };
  await payment.refundRequested(refund);
  await payment.refundRequested(refund);
  await pump();
  assert.equal((await cart.reservation('12', reservation.reservationId)).state, 'CANCELLED');
  assert.equal((await payment.get('12', reservation.reservationId, [])).state, 'REFUNDED');
  const [{ dis_cupo_reservado }] = await sources.ms_inventory.query('SELECT d.dis_cupo_reservado FROM disponibilidad d JOIN saga_inventory_slot s USING(dis_id) WHERE s.item_id=$1', ['attraction-12']);
  assert.equal(dis_cupo_reservado, 0);
});

test('concurrencia: solo una reserva puede retener el ultimo aforo', async () => {
  await inventory.register('1', randomUUID(), { ...slot(4), capacity: 2 });
  const reservations = await Promise.all([create('41', 4, 'test_success'), create('42', 4, 'test_success')]);
  const created = await sources.ms_cart.query("SELECT payload FROM saga_outbox WHERE payload->>'tipo'='reserva.creada' AND payload->>'correlationId'=ANY($1::text[])", [reservations.map((r) => r.reservationId)]);
  await Promise.all(created.map((row) => inventorySaga.event(row.payload)));
  await pump();
  const states = await Promise.all(reservations.map((r, index) => cart.reservation(String(41 + index), r.reservationId)));
  assert.deepEqual(states.map((r) => r.state).sort(), ['CANCELLED', 'CONFIRMED']);
});

test('eventos fuera de orden no cobran sin reserva y no cambian una decision persistida', async () => {
  await inventory.register('1', randomUUID(), slot(5));
  const result = await create('5', 5, 'test_success');
  const [{ payload }] = await sources.ms_cart.query('SELECT payload FROM saga_outbox WHERE payload->>\'correlationId\'=$1', [result.reservationId]);
  await inventorySaga.event(payload);
  const [{ payload: held }] = await sources.ms_inventory.query("SELECT payload FROM saga_outbox WHERE payload->>'tipo'='inventario.reservado' AND payload->>'correlationId'=$1", [result.reservationId]);
  await payment.event(held);
  assert.equal((await payment.get('5', result.reservationId, [])).state, 'PENDING');
  await payment.event(payload);
  assert.equal((await payment.get('5', result.reservationId, [])).state, 'APPROVED');
  await payment.event({ ...payload, eventoId: randomUUID() });
  await pump();
  const [{ count }] = await sources.ms_payment.query("SELECT count(*) FROM saga_outbox WHERE payload->>'tipo'='pago.procesado' AND payload->>'correlationId'=$1", [result.reservationId]);
  assert.equal(count, '1');
});

test('reserva multi-item es atomica si uno de los slots se agota durante el checkout', async () => {
  await inventory.register('1', randomUUID(), { ...slot(8), capacity: 2 });
  await inventory.register('1', randomUUID(), { ...slot(9), capacity: 2 });
  await cart.add('81', randomUUID(), line(8));
  await cart.add('81', randomUUID(), line(9));
  const multi = await cart.checkout('81', randomUUID(), { testMode: 'test_success' });
  const rival = await create('82', 9, 'test_success');
  const [{ payload }] = await sources.ms_cart.query("SELECT payload FROM saga_outbox WHERE payload->>'correlationId'=$1", [rival.reservationId]);
  await inventorySaga.event(payload);
  await pump();
  assert.equal((await cart.reservation('81', multi.reservationId)).state, 'CANCELLED');
  const [{ dis_cupo_reservado }] = await sources.ms_inventory.query('SELECT d.dis_cupo_reservado FROM disponibilidad d JOIN saga_inventory_slot s USING(dis_id) WHERE s.item_id=$1', ['attraction-8']);
  assert.equal(dis_cupo_reservado, 0);
});

test('HTTP aplica JWT, propiedad y schema-first antes del negocio', async () => {
  assert.equal((await fetch(`${cartBase}/cart/checkout`, { method: 'POST', body: '{}' })).status, 401);
  const response = await fetch(`${cartBase}/cart/items`, { method: 'POST', headers: {
    authorization: 'Bearer user.payload.signature', 'content-type': 'application/json', 'idempotency-key': randomUUID(),
  }, body: JSON.stringify({ ...line(1), amountCents: 1 }) });
  assert.equal(response.status, 400);
  assert.equal((await fetch(`${paymentBase}/saga/payments/preview`, { method: 'POST', headers: {
    authorization: 'Bearer user.payload.signature', 'content-type': 'application/json',
  }, body: JSON.stringify({ testMode: 'test_success' }) })).status, 403);
  const [{ reservation_id }] = await sources.ms_cart.query("SELECT reservation_id FROM saga_cart_reservation WHERE user_id='2'");
  assert.equal((await fetch(`${cartBase}/cart/reservations/${reservation_id}`, { headers: { authorization: 'Bearer user.payload.signature' } })).status, 404);
});

test('outbox recupera una caida del broker conservando el mismo eventoId', async () => {
  await inventory.register('1', randomUUID(), slot(7));
  const reservation = await create('7', 7, 'test_success');
  const published = [];
  const bus = { publish: async (event) => {
    published.push(event.eventoId);
    if (published.length === 1) throw new Error('broker offline');
    await inventorySaga.event(event);
    await payment.event(event);
  } };
  const worker = new services.ms_cart.infra.SagaOutbox(sources.ms_cart, bus);
  await worker.flush();
  const [pending] = await sources.ms_cart.query("SELECT published_at,attempts FROM saga_outbox WHERE payload->>'correlationId'=$1", [reservation.reservationId]);
  assert.equal(pending.published_at, null);
  assert.equal(pending.attempts, 1);
  await sources.ms_cart.query("UPDATE saga_outbox SET next_attempt=now() WHERE payload->>'correlationId'=$1", [reservation.reservationId]);
  await worker.flush();
  assert.equal(published.length, 2);
  assert.equal(published[0], published[1]);
  await pump();
  assert.equal((await cart.reservation('7', reservation.reservationId)).state, 'CONFIRMED');
});

test('pago tardio se reembolsa si expiro la retencion; nunca confirma carrito sin aforo', { timeout: 20000 }, async () => {
  await inventory.register('1', randomUUID(), slot(6));
  const result = await create('6', 6, 'test_success');
  const [{ payload: created }] = await sources.ms_cart.query("SELECT payload FROM saga_outbox WHERE payload->>'correlationId'=$1", [result.reservationId]);
  await inventorySaga.event(created);
  const [{ payload: held }] = await sources.ms_inventory.query("SELECT payload FROM saga_outbox WHERE payload->>'tipo'='inventario.reservado' AND payload->>'correlationId'=$1", [result.reservationId]);
  await payment.event(created); await payment.event(held);
  assert.equal((await payment.get('6', result.reservationId, [])).state, 'APPROVED');
  await delay(Math.max(0, Date.parse(result.expiresAt) - Date.now() + 50));
  await inventorySaga.expire();
  await pump();
  assert.equal((await payment.get('6', result.reservationId, [])).state, 'REFUNDED');
  assert.equal((await cart.reservation('6', result.reservationId)).state, 'CANCELLED');
});
