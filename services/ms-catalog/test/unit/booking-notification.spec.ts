import 'reflect-metadata';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { BookingCheckinService } from '../../src/booking/booking-checkin.service.js';
import type { BookingClientsService } from '../../src/booking/booking-clients.service.js';

const id = 'a1111111-1111-4111-8111-111111111111';
const row = {
  res_uuid: id, res_estado: 'CONFIRMADA', res_personas: 1,
  res_cliente_nombre: 'Ana', res_cliente_email: 'ana@example.com',
  res_cliente_uuid: id, identificacion: '12345',
  res_checkin_en: new Date('2026-11-06T15:00:00Z'),
  res_checkin_asistentes: 1, res_checkin_admin: 'Guia',
  res_checkin_observaciones: 'Validado', res_checkin_notificado: false,
  atr_nombre: 'Tour', fecha: '2026-11-06', hora: '10:00',
};

function setup(identificacion: string | null = '12345') {
  const query = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([{ ...row, identificacion }]);
  const update = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
  const source = {
    transaction: (fn: (manager: { query: typeof query }) => Promise<unknown>) => fn({ query }),
    query: update,
  } as unknown as DataSource;
  const clients = {
    ensureReservationColumns: async () => {},
    register: () => Promise.resolve({ client: { identificacion }, created: false }),
  } as unknown as BookingClientsService;
  const config = new ConfigService({
    BOOKING_CORE_URL: 'https://booking.example.test',
    BOOKING_CORE_API_KEY: 'test-key',
  });
  return { service: new BookingCheckinService(source, clients, config), update };
}

describe('Notificacion de check-in a Booking', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('envia la ruta y campos indicados y confirma solo con HTTP 200', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"estado":"CHECKED_IN"}', { status: 200 }));
    const { service, update } = setup();
    const result = await service.checkin(id, {});
    expect(result.booking_notificado).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://booking.example.test/api/v3/atracciones/reservas/${id}/checkin`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
        body: JSON.stringify({ documento_identidad: '12345', guia_asignado: 'Guia' }),
      }),
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('no confirma una respuesta 200 sin estado de asistencia', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { service, update } = setup();
    const result = await service.checkin(id, {});
    expect(result.booking_notificado).toBe(false);
    expect(result.booking_error).toContain('estado');
    expect(update).not.toHaveBeenCalled();
  });

  it('conserva pendiente cuando Booking rechaza o falta el documento', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const first = setup();
    expect((await first.service.checkin(id, {})).booking_notificado).toBe(false);
    expect(first.update).not.toHaveBeenCalled();
    fetchMock.mockClear();
    const second = setup(null);
    const result = await second.service.checkin(id, {});
    expect(result.booking_notificado).toBe(false);
    expect(result.booking_error).toContain('Documento');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
