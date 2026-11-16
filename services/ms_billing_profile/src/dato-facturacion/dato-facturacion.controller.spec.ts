import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatoFacturacionController } from './dato-facturacion.controller.js';
import { DatoFacturacionService } from './dato-facturacion.service.js';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { SagaHttpRequest } from '@booking/infrastructure';

// Se prueba el controller con su servicio simulado, sin iniciar HTTP ni conectar la base.
describe('DatoFacturacionController (unitario)', () => {
  let module: TestingModule;
  let controller: DatoFacturacionController;
  let service: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    module = await Test.createTestingModule({
      controllers: [DatoFacturacionController],
      providers: [{ provide: DatoFacturacionService, useValue: service }],
    }).compile();
    controller = module.get(DatoFacturacionController);
  });
  afterEach(async () => {
    await module?.close();
  });

  const request = { principal: { userId: '7' } } as SagaHttpRequest;
  const body = {
    dfa_tipo_identificacion: 'PASAPORTE' as const,
    dfa_identificacion: 'ABC123',
    dfa_razon_social: 'Ana',
    dfa_correo: 'ana@example.com',
  };
  it('consulta perfiles usando el usuario autenticado', async () => {
    service.list.mockResolvedValue([]);
    await expect(controller.list(request)).resolves.toEqual([]);
    await controller.get(request, '9007199254740993');
    expect(service.list).toHaveBeenCalledWith('7');
    expect(service.get).toHaveBeenCalledWith('7', '9007199254740993');
  });
  it('crea un perfil y devuelve su Location', async () => {
    const result = { dfa_id: '42', ...body };
    const response = { setHeader: vi.fn() };
    service.create.mockResolvedValue(result);
    await expect(
      controller.create(request, body, response as unknown as Response),
    ).resolves.toBe(result);
    expect(service.create).toHaveBeenCalledWith('7', body);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Location',
      '/api/v2/billing-profiles/42',
    );
  });
  it('actualiza y elimina conservando el propietario y el ID', async () => {
    const update = { dfa_es_principal: false };
    await controller.update(request, '42', update);
    await controller.remove(request, '42');
    expect(service.update).toHaveBeenCalledWith('7', '42', update);
    expect(service.remove).toHaveBeenCalledWith('7', '42');
  });
  it('propaga el error de perfil ajeno o inexistente', async () => {
    const error = new NotFoundException();
    service.get.mockRejectedValue(error);
    await expect(controller.get(request, '42')).rejects.toBe(error);
  });
});
