import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttractionLocationController } from './attraction-location.controller.js';
import { AttractionLocationService } from './attraction-location.service.js';
import { NotFoundException } from '@nestjs/common';

// Se prueba el controller con su servicio simulado, sin iniciar HTTP ni conectar la base.
describe('AttractionLocationController (unitario)', () => {
  let module: TestingModule;
  let controller: AttractionLocationController;
  let service: {
    get: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = { get: vi.fn(), upsert: vi.fn() };
    module = await Test.createTestingModule({
      controllers: [AttractionLocationController],
      providers: [{ provide: AttractionLocationService, useValue: service }],
    }).compile();
    controller = module.get(AttractionLocationController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('consulta la ubicacion sin convertir el ID BIGINT a number', async () => {
    const result = { atr_id: '9007199254740993', ciu_id: 1 };
    service.get.mockResolvedValue(result);
    await expect(controller.get('9007199254740993')).resolves.toBe(result);
    expect(service.get).toHaveBeenCalledWith('9007199254740993');
  });
  it('guarda ciudad, coordenadas y direccion sin perder precision', async () => {
    const body = {
      ciu_id: 1,
      geo_latitud: -0.180653,
      geo_longitud: -78.467834,
      geo_direccion: 'Quito',
    };
    const result = { atr_id: '42', ...body };
    service.upsert.mockResolvedValue(result);
    await expect(controller.upsert('42', body)).resolves.toBe(result);
    expect(service.upsert).toHaveBeenCalledWith('42', body);
  });
  it('propaga el error de ubicacion inexistente', async () => {
    const error = new NotFoundException();
    service.get.mockRejectedValue(error);
    await expect(controller.get('42')).rejects.toBe(error);
  });
});
