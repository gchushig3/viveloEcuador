import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Server, ServerCredentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { checkGrpcHealth } from '../dist/modules/health/grpc-health.js';

let server, address, serving = 'SERVING';
before(async () => {
  const proto = loadPackageDefinition(loadSync('../../contracts/grpc/health.proto', { enums: String }));
  server = new Server();
  server.addService(proto.grpc.health.v1.Health.service, { check: (_call, callback) => callback(null, { status: serving }) });
  const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, value) => error ? reject(error) : resolve(value)));
  address = `127.0.0.1:${port}`;
});
after(() => { server.forceShutdown(); });
test('el gateway consulta el protocolo gRPC y solo acepta SERVING', async () => {
  serving = 'SERVING'; assert.equal(await checkGrpcHealth(address, false, 1000), true);
  serving = 'NOT_SERVING'; assert.equal(await checkGrpcHealth(address, false, 1000), false);
});
test('una conexion gRPC rechazada no se anuncia como saludable', async () => {
  assert.equal(await checkGrpcHealth('127.0.0.1:1', false, 200), false);
});
