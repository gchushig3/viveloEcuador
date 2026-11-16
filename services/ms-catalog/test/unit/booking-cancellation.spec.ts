import 'reflect-metadata';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { BookingReservationsService } from '../../src/booking/booking-reservations.service.js';
import type { InventoryAdminService } from '../../src/booking/inventory-admin.service.js';
import type { BookingClientsService } from '../../src/booking/booking-clients.service.js';
import { validateCancellation } from '../../src/booking/cancellation.js';
import { BookingCheckinService } from '../../src/booking/booking-checkin.service.js';
import { ConfigService } from '@nestjs/config';

const id = '72854a89-5f2b-4c42-8802-3a976cd2db6b';
function setup(state = 'CONFIRMADA', checkin: Date | null = null) {
  const row = {
    res_uuid: id,
    res_estado: state,
    res_creada_en: new Date(Date.now()).toISOString(),
    date: '2099-01-01',
    time: '10:00:00',
    res_checkin_en: checkin,
    res_personas: 5,
    amount: '100.00',
    currency: 'USD',
  };
  const query = jest.fn((sql: string) => {
    if (sql.startsWith('SELECT')) return Promise.resolve([{ ...row }]);
    if (sql.includes("res_estado='CANCELANDO'")) row.res_estado = 'CANCELANDO';
    if (sql.includes("res_estado='CANCELADA'")) row.res_estado = 'CANCELADA';
    return Promise.resolve([]);
  });
  const releaseBooking = jest
    .fn<InventoryAdminService['releaseBooking']>()
    .mockResolvedValue({ state: 'RELEASED' });
  const source = {
    transaction: async (
      work: (manager: { query: typeof query }) => Promise<unknown>,
    ) => work({ query }),
  };
  const service = new BookingReservationsService(
    source as unknown as DataSource,
    { releaseBooking } as unknown as InventoryAdminService,
    {
      ensureReservationColumns: async () => {},
    } as unknown as BookingClientsService,
  );
  return { service, releaseBooking, row, query };
}

