const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { SagaReadinessService } = require('../dist');

test('readiness exige broker conectado y una consulta real a la base', async () => {
  const queries = [];
  const service = new SagaReadinessService({ query: async sql => { queries.push(sql); } }, { isConnected: () => true });
  assert.deepEqual(await service.ready(), { status: 'UP' });
  assert.deepEqual(queries, ['SELECT 1']);
});
test('broker desconectado devuelve 503 sin consultar la base', async () => {
  let queried = false;
  const service = new SagaReadinessService({ query: async () => { queried = true; } }, { isConnected: () => false });
  await assert.rejects(service.ready(), error => error.getStatus() === 503);
  assert.equal(queried, false);
});
test('una falla de base no se anuncia como UP', async () => {
  const service = new SagaReadinessService({ query: async () => { throw new Error('unavailable'); } }, { isConnected: () => true });
  await assert.rejects(service.ready(), error => error.getStatus() === 503);
});
