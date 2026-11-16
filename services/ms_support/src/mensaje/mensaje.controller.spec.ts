import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MensajesController } from './mensaje.controller.js';
import { MensajeService } from './mensaje.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';

// Se prueba el controller con su servicio simulado, sin iniciar HTTP ni conectar la base.
describe('MensajesController (unitario)', () => {
  let module: TestingModule;
  let controller: MensajesController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      create: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      markRead: vi.fn(),
      remove: vi.fn(),
    };
    module = await Test.createTestingModule({
      controllers: [MensajesController],
      providers: [{ provide: MensajeService, useValue: service }],
    }).compile();
    controller = module.get(MensajesController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('crea un mensaje y construye Location con el identificador devuelto', async () => {
    const body = {
      men_nombre: 'Ana',
      men_correo: 'ana@example.com',
      men_asunto: 'Consulta',
      men_cuerpo: 'Necesito ayuda',
    };
    const result = { men_id: '9007199254740993', ...body };
    const response = { setHeader: vi.fn() };
    service.create.mockResolvedValue(result);
    await expect(
      controller.create(body, response as unknown as Response),
    ).resolves.toBe(result);
    expect(service.create).toHaveBeenCalledWith(body);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Location',
      '/api/v2/support/messages/9007199254740993',
    );
  });
  it.each([
    ['true', true],
    ['false', false],
    [undefined, undefined],
  ])('convierte el filtro %s', async (input, expected) => {
    service.list.mockResolvedValue([]);
    await expect(controller.list(input)).resolves.toEqual([]);
    expect(service.list).toHaveBeenCalledWith(expected);
  });
  it('rechaza un filtro invalido antes de consultar el servicio', () => {
    expect(() => controller.list('yes')).toThrow(BadRequestException);
    expect(service.list).not.toHaveBeenCalled();
  });
  it('conserva IDs grandes al consultar, marcar y eliminar mensajes', async () => {
    const id = '9007199254740993';
    await controller.get(id);
    await controller.markRead(id, { men_leido: false });
    await controller.remove(id);
    expect(service.get).toHaveBeenCalledWith(id);
    expect(service.markRead).toHaveBeenCalledWith(id, false);
    expect(service.remove).toHaveBeenCalledWith(id);
  });
  it('propaga el error de mensaje inexistente', async () => {
    const error = new NotFoundException();
    service.get.mockRejectedValue(error);
    await expect(controller.get('42')).rejects.toBe(error);
  });
});
