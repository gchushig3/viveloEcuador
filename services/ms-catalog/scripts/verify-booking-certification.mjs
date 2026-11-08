// Validación remota explícita. Crea un turno de prueba, cancela sus reservas y lo cierra.
// Requiere INVENTORY_SYNC_API_KEY y BOOKING_CERT_INVENTORY_URL (gRPC TLS).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { InventoryAdminService } from '../dist/booking/inventory-admin.service.js';

const base = process.env.BOOKING_CERT_BASE_URL;
assert.ok(
  base?.startsWith('https://'),
  'BOOKING_CERT_BASE_URL HTTPS requerido',
);
assert.ok(
  process.env.BOOKING_CERT_INVENTORY_URL,
  'BOOKING_CERT_INVENTORY_URL requerido',
);
const inventory = new InventoryAdminService(
  new ConfigService({
    INVENTORY_GRPC_URL: process.env.BOOKING_CERT_INVENTORY_URL,
    INVENTORY_GRPC_TLS: 'true',
    INVENTORY_SYNC_API_KEY: process.env.INVENTORY_SYNC_API_KEY,
    INVENTORY_PROTO_PATH: new URL(
      '../../../contracts/grpc/inventory.proto',
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  }),
);
const date = process.env.BOOKING_CERT_DATE ?? '2099-11-04';
const timeSlot = process.env.BOOKING_CERT_TIME ?? '23:47';
const attractionId = process.env.BOOKING_CERT_ATTRACTION_ID ?? '1';
const reservations = [];
let itemId;
let created = false;
async function http(path, body, key) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = { status: response.status, body: await response.json() };
  if (result.status === 201 && result.body.reserva_id)
    reservations.push(result.body.reserva_id);
  return result;
}
try {
  const promotion = await http('/atracciones/promociones/contrato');
  assert.equal(promotion.status, 200);
  assert.deepEqual(promotion.body, {
    proveedor_codigo: 'NODE_ATR_GLORIA',
    nombre_socio: 'Vívelo Ecuador',
    vertical: 'ATRACCIONES',
    permite_promociones: true,
    porcentaje_descuento: 15,
    condiciones_combo:
      'Aplica para reservas combinadas auto + atracción con Booking Central',
  });
  console.log(JSON.stringify({ promotion }));
  const attraction = await http(`/atracciones/${attractionId}`);
  assert.equal(attraction.status, 200);
  itemId = attraction.body.id ?? attraction.body.data?.id;
  assert.ok(itemId, 'UUID de atraccion requerido');
  const prior = await inventory.list(itemId, date, date);
  assert.ok(
    !prior.some((slot) => slot.timeSlot === timeSlot),
    'El turno de prueba ya existe; elija otra fecha/hora',
  );
  const registered = await inventory.register({
    attractionId,
    itemId,
    dates: [date],
    timeSlots: [timeSlot],
    capacity: 20,
  });
  assert.equal(registered.created, 1);
  created = true;
  const input = {
    atraccion_id: itemId,
    fecha: date,
    hora: timeSlot,
    personas: 20,
    cliente_nombre: 'Prueba certificacion Booking',
    cliente_email: 'certificacion@example.test',
  };
  const key = randomUUID();
  const first = await http('/atracciones/reservas', input, key);
  assert.equal(first.status, 201, JSON.stringify(first));
  const replay = await http('/atracciones/reservas', input, key);
  assert.equal(replay.status, 201);
  assert.equal(replay.body.reserva_id, first.body.reserva_id);
  const extra = await http(
    '/atracciones/reservas',
    { ...input, personas: 2 },
    randomUUID(),
  );
  assert.equal(extra.status, 409, JSON.stringify(extra));
  assert.equal(extra.body.code, 'OUT_OF_STOCK');
  assert.equal(extra.body.type, 'https://booking.epn.edu.ec/errors/sin-cupos');
  const slot = (await inventory.list(itemId, date, date)).find(
    (slot) => slot.timeSlot === timeSlot,
  );
  assert.equal(slot.reserved, 20);
  assert.equal(slot.available, 0);
  console.log(
    JSON.stringify({ first, replay_status: replay.status, extra, slot }),
  );
} finally {
  try {
    for (const id of new Set(reservations)) {
      const cancelled = await http(`/atracciones/reservas/${id}/cancel`, {});
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
    }
    if (created) {
      const slot = (await inventory.list(itemId, date, date)).find(
        (slot) => slot.timeSlot === timeSlot,
      );
      assert.equal(slot.reserved, 0);
      await inventory.update({
        itemId,
        date,
        timeSlot,
        capacity: 20,
        closed: true,
      });
      console.log(
        JSON.stringify({
          cleanup: 'Reservas canceladas; turno de prueba cerrado',
          date,
          timeSlot,
        }),
      );
    }
  } finally {
    inventory.onApplicationShutdown();
  }
}
