import 'reflect-metadata';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AttractionsController } from '../../src/modules/attractions/attractions.controller.js';
import { AttractionsService } from '../../src/modules/attractions/attractions.service.js';
import { BookingCatalogService } from '../../src/booking/booking-catalog.service.js';
import { CatalogEventsService } from '../../src/booking/catalog-events.service.js';

describe('AttractionsController (unitario)', () => {
  let module: TestingModule;
  let controller: AttractionsController;
  const booking = {
    search: jest.fn<BookingCatalogService['search']>(),
    detail: jest.fn<BookingCatalogService['detail']>(),
  };
  const attractions = {
    updateStatus: jest.fn<AttractionsService['updateStatus']>(),
    softDelete: jest.fn<AttractionsService['softDelete']>(),
  };
  const events = { consulted: jest.fn<CatalogEventsService['consulted']>() };

  beforeEach(async () => {
    jest.resetAllMocks();
    module = await Test.createTestingModule({
      controllers: [AttractionsController],
      providers: [
        { provide: AttractionsService, useValue: attractions },
        { provide: BookingCatalogService, useValue: booking },
        { provide: CatalogEventsService, useValue: events },
      ],
    }).compile();
    controller = module.get(AttractionsController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('convierte filtros de texto antes de buscar y conserva la correlacion', async () => {
    const result = {
      request_id: 'corr-1',
      data: [],
      metadata: { total_results: 0, page: 2, limit: 10, total_pages: 0 },
    };
    booking.search.mockResolvedValue(result);
    await expect(
      controller.getPublicList(
        { city: 'Quito', incluye_comida: 'false', page: '2', limit: '10' },
        'corr-1',
      ),
    ).resolves.toBe(result);
    expect(booking.search).toHaveBeenCalledWith(
      { city: 'Quito', incluye_comida: false, page: 2, limit: 10 },
      'corr-1',
    );
  });
  it.each([
    { unknown: 'value' },
    { incluye_comida: 'yes' },
    { page: '0' },
    { limit: '1.5' },
    { sort: 'INVALID' },
  ])(
    'rechaza filtros invalidos %j sin consultar el servicio',
    async (query) => {
      await expect(controller.getPublicList(query)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(booking.search).not.toHaveBeenCalled();
    },
  );
  it('publica el evento de consulta usando el ID canonico del detalle', async () => {
    const detail = { id: 'canonical-id', name: 'Tour' } as Awaited<
      ReturnType<BookingCatalogService['detail']>
    >;
    booking.detail.mockResolvedValue(detail);
    await expect(
      controller.getPublicDetail('tour-slug', 'corr-2'),
    ).resolves.toBe(detail);
    expect(booking.detail).toHaveBeenCalledWith('tour-slug');
    expect(events.consulted).toHaveBeenCalledWith('canonical-id', 'corr-2');
  });
  it('no emite un evento si la atraccion no existe', async () => {
    const error = new NotFoundException();
    booking.detail.mockRejectedValue(error);
    await expect(controller.getPublicDetail('missing')).rejects.toBe(error);
    expect(events.consulted).not.toHaveBeenCalled();
  });
  it('delega cambios administrativos conservando ID y estado', async () => {
    await controller.updateStatus('42', { status: 'INACTIVA' });
    await controller.softDelete('42');
    expect(attractions.updateStatus).toHaveBeenCalledWith('42', 'INACTIVA');
    expect(attractions.softDelete).toHaveBeenCalledWith('42');
  });
});
