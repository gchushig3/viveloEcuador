import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { BookingStockSyncService } from '../dist/booking-stock-sync.service.js';

const stock = {
  dis_id: '1', version: '1793978503326', service_id: 'NODE_ATR_GLORIA',
  item_id: 'tour', date: '2026-11-15', time_slot: '10:00', available_units: 15,
};
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function setup(response) {
  const statements = [];
  let selected = false;
  const manager = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('FOR UPDATE OF o')) {
        if (selected) return [];
        selected = true;
        return [stock];
      }
      return [];
    },
  };
  const source = { transaction: (fn) => fn(manager) };
  const config = new ConfigService({
    BOOKING_CORE_URL: 'https://booking.example.test',
    BOOKING_CORE_API_KEY: 'test-key',
  });
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, options };
    return response;
  };
  return { service: new BookingStockSyncService(source, config), statements, sent: () => sent };
}

void test('envia stock neto y confirma la cola solo con acuse exitoso', async () => {
  const fixture = setup(new Response(JSON.stringify({
    success: true, acknowledged: true, service_id: stock.service_id,
    item_id: stock.item_id, date: stock.date, available_units: stock.available_units,
  }), { status: 200 }));
  await fixture.service.drain();
  const { url, options } = fixture.sent();
  assert.equal(url, 'https://booking.example.test/api/v3/inventory/stock');
  assert.equal(options.headers['x-api-key'], 'test-key');
  assert.deepEqual(JSON.parse(options.body), {
    service_id: stock.service_id, item_id: stock.item_id, date: stock.date,
    time_slot: stock.time_slot, available_units: 15, timestamp: 1793978503326,
  });
  assert.ok(fixture.statements.some((sql) => sql.includes('SET next_attempt_at=NULL')));
});

void test('reintenta cuando Booking descarta evento aunque HTTP sea 200', async () => {
  const fixture = setup(new Response(JSON.stringify({ success: false, acknowledged: true }), { status: 200 }));
  await fixture.service.drain();
  assert.ok(fixture.statements.some((sql) => sql.includes('UPDATE booking_stock_outbox')));
  assert.ok(!fixture.statements.some((sql) => sql.includes('SET next_attempt_at=NULL')));
});
