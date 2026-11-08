// Broker AMQPS real y aislado. No usa credenciales ni colas de produccion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import * as tls from 'node:tls';
import { ConfigService } from '../../../packages/shared-infrastructure/node_modules/@nestjs/config/dist/index.js';
import { SagaBus, sagaBindings, consumeSaga } from '../../../packages/shared-infrastructure/dist/index.js';
const require = createRequire(new URL('../../../packages/shared-infrastructure/package.json', import.meta.url));
const amqp = require('amqplib');
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('Event Bus AMQPS: rutas reales, persistencia, redelivery y dead letter', { timeout: 90000 }, async () => {
  const id = randomUUID();
  const container = `booking-broker-test-${id}`;
  const exchange = `booking.test.${id}`;
  const directory = await mkdtemp(join(tmpdir(), 'booking-broker-'));
  const trusted = tls.getCACertificates('default');
  let ownsContainer = false, connection, channel, bus;
  try {
    const openssl = process.env.OPENSSL_PATH ?? (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'),
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    await writeFile(join(directory, 'rabbitmq.conf'), `listeners.tcp = none
listeners.ssl.default = 5671
ssl_options.cacertfile = /tls/cert.pem
ssl_options.certfile = /tls/cert.pem
ssl_options.keyfile = /tls/key.pem
ssl_options.verify = verify_none
ssl_options.fail_if_no_peer_cert = false
`);
    const password = randomBytes(24).toString('hex');
    docker(['run', '-d', '--rm', '--name', container, '--label', `booking.broker-test=${id}`,
      '--mount', `type=bind,src=${directory},dst=/tls,readonly`,
      '--mount', `type=bind,src=${join(directory, 'rabbitmq.conf')},dst=/etc/rabbitmq/rabbitmq.conf,readonly`,
      '-e', 'RABBITMQ_DEFAULT_USER=booking_test', '-e', `RABBITMQ_DEFAULT_PASS=${password}`,
      '-p', '127.0.0.1::5671', 'rabbitmq:3-management']);
    ownsContainer = true;
    tls.setDefaultCACertificates([...trusted, await readFile(join(directory, 'cert.pem'), 'utf8')]);
    const port = docker(['port', container, '5671/tcp']).match(/:(\d+)$/)[1];
    const url = `amqps://booking_test:${password}@127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try { connection = await amqp.connect(url, { timeout: 1000 }); break; } catch { await delay(300); }
    }
    assert.ok(connection, 'El broker temporal debe iniciar');
    channel = await connection.createChannel();
    bus = new SagaBus(new ConfigService({ AMQP_URL: url, SAGA_EXCHANGE: exchange }));
    const reservationId = randomUUID();
    const event = { eventoId: randomUUID(), tipo: 'reserva.creada', origen: 'ms_cart',
      fechaISO: new Date().toISOString(), correlationId: reservationId,
      data: { reservationId, userId: '1', expiresAt: new Date(Date.now() + 60000).toISOString(), currency: 'USD', amountCents: 2000,
        lines: [{ attractionId: '1', itemId: 'test', serviceId: 'NODE', date: '2099-01-01', timeSlot: '10:30:00', slotId: 'slot-20990101-1030', adults: 1, children: 0, amountCents: 2000 }] } };
    await bus.publish(event);
    for (const [role, bindings] of Object.entries(sagaBindings)) {
      const queue = `${exchange}.${role}`;
      const message = await channel.get(queue);
      if (!bindings.includes(event.tipo)) { assert.equal(message, false); continue; }
      assert.ok(message, `Entrega a ${role}`);
      assert.equal(message.properties.deliveryMode, 2);
      assert.equal(message.properties.correlationId, reservationId);
      assert.deepEqual(JSON.parse(message.content.toString()).data, event);
      // Simula un fallo antes del commit: debe reencolar el mismo mensaje.
      channel.nack(message, false, true);
      await delay(30);
      const retry = await channel.get(queue);
      assert.ok(retry.fields.redelivered);
      assert.equal(retry.properties.messageId, event.eventoId);
      await consumeSaga({ getChannelRef: () => channel, getMessage: () => retry, getPattern: () => event.tipo }, {}, async () => assert.fail('Evento invalido no debe ejecutarse'));
    }
    await delay(100);
    const dead = await channel.checkQueue(`${exchange}.dead`);
    assert.equal(dead.messageCount, Object.values(sagaBindings).filter(b => b.includes(event.tipo)).length);
  } finally {
    await bus?.onApplicationShutdown();
    await channel?.close();
    await connection?.close();
    tls.setDefaultCACertificates(trusted);
    if (ownsContainer && docker(['inspect', '--format', '{{index .Config.Labels "booking.broker-test"}}', container]) === id)
      docker(['rm', '--force', container]);
    await rm(directory, { recursive: true, force: true });
  }
});
