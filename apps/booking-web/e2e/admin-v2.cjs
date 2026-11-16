// Prueba visual del build real con respuestas HTTP controladas.
// Las reglas de negocio reales se verifican en tests/integration/saga.
const { chromium, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist/booking-frontend/browser');
const id = 'a1111111-1111-4111-8111-111111111111';
const clientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clientReservationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const customer = { client_id: clientId, nombre: 'Ana Cliente', email: 'ana@example.test', identificacion: '0912345678',
  telefono: '0999999999', origenes: ['TIENDA', 'BOOKING'], usuario_id: '42', creado_en: '2026-11-03T12:00:00Z' };
const reservation = { reservationId: id, userId: '2', state: 'CONFIRMED', paid: true, stockConfirmed: true,
  createdAt: '2026-11-03T12:00:00Z', payload: { amountCents: 4000, currency: 'USD',
    lines: [{ itemId: id, attractionId: '11', date: '2099-11-04', timeSlot: '10:30', adults: 2, children: 0 }] } };
const server = http.createServer(async (req, res) => {
  try {
    const name = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (name !== root && !name.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    let data;
    try { data = await fs.readFile(name); } catch { data = await fs.readFile(path.join(root, 'index.html')); }
    const mime = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'Content-Type': mime }).end(data);
  } catch { res.writeHead(500).end(); }
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const evidence = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      const unexpected = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('access_token', 'h.' + btoa(JSON.stringify({ sub: '1', sid: 'test', token_use: 'access', roles: ['ADMIN'], exp: 4102444800 })) + '.s');
        localStorage.setItem('auth_user', JSON.stringify({ id: '1', name: 'Admin', email: 'admin@example.test', roles: ['ADMIN'], verified: true }));
      });
      await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!url.pathname.includes('/api/') && !url.pathname.startsWith('/catalog-api')) return route.continue();
        let body;
        if (url.pathname.endsWith('/users/administrators') && request.method() === 'POST') {
          const value = request.postDataJSON();
          expect(value.email).toBe('nuevo@example.test');
          body = { id: '2', ...value, roles: ['ADMIN'] }; delete body.password;
        } else if (url.pathname.endsWith('/users')) body = { items: [{ id: '7', first_name: 'Alexander', last_name: 'Carrion', email: 'alexander@example.test', phone: null, roles: ['CLIENTE'] }], total: 1, page: 1, limit: 100 };
        else if (url.pathname.endsWith('/cart/admin/customers')) body = [{ userId: '7' }, { userId: '42' }];
        else if (url.pathname.endsWith('/cart/admin/summary')) body = { reservas: { total: 1, confirmadas: 1, canceladas: 0, hoy: 0, proximas: 1, ultimas_24h: 1, personas_proximas: 2 } };
        else if (url.pathname.endsWith(`/cart/admin/reservations/${id}/checkin`)) {
          expect(request.postDataJSON()).toEqual({ documento_identidad: '0912345678', guia_codigo: 'Guia prueba' });
          body = { hora_checkin: '2026-11-13T14:00:00Z', asistentes_reales: 2, guia_codigo: 'Guia prueba' };
        }
        else if (url.pathname.endsWith('/roles')) body = [{ id: 1, name: 'ADMIN', active: true }];
        else if (url.pathname.endsWith('/observabilidad/eventos')) body = { accepted: true };
        else if (url.pathname.endsWith('/resumen')) body = {
          reservas: { total: 0, confirmadas: 0, canceladas: 0, hoy: 0, proximas: 0, ultimas_24h: 0, personas_proximas: 0 },
          atracciones: { total: 0, publicadas: 0, borradores: 0, inactivas: 0 }, top_atracciones: [], recientes: [],
        };
        else if (url.pathname.endsWith('/atracciones/admin/clientes')) body = { items: [customer, ...Array.from({ length: 20 }, (_, i) => ({ ...customer, client_id: `other-${i}`, nombre: `Z Cliente ${i}`, email: `other${i}@example.test`, identificacion: null }))], total: 21, page: 1, limit: 100, total_pages: 1 };
        else if (url.pathname.endsWith(`/atracciones/admin/clientes/${clientId}`)) body = { ...customer, reservas: [{
          reserva_id: clientReservationId, estado: 'CONFIRMADA', atraccion: 'Volcán Cotopaxi', fecha: '2026-11-04', hora: '10:30', personas: 2, creada_en: '2026-11-03T12:00:00Z',
        }] };
        else if (url.pathname.endsWith('/cart/admin/users/42/reservations')) body = [{
          reservationId: id, state: 'CONFIRMED', paid: true, createdAt: '2026-11-03T12:00:00Z', payload: { lines: [] },
        }];
        else if (url.pathname.endsWith('/cart/admin/reservations') || url.pathname.endsWith('/cart/reservations')) body = [reservation];
        else if (url.pathname.endsWith('/admin/reservas')) body = { items: [], total: 0, page: 1, limit: 10, total_pages: 1 };
        else if (url.pathname.endsWith('/admin/lista')) body = { data: [], metadata: { total_results: 0, page: 1, limit: 10, total_pages: 1 } };
        else if (url.pathname.endsWith('/categorias')) body = [];
        else if (url.pathname.endsWith(`/atracciones/${id}`)) body = { id, atr_id: '11', name: 'Experiencia de prueba', city: 'Quito' };
        else { unexpected.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 404, json: { message: 'Ruta no prevista por la prueba' } }); }
        await route.fulfill({ status: 200, json: body });
      });
      await page.goto(`${base}/admin`);
      await expect(page.getByRole('heading', { name: 'Resumen operativo' })).toBeVisible();
      const nav = page.getByRole('navigation', { name: 'Administración', exact: true });
      await nav.getByRole('link', { name: 'Usuarios', exact: true }).click();
      await page.locator('summary').filter({ hasText: 'Crear administrador' }).click();
      await page.getByLabel('Nombres', { exact: true }).fill('Nuevo');
      await page.getByLabel('Apellidos', { exact: true }).fill('Administrador');
      await page.getByLabel('Correo del administrador').fill('nuevo@example.test');
      await page.getByLabel('Clave inicial').fill('Clave-inicial-segura-42!');
      await page.getByRole('button', { name: 'Crear cuenta ADMIN' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Administrador creado' })).toBeVisible();
      await expect(page.getByLabel('Clave inicial')).toHaveValue('');
      await nav.getByRole('link', { name: 'Clientes', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
      await expect(page.getByText('0912345678')).toBeVisible();
      await expect(page.getByText('Alexander Carrion', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Siguiente' }).click();
      await expect(page.getByText(/Página 2 de 2/)).toBeVisible();
      await page.getByRole('button', { name: 'Anterior' }).click();
      await page.getByLabel('Buscar cliente').fill('ana@example.test');
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
      await page.getByRole('button', { name: 'Historial' }).click();
      await expect(page.getByText('Volcán Cotopaxi')).toBeVisible();
      await expect(page.getByText(clientReservationId, { exact: true })).toBeVisible();
      await expect(page.getByText('CONFIRMED')).toBeVisible();
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await nav.getByRole('link', { name: 'Reservas', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Reservas de clientes del sitio' })).toBeVisible();
      await expect(page.getByText(id, { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Reservas del socio Booking' })).toBeVisible();
      const codeSearch = page.getByLabel('Buscar reserva del sitio por código', { exact: true });
      await codeSearch.fill(id.slice(0, 8).toUpperCase());
      await expect(page.getByText(id, { exact: true })).toBeVisible();
      await codeSearch.fill('no-existe');
      await expect(page.getByText('No hay reservas que coincidan con ese código.', { exact: true })).toBeVisible();
      await expect(page.getByText(id, { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Limpiar búsqueda del sitio', exact: true }).click();
      await expect(codeSearch).toHaveValue('');
      await expect(page.getByText(id, { exact: true })).toBeVisible();
      await page.getByText('Ver saga', { exact: true }).click();
      await expect(page.getByText('Inventario: Confirmado', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Check-in / Confirmar asistencia', exact: true }).click();
      await page.getByLabel('Documento del titular').fill('0912345678');
      await page.getByLabel('Guía asignado', { exact: true }).fill('Guia prueba');
      await page.getByRole('button', { name: 'Confirmar check-in', exact: true }).click();
      await expect(page.getByText('Asistencia confirmada', { exact: true })).toBeVisible();
      await nav.getByRole('link', { name: 'Atracciones', exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/atracciones$/);
      await page.goto(`${base}/reservas`);
      await page.getByText('Ver entrada y código QR').click();
      await expect(page.getByRole('img', { name: 'QR de reserva', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancelar Reserva', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Confirmar cancelación' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
      evidence.push({ width, adminCreation: true, adminClients: true, clientSearchAndPaging: true, clientHistory: true, registeredWebCustomer: true, webCheckin: true, codeSearch: true, saga: true, reservations: true, navigation: true, qr: true, cancelConfirmation: true, errors });
      await context.close();
    }
    console.log(JSON.stringify({ browser: 'Chromium', api: 'controlled fixtures', checks: evidence }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
