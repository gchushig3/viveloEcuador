import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RefundController } from './refund.controller.js';
import { RefundService } from './refund.service.js';
import { ConflictException } from '@nestjs/common';

// Se prueba el controller con su servicio simulado, sin iniciar HTTP ni conectar la base.
describe('RefundController (unitario)', () => {
  let module: TestingModule;
  let controller: RefundController;
  let service: {
    request: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = { request: vi.fn(), list: vi.fn() };
    module = await Test.createTestingModule({
      controllers: [RefundController],
      providers: [{ provide: RefundService, useValue: service }],
    }).compile();
    controller = module.get(RefundController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('solicita el reembolso completo y conserva la respuesta del servicio', async () => {
    const body = {
      pag_id: '22',
      correlationId: 'booking-1',
      rem_numero: 'REF-1',
      rem_monto: 100,
    };
    const result = {
      rem_id: '1',
      rem_estado: 'PENDIENTE',
      rem_monto: '100.00',
    };
    service.request.mockResolvedValue(result);
    await expect(controller.request(body)).resolves.toBe(result);
    expect(service.request).toHaveBeenCalledExactlyOnceWith(body);
  });
  it('lista los reembolsos disponibles', async () => {
    const result = [{ rem_id: '1' }];
    service.list.mockResolvedValue(result);
    await expect(controller.list()).resolves.toBe(result);
  });
  it('propaga conflictos sin devolver un falso comprobante', async () => {
    const error = new ConflictException('Solicitud duplicada con otro monto');
    service.request.mockRejectedValue(error);
    await expect(
      controller.request({
        pag_id: '22',
        correlationId: 'booking-1',
        rem_numero: 'REF-1',
        rem_monto: 100,
      }),
    ).rejects.toBe(error);
  });
});
