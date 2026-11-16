import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthService } from '../dist/modules/health/health.service.js';

function service() {
  const env = { HEALTH_TIMEOUT_MS: 1000 };
  for (const name of ['IDENTITY','CART','BOOKING','CATALOG','INVENTORY','PAYMENT','CLIENTS']) {
    env[name + '_URL'] = 'https://' + (name === 'BOOKING' ? 'catalog' : name.toLowerCase()) + '.test';
    env['HEALTH_' + name + '_PATH'] = '/health/ready';
  }
  return new HealthService({ getOrThrow: () => env });
}
test('shared Booking/Catalog health URL is queried once per check, and refreshed next time', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ status: 'UP' }) }));
  const health = service();
  assert.deepEqual(await health.check(), { status: 'UP' });
  assert.equal(fetcher.mock.calls.length, 6);
  assert.equal(fetcher.mock.calls.filter(call => String(call.arguments[0]).startsWith('https://catalog.test/')).length, 1);
  await health.check();
  assert.equal(fetcher.mock.calls.length, 12);
});
test('a failing shared dependency still marks the gateway DOWN', async t => {
  t.mock.method(globalThis, 'fetch', async url => ({ ok: !String(url).includes('catalog.test'), json: async () => ({ status: 'UP' }) }));
  assert.deepEqual(await service().check(), { status: 'DOWN' });
});
