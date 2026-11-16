import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InventoryService } from '../dist/inventory.service.js';

test('batch registration preserves capacity, skips existing slots and serializes retries', { skip: !process.env.SLOTS_TEST_DATABASE_URL }, async () => {
  const source = new DataSource({ type: 'postgres', url: process.env.SLOTS_TEST_DATABASE_URL });
  await source.initialize();
  try {
    await source.query(`CREATE TABLE horario(hor_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, atr_id bigint, hor_hora time, hor_cupo int, UNIQUE(atr_id,hor_hora));
      CREATE TABLE disponibilidad(dis_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,atr_id bigint,hor_id bigint REFERENCES horario,dis_fecha date,dis_cupo_total int,UNIQUE(atr_id,hor_id,dis_fecha));
      CREATE TABLE saga_inventory_slot(service_id text,item_id text,date date,slot_id text,time_slot time,dis_id bigint UNIQUE REFERENCES disponibilidad);`);
    const service = new InventoryService(source, {}, new ConfigService({ INVENTORY_SERVICE_ID: 'NODE_ATR_GLORIA' }));
    const dates = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2030, 0, 1 + i)).toISOString().slice(0, 10));
    const input = { attractionId: '21', itemId: 'attraction', dates, timeSlots: ['09:00', '13:00', '16:00'], capacity: 7 };
    assert.deepEqual(await service.registerSlots(input), { created: 360, skipped: 0 });
    assert.deepEqual(await service.registerSlots({ ...input, capacity: 20 }), { created: 0, skipped: 360 });
    const rows = await source.query('SELECT dis_cupo_total AS total,count(*)::int AS count FROM disponibilidad GROUP BY dis_cupo_total');
    assert.deepEqual(rows, [{ total: 7, count: 360 }]);
    const slots = await source.query("SELECT slot_id FROM saga_inventory_slot WHERE date='2030-01-01' ORDER BY time_slot");
    assert.deepEqual(slots.map(row => row.slot_id), ['slot-20300101-0900', 'slot-20300101-1300', 'slot-20300101-1600']);
    const retry = { ...input, dates: ['2031-01-01'] };
    const results = await Promise.all([service.registerSlots(retry), service.registerSlots(retry)]);
    assert.equal(results.reduce((sum, result) => sum + result.created, 0), 3);
    assert.equal(results.reduce((sum, result) => sum + result.skipped, 0), 3);
  } finally { await source.destroy(); }
});
