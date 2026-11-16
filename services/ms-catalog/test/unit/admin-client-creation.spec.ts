import 'reflect-metadata';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AdminReservationsController } from '../../src/modules/attractions/admin-reservations.controller.js';
import { BookingClientsService } from '../../src/booking/booking-clients.service.js';
import { BookingReservationsService } from '../../src/booking/booking-reservations.service.js';

describe('Administrative client creation', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('stores a standalone profile in ms-cliente without creating an identity', async () => {
    const client = { client_id: 'client', nombre: 'Ana', email: 'ana@example.test', identificacion: null, telefono: null };
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ cliente: client, reused: false }), { status: 201 }));
    const clients = new BookingClientsService({} as DataSource, new ConfigService({ CLIENT_SERVICE_URL: 'http://clients/api/v2/clientes' }));
    const controller = new AdminReservationsController({} as DataSource, {} as BookingReservationsService, clients);
    expect(await controller.createClient({ nombre: ' Ana ', email: ' ANA@EXAMPLE.TEST ', usuario_id: '42' })).toEqual({ cliente: client, reused: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('http://clients/api/v2/clientes/admin');
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ nombre: 'Ana', email: 'ana@example.test', origen: 'TIENDA' });
  });

  it('rejects invalid input before contacting ms-cliente', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const clients = new BookingClientsService({} as DataSource, new ConfigService());
    const controller = new AdminReservationsController({} as DataSource, {} as BookingReservationsService, clients);
    await expect(controller.createClient({ nombre: 'Ana', email: 'invalid' })).rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();
  });
});
