// Prueba visual del build real con respuestas HTTP controladas.
// Las reglas de negocio reales se verifican en tests/integration/saga.
const { chromium, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist/booking-frontend/browser');
const id = '11111111-1111-4111-8111-111111111111';
const reservation = { reservationId: id, userId: '2', state: 'CONFIRMED', paid: true, stockConfirmed: true,
  createdAt: '2026-11-03T12:00:00Z', payload: { amountCents: 4000, currency: 'USD',
    lines: [{ itemId: id, attractionId: '11', date: '2026-11-04', timeSlot: '10:30', adults: 2, children: 0 }] } };
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
        } else if (url.pathname.endsWith('/users')) body = { items: [], total: 2, page: 1, limit: 10 };
        else if (url.pathname.endsWith('/roles')) body = [{ id: 1, name: 'ADMIN', active: true }];
        else if (url.pathname.endsWith('/resumen')) body = {
          reservas: { total: 0, confirmadas: 0, canceladas: 0, hoy: 0, proximas: 0, ultimas_24h: 0, personas_proximas: 0 },
          atracciones: { total: 0, publicadas: 0, borradores: 0, inactivas: 0 }, top_atracciones: [], recientes: [],
        };
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
      await nav.getByRole('link', { name: 'Reservas', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Reservas de clientes del sitio' })).toBeVisible();
      await expect(page.getByText(id, { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Reservas del socio Booking' })).toBeVisible();
      await nav.getByRole('link', { name: 'Atracciones', exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/atracciones$/);
      await page.goto(`${base}/reservas`);
      await page.getByText('Ver entrada y código QR').click();
      await expect(page.getByRole('img', { name: 'QR de reserva', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancelar y reembolsar' }).click();
      await expect(page.getByRole('button', { name: 'Confirmar cancelación' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
      evidence.push({ width, adminCreation: true, reservations: true, navigation: true, qr: true, cancelConfirmation: true, errors });
      await context.close();
    }
    console.log(JSON.stringify({ browser: 'Chromium', api: 'controlled fixtures', checks: evidence }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
