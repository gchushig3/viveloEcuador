import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { Server } from 'node:http';
import { configureApplication } from '../../src/configure-application.js';
import {
  BookingCancellationController,
  BookingCancellationAliasController,
} from '../../src/modules/attractions/booking-contract.controller.js';
import { BookingReservationsService } from '../../src/booking/booking-reservations.service.js';
import { BookingCatalogService } from '../../src/booking/booking-catalog.service.js';
import {
  assertCancellable,
  assertCancellationDeadline,
  cancellationReceipt,
} from '../../src/booking/cancellation.js';

describe('Booking cancellation HTTP compatibility', () => {
  let app: INestApplication;
  const cancel = jest.fn((id: string) => {
    if (id === '99') assertCancellable('CHECKED_IN');
    if (id === '98') assertCancellationDeadline('2000-01-01', '10:00:00');
    return Promise.resolve(cancellationReceipt(id, 5, 100, 'USD'));
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        BookingCancellationController,
        BookingCancellationAliasController,
      ],
      providers: [
        { provide: DataSource, useValue: { query: () => Promise.resolve([]) } },
        { provide: ConfigService, useValue: new ConfigService() },
        { provide: BookingCatalogService, useValue: {} },
        { provide: BookingReservationsService, useValue: { cancel } },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(['/api/v3/atracciones/reservas', '/api/v3/reservas'])(
    'returns the required deadline problem at %s',
    async (prefix) => {
      const result = await request(app.getHttpServer() as Server)
        .post(`${prefix}/98/cancel`)
        .expect(409);
      expect(result.body).toMatchObject({
        title: 'Cancelación Fuera de Plazo',
        status: 409,
        detail:
          'La cancelación y reembolso solo están permitidos con al menos 24 horas de anticipación al horario reservado.',
      });
    },
  );

  it.each([
    '/api/v3/atracciones/reservas',
    '/api/v3/reservas',
    '/api/v2/atracciones/reservas',
  ])('accepts optional body and headers at %s', async (prefix) => {
    const result = await request(app.getHttpServer() as Server)
      .post(`${prefix}/12/cancel`)
      .set('Idempotency-Key', 'cancellation-1')
      .set('X-Correlation-Id', 'test-1')
      .send({ reason: 'Cliente solicita cancelar' })
      .expect(200);
    expect(result.body).toMatchObject({
      status: 'CANCELLED',
      monto_reembolsado: 100,
      stock_restoration: { restored_spots: 5 },
    });
    await request(app.getHttpServer() as Server)
      .post(`${prefix}/12/cancel`)
      .expect(200);
  });
  it('returns the required 409 problem after check-in', async () => {
    const result = await request(app.getHttpServer() as Server)
      .post('/api/v3/reservas/99/cancel')
      .expect(409);
    expect(result.body).toMatchObject({
      title: 'Cancelación No Permitida',
      status: 409,
      detail:
        'No se puede cancelar una reserva que ya realizó check-in o fue asistida.',
    });
  });
  it('rejects invalid reasons before calling cancellation', async () => {
    cancel.mockClear();
    await request(app.getHttpServer() as Server)
      .post('/api/v3/reservas/12/cancel')
      .send({ reason: 2 })
      .expect(400);
    expect(cancel).not.toHaveBeenCalled();
  });
});
