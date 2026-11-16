import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { ServiceUnavailableException } from '@nestjs/common';

// Se prueba el controller con su servicio simulado, sin iniciar HTTP ni conectar la base.
describe('AuditController (unitario)', () => {
  let module: TestingModule;
  let controller: AuditController;
  let service: { list: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { list: vi.fn() };
    module = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: service }],
    }).compile();
    controller = module.get(AuditController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('envia los filtros de correlacion, evento y limite sin perderlos', async () => {
    const filters = {
      correlationId: 'booking-1',
      eventType: 'pago.reembolsado',
      limit: '20',
    };
    const result = [{ id: '1', eventType: filters.eventType }];
    service.list.mockResolvedValue(result);
    await expect(controller.list(filters)).resolves.toBe(result);
    expect(service.list).toHaveBeenCalledExactlyOnceWith(filters);
  });
  it('admite una consulta sin filtros', async () => {
    service.list.mockResolvedValue([]);
    await expect(controller.list({})).resolves.toEqual([]);
    expect(service.list).toHaveBeenCalledWith({});
  });
  it('propaga errores del almacenamiento', async () => {
    const error = new ServiceUnavailableException();
    service.list.mockRejectedValue(error);
    await expect(controller.list({})).rejects.toBe(error);
  });
});