describe('Cancelacion Booking', () => {
  afterEach(() => { jest.restoreAllMocks(); });
  it.each([1, 86_400_000, 172_800_000])(
    'rejects cancellation %i ms after the 24-hour cutoff without touching stock',
    async (elapsed) => {
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse('2030-01-02T15:00:00Z') + elapsed);
      const { service, row, query, releaseBooking } = setup();
      row.date = '2030-01-03';
      row.time = '10:00:00';
      await expect(service.cancel(id)).rejects.toMatchObject({
        response: {
          title: 'Cancelación Fuera de Plazo',
          status: 409,
          detail:
            'La cancelación y reembolso solo están permitidos con al menos 24 horas de anticipación al horario reservado.',
        },
      });
      expect(row.res_estado).toBe('CONFIRMADA');
      expect(query).toHaveBeenCalledTimes(1);
      expect(releaseBooking).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 0])(
    'allows cancellation %i ms from the cutoff, regardless of purchase date',
    async (offset) => {
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse('2030-01-02T15:00:00Z') + offset);
      const { service, row } = setup();
      row.date = '2030-01-03';
      row.time = '10:00:00';
      row.res_creada_en = '2020-01-01T00:00:00Z';
      expect((await service.cancel(id)).status).toBe('CANCELLED');
    },
  );

  it('allows an already accepted cancellation to finish after the deadline', async () => {
    const { service, row } = setup('CANCELANDO');
    row.date = '2000-01-01';
    expect((await service.cancel(id)).status).toBe('CANCELLED');
  });
  it.each(['CHECKED_IN', 'CONFIRMADO_ASISTIDO', 'COMPLETED'])(
    'rejects attended state %s without releasing stock',
    async (state) => {
      const { service, releaseBooking, query } = setup(state);
      await expect(service.cancel(id)).rejects.toMatchObject({
        response: {
          title: 'Cancelación No Permitida',
          status: 409,
          detail:
            'No se puede cancelar una reserva que ya realizó check-in o fue asistida.',
        },
      });
      expect(releaseBooking).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects check-in stored as a timestamp even if state is still CONFIRMADA', async () => {
    const { service, releaseBooking } = setup('CONFIRMADA', new Date());
    await expect(service.cancel(id)).rejects.toMatchObject({ status: 409 });
    expect(releaseBooking).not.toHaveBeenCalled();
  });

  it('returns the canonical simulated receipt and releases only once on replay', async () => {
    const { service, releaseBooking, row } = setup();
    const receipt = await service.cancel('12');
    expect(receipt).toMatchObject({
      reserva_id: id,
      estado: 'CANCELADA',
      status: 'CANCELLED',
      reembolso_id: `REF-ATR-${id}`,
      monto_reembolsado: 100,
      refund: { status: 'PROCESSED', amount: 100, currency: 'USD' },
      stock_restoration: { status: 'RESTORED', restored_spots: 5 },
    });
    expect(row.res_estado).toBe('CANCELADA');
    expect(await service.cancel(id)).toEqual(receipt);
    expect(releaseBooking).toHaveBeenCalledTimes(1);
    expect(releaseBooking).toHaveBeenCalledWith(id);
  });

  it('does not report success when inventory fails and allows retry', async () => {
    const { service, releaseBooking, row } = setup();
    releaseBooking.mockRejectedValueOnce(new Error('Inventory unavailable'));
    await expect(service.cancel(id)).rejects.toThrow('Inventory unavailable');
    expect(row.res_estado).toBe('CANCELANDO');
    expect((await service.cancel(id)).stock_restoration.status).toBe(
      'RESTORED',
    );
  });

  it('accepts an empty body and optional headers, rejects malformed reasons', () => {
    expect(() => validateCancellation(undefined)).not.toThrow();
    expect(() =>
      validateCancellation(
        { reason: 'Cliente solicita cancelar' },
        'key-1',
        'corr-1',
      ),
    ).not.toThrow();
    expect(() => validateCancellation({ reason: 1 })).toThrow();
    expect(() => validateCancellation([])).toThrow();
  });

  it('rejects a missing simulation price without starting cancellation', async () => {
    const { service, row, releaseBooking } = setup();
    row.currency = '';
    await expect(service.cancel(id)).rejects.toThrow(
      'No hay tarifa disponible',
    );
    expect(row.res_estado).toBe('CONFIRMADA');
    expect(releaseBooking).not.toHaveBeenCalled();
  });
});

describe('Asistencia sin reembolsos parciales', () => {
  function checkinSetup() {
    const row = {
      res_uuid: id,
      res_estado: 'CONFIRMADA',
      res_personas: 5,
      res_cliente_nombre: 'Pepito',
      res_cliente_email: 'pepito@example.com',
      res_checkin_en: null,
      res_checkin_notificado: false,
    };
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.startsWith('SELECT') ? [row] : [{ res_checkin_en: new Date() }],
      ),
    );
    const clients = {
      ensureReservationColumns: async () => {},
      register: () =>
        Promise.resolve({
          client: { client_id: id, identificacion: null },
        }),
    };
    const source = {
      transaction: async (
        work: (manager: { query: typeof query }) => Promise<unknown>,
      ) => work({ query }),
    };
    const service = new BookingCheckinService(
      source as unknown as DataSource,
      clients as unknown as BookingClientsService,
      new ConfigService(),
    );
    return { service, query };
  }

  it('checks in four of five without modifying purchased tickets or stock', async () => {
    const { service, query } = checkinSetup();
    expect(await service.checkin(id, { asistentes_reales: 4 })).toMatchObject({
      estado: 'CHECKED_IN',
      asistentes_reales: 4,
    });
    const updates = query.mock.calls.filter(([sql]) =>
      sql.startsWith('UPDATE'),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]![0]).not.toMatch(
      /res_personas\s*=|res_estado\s*=|dis_cupo/,
    );
  });

  it('asks for a separate purchase when seven arrive with five tickets', async () => {
    const { service, query } = checkinSetup();
    await expect(service.checkin(id, { asistentes_reales: 7 })).rejects.toThrow(
      'nueva reserva independiente',
    );
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(
      false,
    );
  });
});
