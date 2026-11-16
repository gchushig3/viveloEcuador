import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { Transport } from '@nestjs/microservices';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { createServer } from 'node:net';
import { SagaReadinessService } from '@booking/infrastructure';
import { HealthController } from '../dist/health.controller.js';

test('el servidor de inventario publica health gRPC y refleja fallas de dependencias', async () => {
  let healthy = true;
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const module = await Test.createTestingModule({ controllers: [HealthController], providers: [{ provide: SagaReadinessService, useValue: { ready: async () => { if (!healthy) throw new Error('dependency unavailable'); return { status: 'UP' }; } } }] }).compile();
  const app = module.createNestMicroservice({ transport: Transport.GRPC, options: { package: ['inventory', 'grpc.health.v1'], protoPath: ['../../contracts/grpc/inventory.proto', '../../contracts/grpc/health.proto'], url: `127.0.0.1:${port}` } }, { logger: false });
  await app.listen();
  const proto = loadPackageDefinition(loadSync('../../contracts/grpc/health.proto', { enums: String }));
  const client = new proto.grpc.health.v1.Health(`127.0.0.1:${port}`, credentials.createInsecure());
  const check = () => new Promise((resolve, reject) => client.check({ service: '' }, { deadline: Date.now() + 2000 }, (error, response) => error ? reject(error) : resolve(response.status)));
  try {
    assert.equal(await check(), 'SERVING'); healthy = false;
    assert.equal(await check(), 'NOT_SERVING');
  } finally { client.close(); await app.close(); }
});
