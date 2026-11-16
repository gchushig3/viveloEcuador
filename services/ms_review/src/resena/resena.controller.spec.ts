import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResenaController } from './resena.controller.js';
import { ResenaService } from './resena.service.js';
import { ConflictException } from '@nestjs/common';
import type { Response } from 'express';
import type { SagaHttpRequest } from '@booking/infrastructure';

// Se prueba el controller con su servicio simulado, sin iniciar HTTP ni conectar la base.
describe('ResenaController (unitario)', () => {
  let module: TestingModule;
  let controller: ResenaController;
  let service: {
    listVisible: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = { listVisible: vi.fn(), create: vi.fn(), setVisible: vi.fn() };
    module = await Test.createTestingModule({
      controllers: [ResenaController],
      providers: [{ provide: ResenaService, useValue: service }],
    }).compile();
    controller = module.get(ResenaController);
  });
  afterEach(async () => {
    await module?.close();
  });

  const request = { principal: { userId: '7' } } as SagaHttpRequest;
  it('lista solo las resenas visibles de la atraccion solicitada', async () => {
    const result = [{ ren_id: '1', atr_id: '42' }];
    service.listVisible.mockResolvedValue(result);
    await expect(controller.list('42')).resolves.toBe(result);
    expect(service.listVisible).toHaveBeenCalledWith('42');
  });
  it('crea la resena con el usuario autenticado y devuelve Location', async () => {
    const body = {
      atr_id: '42',
      ren_puntuacion: 5,
      ren_comentario: 'Excelente',
    };
    const result = { ren_id: '9', ...body };
    const response = { setHeader: vi.fn() };
    service.create.mockResolvedValue(result);
    await expect(
      controller.create(request, body, response as unknown as Response),
    ).resolves.toBe(result);
    expect(service.create).toHaveBeenCalledWith('7', body);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Location',
      '/api/v2/reviews/9',
    );
  });
  it.each([true, false])(
    'envia la visibilidad %s sin invertirla',
    async (visible) => {
      await controller.setVisible('9', { ren_visible: visible });
      expect(service.setVisible).toHaveBeenCalledWith('9', visible);
    },
  );
  it('propaga un conflicto sin crear Location', async () => {
    const error = new ConflictException('Resena ya registrada');
    const response = { setHeader: vi.fn() };
    service.create.mockRejectedValue(error);
    await expect(
      controller.create(
        request,
        { atr_id: '42', ren_puntuacion: 5, ren_comentario: 'Excelente' },
        response as unknown as Response,
      ),
    ).rejects.toBe(error);
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
