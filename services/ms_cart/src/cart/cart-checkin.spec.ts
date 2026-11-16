import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { SagaStore } from '@booking/infrastructure';
import { CartService } from './cart.service.js';
import type { InventoryClient } from './inventory.client.js';

const id = '72854a89-5f2b-4c42-8802-3a976cd2db6b';
describe('Web attendance', () => {
  afterEach(() => vi.unstubAllGlobals());
  function setup() {
    const row = { state: 'CONFIRMED', paid: true, stock_confirmed: true,
      payload: { userId: '7', lines: [{ adults: 2, children: 1 }] } };
    const receipts = new Map<string, any>();
    const query = vi.fn(async (sql: string, args: any[] = []) => {
      if (sql.startsWith('SELECT response')) return receipts.has(args[0]) ? [{ response: receipts.get(args[0]) }] : [];
      if (sql.startsWith('INSERT INTO saga_http_request')) { receipts.set(args[0], JSON.parse(args[2])); return []; }
      return [row];
    });
    const source = { query, transaction: async (work: any) => work({ query }) } as unknown as DataSource;
    const service = new CartService(source, {} as SagaStore, {} as InventoryClient,
      new ConfigService({ CLIENT_SERVICE_URL: 'http://clients/api/v2/clientes' }));
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ client_id: id }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ usuario_id: '7' }) });
    vi.stubGlobal('fetch', fetcher);
    return { service, row, receipts, query, fetcher };
  }
  const input = { documento_identidad: '1710034065', guia_codigo: 'Guia' };
  it('persists attendance once and returns the original receipt on retry', async () => {
    const { service, receipts, fetcher } = setup();
    const first = await service.checkin('1', id, input);
    expect(first).toMatchObject({ asistentes_reales: 3, guia_codigo: 'Guia', admin_id: '1' });
    expect(await service.checkin('2', id, input)).toEqual(first);
    expect(receipts.size).toBe(1); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['CANCELLED', 'FAILED'])('rejects %s reservations', async state => {
    const { service, row, receipts } = setup(); row.state = state;
    await expect(service.checkin('1', id, input)).rejects.toThrow('Solo reservas pagadas y sin cancelacion en proceso');
    expect(receipts.size).toBe(0);
  });
  it('allows paid pending reservations and rejects unpaid ones', async () => {
    const { service, row, receipts } = setup(); row.state = 'PENDING'; row.paid = false;
    await expect(service.checkin('1', id, input)).rejects.toThrow('Solo reservas pagadas');
    expect(receipts.size).toBe(0);
    row.paid = true;
    expect(await service.checkin('1', id, input)).toMatchObject({ reserva_id: id });
  });
  it('rejects attendance after a cancellation request', async () => {
    const { service, receipts } = setup(); receipts.set(`cancel:${id}`, { status: 'CANCELLING' });
    await expect(service.checkin('1', id, input)).rejects.toThrow('Solo reservas pagadas y sin cancelacion en proceso');
  });
  it('rejects a document belonging to a different customer', async () => {
    const { service, fetcher, receipts } = setup();
    fetcher.mockReset().mockResolvedValueOnce({ ok: true, json: async () => ({ client_id: id }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ usuario_id: '99' }) });
    await expect(service.checkin('1', id, input)).rejects.toThrow('no corresponde');
    expect(receipts.size).toBe(0);
  });
  it('blocks cancellation after a persisted check-in', async () => {
    const { service, row } = setup();
    Object.assign(row, { checkin_en: new Date().toISOString() });
    await expect(service.cancel('7', id, 'Bearer test')).rejects.toMatchObject({ response: { status: 409 } });
  });
  it('rejects malformed documents without querying storage', async () => {
    const { service, query } = setup();
    await expect(service.checkin('1', id, { ...input, documento_identidad: '123' })).rejects.toThrow('Documento');
    expect(query).not.toHaveBeenCalled();
  });
});
