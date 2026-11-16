import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CuponesController } from './cupon.controller.js';
import { CuponService } from './cupon.service.js';
import { NotFoundException } from '@nestjs/common';

// Se prueba el controller con su servicio simulado, sin iniciar HTTP ni conectar la base.
describe('CuponesController (unitario)', () => {
  let module: TestingModule;
  let controller: CuponesController;
  let service: {
    findAll: ReturnType<typeof vi.fn>;
    findByCodigo: ReturnType<typeof vi.fn>;
    validate: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      findAll: vi.fn(),
      findByCodigo: vi.fn(),
      validate: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    module = await Test.createTestingModule({
      controllers: [CuponesController],
      providers: [{ provide: CuponService, useValue: service }],
    }).compile();
    controller = module.get(CuponesController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('lista cupones y devuelve el resultado del servicio', async () => {
    const result = [{ cup_id: '1', cup_codigo: 'PROMO' }];
    service.findAll.mockResolvedValue(result);
    await expect(controller.findAll()).resolves.toBe(result);
  });
  it('busca por codigo y valida con la fecha solicitada', async () => {
    await controller.findByCodigo('PROMO');
    await controller.validate('PROMO', { fecha: '2030-01-01' });
    expect(service.findByCodigo).toHaveBeenCalledWith('PROMO');
    expect(service.validate).toHaveBeenCalledWith('PROMO', '2030-01-01');
  });
  it('permite validar sin fecha explicita', async () => {
    await controller.validate('PROMO', {});
    expect(service.validate).toHaveBeenCalledWith('PROMO', undefined);
  });
  it('conserva el ID al consultar y actualizar', async () => {
    await controller.findOne('9007199254740993');
    const body = { cup_activo: false };
    await controller.update('9007199254740993', body);
    expect(service.findOne).toHaveBeenCalledWith('9007199254740993');
    expect(service.update).toHaveBeenCalledWith('9007199254740993', body);
  });
  it('eliminar devuelve undefined para la respuesta 204', async () => {
    service.remove.mockResolvedValue({ cup_id: '1' });
    await expect(controller.remove('1')).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('1');
  });
  it('propaga un cupon inexistente', async () => {
    const error = new NotFoundException();
    service.findOne.mockRejectedValue(error);
    await expect(controller.findOne('42')).rejects.toBe(error);
  });
});
