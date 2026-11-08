import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BookingStockSyncService } from '../dist/booking-stock-sync.service.js';

void test('outbox captura cambios confirmados y revierte cambios abortados', { skip: !process.env.STOCK_TEST_DATABASE_URL }, async () => {
  const source = new DataSource({ type: 'postgres', url: process.env.STOCK_TEST_DATABASE_URL });
  const originalFetch = globalThis.fetch;
  await source.initialize();
  const service = new BookingStockSyncService(source, new ConfigService({
    BOOKING_CORE_URL: 'https://booking.example.test', BOOKING_CORE_API_KEY: 'test-key',
  }));
  try {
    await source.query('CREATE TABLE horario (hor_id bigint PRIMARY KEY, hor_activo boolean NOT NULL)');
    await source.query('CREATE TABLE disponibilidad (dis_id bigint PRIMARY KEY, hor_id bigint NOT NULL, dis_cupo_total integer NOT NULL, dis_cupo_reservado integer NOT NULL, dis_cerrada boolean NOT NULL)');
    await source.query('CREATE TABLE saga_inventory_slot (dis_id bigint PRIMARY KEY, service_id text NOT NULL, item_id text NOT NULL, date date NOT NULL, time_slot time NOT NULL, zero_capacity boolean NOT NULL)');
    await service.onModuleInit();
    await service.onApplicationShutdown();
    await source.query("INSERT INTO horario VALUES (1, true)");
    await source.query("INSERT INTO disponibilidad VALUES (1, 1, 20, 0, false)");
    await source.query("INSERT INTO saga_inventory_slot VALUES (1, 'NODE_ATR_GLORIA', 'tour', '2026-11-15', '10:00', false)");
    await source.query('UPDATE disponibilidad SET dis_cupo_reservado = 5 WHERE dis_id = 1');
    let rows = await source.query('SELECT version::text, attempts FROM booking_stock_outbox');
    assert.equal(rows.length, 1);
    const version = rows[0].version;
    await assert.rejects(source.transaction(async (manager) => {
      await manager.query('UPDATE disponibilidad SET dis_cupo_reservado = 10 WHERE dis_id = 1');
      throw new Error('rollback');
    }));
    rows = await source.query('SELECT version::text FROM booking_stock_outbox');
    assert.equal(rows[0].version, version);
    let payload;
    globalThis.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      return new Response(JSON.stringify({ success: true, acknowledged: true, ...payload }), { status: 200 });
    };
    await service.drain();
    assert.equal(payload.available_units, 15);
    assert.equal(payload.timestamp, Number(version));
    rows = await source.query('SELECT dis_id FROM booking_stock_outbox WHERE next_attempt_at IS NOT NULL');
    assert.equal(rows.length, 0);
    await source.query('UPDATE disponibilidad SET dis_cerrada = true WHERE dis_id = 1');
    rows = await source.query('SELECT version::text FROM booking_stock_outbox');
    assert.ok(BigInt(rows[0].version) > BigInt(version));
    await service.drain();
    assert.equal(payload.available_units, 0);
    await source.query('UPDATE horario SET hor_activo = false WHERE hor_id = 1');
    rows = await source.query('SELECT dis_id FROM booking_stock_outbox WHERE next_attempt_at IS NOT NULL');
    assert.equal(rows.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await service.onApplicationShutdown();
    await source.destroy();
  }
});
