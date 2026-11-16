import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type {
  SagaStore,
  SagaEvent,
  ReservationData,
} from '@booking/infrastructure';
import { CartService } from './cart.service.js';
import type { InventoryClient } from './inventory.client.js';

const id = '72854a89-5f2b-4c42-8802-3a976cd2db6b';
const payload: ReservationData = {
  reservationId: id,
  userId: '1',
  expiresAt: '2099-01-01T00:00:00Z',
  currency: 'USD',
  amountCents: 10000,
  lines: [
    {
      attractionId: '1',
      itemId: id,
      serviceId: id,
      date: '2099-01-01',
      timeSlot: '10:00',
      slotId: 'slot-20990101-1000',
      adults: 5,
      children: 0,
      amountCents: 10000,
    },
  ],
};

describe('Cart cancellation completion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function setup() {
    const row = {
      state: 'CONFIRMED',
      created_at: new Date().toISOString(),
      paid: true,
      stock_confirmed: true,
      payload: structuredClone(payload),
    };
    let receipt: any;
    const query = vi.fn(async (sql: string, args?: any[]) => {
      if (sql.startsWith('INSERT INTO saga_http_request')) {
        receipt ??= JSON.parse(args![2]);
        return [];
      }
      if (sql.startsWith('SELECT response'))
        return receipt ? [{ response: structuredClone(receipt) }] : [];
      if (sql.startsWith('UPDATE saga_http_request')) {
        receipt = JSON.parse(args![1]);
        return [];
      }
      if (sql.includes("state='CANCELLED'")) {
        row.state = 'CANCELLED';
        return [];
      }
      return [structuredClone(row)];
    });
    const source = { query, transaction: async (work: any) => work({ query }) } as unknown as DataSource;
    const store = {
      consume: async (_event: SagaEvent, work: any) => work({ query }),
    } as unknown as SagaStore;
    const service = new CartService(
      source,
      store,
      {} as InventoryClient,
      new ConfigService({ REFUND_BASE_URL: 'http://refund' }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true })),
    );
    return { service, row, receipt: () => receipt };
  }
  function event(tipo: SagaEvent['tipo']): SagaEvent {
    return {
      eventoId: crypto.randomUUID(),
      tipo,
      correlationId: id,
      origen: tipo === 'pago.reembolsado' ? 'ms_payment' : 'ms_inventory',
      fechaISO: new Date().toISOString(),
      data: payload,
    };
  }

  it.each([1, 86_400_000, 172_800_000])(
    'rejects cancellation %i ms after the cutoff without requesting a refund',
    async (elapsed) => {
      vi.spyOn(Date, 'now').mockReturnValue(
        Date.parse('2030-01-02T15:00:00Z') + elapsed,
      );
      const { service, row, receipt } = setup();
      row.payload.lines[0].date = '2030-01-03';
      row.payload.lines[0].timeSlot = '10:00';
      await expect(
        service.cancel('1', id, 'Bearer token'),
      ).rejects.toMatchObject({
        response: { title: 'Cancelación Fuera de Plazo', status: 409 },
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(receipt()).toBeUndefined();
    },
  );

  it.each([-1, 0])(
    'allows cancellation %i ms from the cutoff even for an old purchase',
    async (offset) => {
      vi.spyOn(Date, 'now').mockReturnValue(
        Date.parse('2030-01-02T15:00:00Z') + offset,
      );
      const { service, row } = setup();
      row.created_at = '2020-01-01T00:00:00Z';
      row.payload.lines[0].date = '2030-01-03';
      row.payload.lines[0].timeSlot = '10:00:00';
      await expect(
        service.cancel('1', id, 'Bearer token'),
      ).resolves.toMatchObject({ state: 'REFUND_REQUESTED' });
    },
  );

  it('rejects the whole reservation if one of its turns is out of time', async () => {
    const { service, row } = setup();
    row.payload.lines.push({ ...row.payload.lines[0], date: '2000-01-01' });
    await expect(service.cancel('1', id, 'Bearer token')).rejects.toMatchObject(
      { status: 409 },
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['pago.reembolsado', 'inventario_liberado'],
    ['inventario_liberado', 'pago.reembolsado'],
  ] as const)(
    'waits for both effects in order %s then %s',
    async (first, second) => {
      const { service, receipt, row } = setup();
      await service.cancel('1', id, 'Bearer token');
      await service.event(event(first));
      expect(row.state).toBe(
        first === 'pago.reembolsado' ? 'CANCELLED' : 'CONFIRMED',
      );
      expect(receipt().status).toBe('CANCELLING');
      await service.event(event(second));
      expect(receipt()).toMatchObject({
        status: 'CANCELLED',
        monto_reembolsado: 100,
        refund: { status: 'PROCESSED', amount: 100 },
        stock_restoration: { status: 'RESTORED', restored_spots: 5 },
      });
      await service.event(event(second));
      expect(receipt().stock_restoration.restored_spots).toBe(5);
    },
  );

  it('does not report a failed refund request as success', async () => {
    const { service, receipt } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409 })),
    );
    await expect(service.cancel('1', id, 'Bearer token')).rejects.toThrow(
      'No se pudo solicitar el reembolso',
    );
    expect(receipt().refund.status).toBe('PENDING');
  });
});
