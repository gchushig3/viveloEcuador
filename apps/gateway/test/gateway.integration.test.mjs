import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';

let upstream;
let gateway;
let gatewayUrl;
let upstreamUrl;
let stderr = '';
let privateKey;
let publicKey;

test('allows credentialed telemetry preflight only for configured frontend origins', async () => {
  const response = await fetch(`${gatewayUrl}/api/v1/catalog/observabilidad/eventos`, {
    method: 'OPTIONS', headers: { origin: 'https://frontend.example.test',
      'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://frontend.example.test');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  const denied = await fetch(`${gatewayUrl}/api/v1/catalog/observabilidad/eventos`, {
    method: 'OPTIONS', headers: { origin: 'https://untrusted.example.test', 'access-control-request-method': 'POST' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

before(async () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(keys.privateKey, 'RS256');
  publicKey = keys.publicKey;

  upstream = createServer(async (request, response) => {
    if (request.url === '/api/v2/health/ready' || request.url === '/api/v3/atracciones/health') {
      response.writeHead(200).end('{"status":"UP"}');
      return;
    }
    const body = [];
    for await (const chunk of request) body.push(chunk);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(body).toString(),
      }),
    );
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const gatewayPort = portProbe.address().port;
  await new Promise((resolve, reject) =>
    portProbe.close((error) => (error ? reject(error) : resolve())),
  );
  gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  gateway = spawn(process.execPath, ['dist/main.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(gatewayPort),
      IDENTITY_URL: upstreamUrl,
      CART_URL: upstreamUrl,
      BOOKING_URL: upstreamUrl,
      CATALOG_URL: upstreamUrl,
      INVENTORY_URL: upstreamUrl,
      PAYMENT_URL: upstreamUrl,
      AUDIT_URL: upstreamUrl,
      CLIENTS_URL: upstreamUrl,
      JWT_PUBLIC_KEY: publicKey,
      JWT_ISSUER: 'urn:descubreec:identity',
      JWT_AUDIENCE: 'urn:descubreec:internal-api',
      RATE_LIMIT_CUSTOMER: '1',
      CORS_ORIGINS: 'https://frontend.example.test',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  gateway.stderr.setEncoding('utf8');
  gateway.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (gateway.exitCode !== null)
      throw new Error(`Gateway exited during startup: ${stderr}`);
    try {
      const response = await fetch(`${gatewayUrl}/health/live`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gateway did not start: ${stderr}`);
});

after(async () => {
  if (gateway && gateway.exitCode === null) {
    gateway.kill();
    await once(gateway, 'exit');
  }
  if (upstream?.listening)
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
});

async function tokenFor({ sub = '42', roles = ['CLIENTE'], email } = {}) {
  return new SignJWT({
    sid: randomUUID(),
    jti: randomUUID(),
    token_use: 'access',
    roles,
    ...(email ? { email } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'identity-access+jwt' })
    .setIssuer('urn:descubreec:identity')
    .setAudience('urn:descubreec:internal-api')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

test('health and Swagger are public', async () => {
  const [live, docs, docsJson, ready] = await Promise.all([
    fetch(`${gatewayUrl}/health/live`),
    fetch(`${gatewayUrl}/docs`),
    fetch(`${gatewayUrl}/docs-json`),
    fetch(`${gatewayUrl}/health/ready`),
  ]);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'UP' });
  assert.equal(docs.status, 200);
  assert.equal(docsJson.status, 200);
  assert.ok((await docsJson.json()).paths['/api/v1/auth/{path}']);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'UP' });
});

test('requires a valid JWT and forwards verified identity and request data', async () => {
  const missing = await fetch(`${gatewayUrl}/api/v1/cart/items`);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).success, false);

  const token = await tokenFor({ email: 'signed@example.test' });
  const correlationId = 'gateway-test:request-1';
  const response = await fetch(`${gatewayUrl}/api/v1/cart/items?limit=2`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
      'x-user-id': 'attacker',
      'x-user-role': 'ADMIN',
    },
    body: JSON.stringify({ item: 'test' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-correlation-id'), correlationId);
  const forwarded = await response.json();
  assert.equal(forwarded.url, '/api/v2/cart/items?limit=2');
  assert.equal(forwarded.headers['x-user-id'], '42');
  assert.equal(forwarded.headers['x-user-role'], 'CUSTOMER');
  assert.equal(forwarded.headers['x-user-email'], 'signed@example.test');
  assert.equal(forwarded.headers['x-correlation-id'], correlationId);
  assert.deepEqual(JSON.parse(forwarded.body), { item: 'test' });
});

test('enforces RBAC, public identity routes, and throttling', async () => {
  const customerToken = await tokenFor({ sub: '51' });
  const allowed = await fetch(`${gatewayUrl}/api/v1/cart`, {
    headers: { authorization: `Bearer ${customerToken}` },
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).url, '/api/v2/cart');
  const limited = await fetch(`${gatewayUrl}/api/v1/cart`, {
    headers: { authorization: `Bearer ${customerToken}` },
  });
  assert.equal(limited.status, 429);

  const denied = await fetch(`${gatewayUrl}/api/v1/audit/events`, {
    headers: { authorization: `Bearer ${customerToken}` },
  });
  assert.equal(denied.status, 403);

  const publicLogin = await fetch(`${gatewayUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'person@example.test', password: 'not-a-real-password' }),
  });
  assert.equal(publicLogin.status, 200);
  assert.equal((await publicLogin.json()).url, '/api/v2/auth/login');

  const badCorrelation = await fetch(`${gatewayUrl}/api/v1/cart/items`, {
    headers: {
      authorization: `Bearer ${customerToken}`,
      'x-correlation-id': 'contains spaces',
    },
  });
  assert.equal(badCorrelation.status, 400);

  const invalid = await fetch(`${gatewayUrl}/api/v1/cart/items`, {
    headers: { authorization: 'Bearer not-a-jwt' },
  });
  assert.equal(invalid.status, 401);
});

test('allows public catalog reads while protecting Identity administration', async () => {
  const publicCatalog = await fetch(`${gatewayUrl}/api/v1/catalog/atracciones?limit=2`);
  assert.equal(publicCatalog.status, 200);
  assert.equal((await publicCatalog.json()).url, '/api/v2/atracciones?limit=2');

  const publicSearch = await fetch(`${gatewayUrl}/api/v1/catalog/atracciones/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: 1 }),
  });
  assert.equal(publicSearch.status, 200);
  assert.equal((await publicSearch.json()).url, '/api/v2/atracciones/search');

  const publicCategories = await fetch(`${gatewayUrl}/api/v1/catalog/atracciones/categorias/arbol`);
  assert.equal(publicCategories.status, 200);
  assert.equal((await publicCategories.json()).url, '/api/v2/atracciones/categorias/arbol');

  const publicTelemetry = await fetch(`${gatewayUrl}/api/v1/catalog/observabilidad/eventos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(publicTelemetry.status, 200);
  assert.equal((await publicTelemetry.json()).url, '/api/v2/observabilidad/eventos');

  const noToken = await fetch(`${gatewayUrl}/api/v1/identity/users`);
  assert.equal(noToken.status, 401);

  const customerToken = await tokenFor();
  const denied = await fetch(`${gatewayUrl}/api/v1/identity/users`, {
    headers: { authorization: `Bearer ${customerToken}` },
  });
  assert.equal(denied.status, 403);

  const adminToken = await tokenFor({ roles: ['ADMIN'] });
  const allowed = await fetch(`${gatewayUrl}/api/v1/identity/users?page=1`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).url, '/api/v2/users?page=1');

  const privateAdminList = await fetch(`${gatewayUrl}/api/v1/catalog/atracciones/admin/clientes`);
  assert.equal(privateAdminList.status, 401);
});
