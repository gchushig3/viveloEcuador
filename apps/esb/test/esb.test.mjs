import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createEsb } from '../src/server.mjs';
import { loadConfig } from '../src/config.mjs';

const key = 'internal-secret-at-least-32-characters';
const partnerKey = 'partner-secret-at-least-32-characters';
async function listen(server, t) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function setup(t, handler, overrides = {}) {
  const providerUrl = await listen(createServer(handler), t);
  const config = loadConfig({ ESB_API_KEY: key, PARTNER_KEY: partnerKey, ESB_PROVIDERS: JSON.stringify([{ serviceId: 'partner', baseUrlRest: `${providerUrl}/api/v3/atracciones`, apiKeyEnv: 'PARTNER_KEY' }]), ...overrides });
  return listen(createEsb(config, { logger: () => {} }), t);
}
const send = (base, { path = '/api/v1/providers/partner/reservations', headers = {}, body = '{"adult_count":2}' } = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'idempotency-key': 'booking-order-123', 'x-correlation-id': 'trace-123', ...headers }, body,
});

test('routes create/cancel/checkin and preserves payload, credentials and contract responses', async (t) => {
  const received = [];
  const base = await setup(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(received.length === 1 ? 201 : 200, { 'content-type': 'application/json' });
    res.end('{"external_order_id":"order-1"}');
  });
  for (const suffix of ['', '/order-1/cancel', '/order-1/checkin']) {
    const response = await send(base, { path: `/api/v1/providers/partner/reservations${suffix}` });
    assert.equal(response.status, suffix ? 200 : 201);
    assert.equal(response.headers.get('x-correlation-id'), 'trace-123');
    assert.deepEqual(await response.json(), { external_order_id: 'order-1' });
  }
  assert.deepEqual(received.map((r) => r.path), ['/api/v3/atracciones/reservas', '/api/v3/atracciones/reservas/order-1/cancel', '/api/v3/atracciones/reservas/order-1/checkin']);
  for (const request of received) {
    assert.equal(request.headers['x-api-key'], partnerKey);
    assert.equal(request.headers['idempotency-key'], 'booking-order-123');
    assert.equal(request.headers['x-correlation-id'], 'trace-123');
    assert.equal(request.body, '{"adult_count":2}');
  }
});

test('preserves OUT_OF_STOCK without retrying or inventing compensation', async (t) => {
  let calls = 0;
  const base = await setup(t, (req, res) => { calls++; res.writeHead(409, { 'content-type': 'application/problem+json' }); res.end('{"code":"OUT_OF_STOCK"}'); });
  const response = await send(base);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: 'OUT_OF_STOCK' });
  assert.equal(calls, 1);
});

test('rejects unauthorized, unknown routes, missing idempotency and invalid payloads before dispatch', async (t) => {
  let calls = 0;
  const base = await setup(t, (req, res) => { calls++; res.end(); });
  for (const [options, status] of [
    [{ headers: { 'x-api-key': 'wrong' } }, 401],
    [{ headers: { 'idempotency-key': '' } }, 400],
    [{ headers: { 'x-correlation-id': 'bad space' } }, 400],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ body: '{' }, 400], [{ body: '[]' }, 400],
    [{ path: '/api/v1/providers/missing/reservations' }, 404],
    [{ path: '/api/v1/providers/partner/reservations/a%2Fb/cancel' }, 404],
  ]) assert.equal((await send(base, options)).status, status);
  assert.equal(calls, 0);
  assert.equal((await fetch(`${base}/health/live`)).status, 200);
});

test('bounds request and response sizes', async (t) => {
  const base = await setup(t, (req, res) => res.end('x'.repeat(100)), { ESB_MAX_BODY_BYTES: '32' });
  assert.equal((await send(base, { body: JSON.stringify({ data: 'x'.repeat(40) }) })).status, 413);
  assert.equal((await send(base)).status, 502);
});

test('times out and does not follow redirects', async (t) => {
  let calls = 0;
  const base = await setup(t, (req, res) => {
    calls++;
    if (calls === 1) { res.writeHead(302, { location: '/stolen' }); res.end(); }
  }, { ESB_TIMEOUT_MS: '100' });
  assert.equal((await send(base)).status, 502);
  assert.equal((await send(base)).status, 504);
  assert.equal(calls, 2);
});

test('validates provider registry at startup', () => {
  const env = { ESB_API_KEY: key, PARTNER_KEY: partnerKey };
  const entry = { serviceId: 'partner', baseUrlRest: 'https://partner.example/api/v3/atracciones', apiKeyEnv: 'PARTNER_KEY' };
  for (const entries of [[], [entry, entry], [{ ...entry, baseUrlRest: 'https://user:password@partner.example' }], [{ ...entry, apiKeyEnv: 'MISSING' }]])
    assert.throws(() => loadConfig({ ...env, ESB_PROVIDERS: JSON.stringify(entries) }));
  assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production', ESB_PROVIDERS: JSON.stringify([{ ...entry, baseUrlRest: 'http://partner.example' }]) }));
});
