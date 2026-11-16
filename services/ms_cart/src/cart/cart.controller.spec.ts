import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { SagaHttpRequest } from '@booking/infrastructure';

// Se prueba el controller con su servicio simulado, sin iniciar HTTP ni conectar la base.
describe('CartController (unitario)', () => {
  let module: TestingModule;
  let controller: CartController;
  let service: {
    add: ReturnType<typeof vi.fn>;
    checkout: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    reservation: ReturnType<typeof vi.fn>;
    adminReservations: ReturnType<typeof vi.fn>;
    adminCustomerUserIds: ReturnType<typeof vi.fn>;
    adminUserReservations: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      add: vi.fn(),
      checkout: vi.fn(),
      clear: vi.fn(),
      list: vi.fn(),
      cancel: vi.fn(),
      reservation: vi.fn(),
      adminReservations: vi.fn(),
      adminCustomerUserIds: vi.fn(),
      adminUserReservations: vi.fn(),
    };
    module = await Test.createTestingModule({
      controllers: [CartController],
      providers: [{ provide: CartService, useValue: service }],
    }).compile();
    controller = module.get(CartController);
  });
  afterEach(async () => {
    await module?.close();
  });

  const request = {
    principal: { userId: '7', sessionId: 'test-session', roles: ['CLIENTE'] },
    headers: { authorization: 'Bearer test-token' },
  } as SagaHttpRequest;
  const key = '72854a89-5f2b-4c42-8802-3a976cd2db6b';
  it('agrega entradas con usuario y clave de idempotencia', async () => {
    const body = {
      attractionId: '42',
      date: '2030-01-01',
      timeSlot: '10:00',
      slotId: 'slot-20300101-1000',
      adults: 2,
      children: 1,
    };
    const result = { itemId: '1' };
    service.add.mockResolvedValue(result);
    await expect(controller.add(request, key, body)).resolves.toBe(result);
    expect(service.add).toHaveBeenCalledWith('7', key, body);
  });
  it('rechaza claves invalidas antes de comprar', () => {
    expect(() => controller.checkout(request, 'invalid', {})).toThrow(
      BadRequestException,
    );
    expect(service.checkout).not.toHaveBeenCalled();
  });
  it('conserva el modo de prueba al finalizar la compra', async () => {
    const body = { testMode: 'test_success' as const };
    await controller.checkout(request, key, body);
    expect(service.checkout).toHaveBeenCalledWith('7', key, body);
  });
  it('consulta reservas y limpia solo el carrito del usuario autenticado', async () => {
    await controller.list(request);
    await controller.get(request, key);
    await controller.clear(request);
    expect(service.list).toHaveBeenCalledWith('7');
    expect(service.reservation).toHaveBeenCalledWith('7', key);
    expect(service.clear).toHaveBeenCalledWith('7');
  });
  it('cancela conservando la autorizacion del usuario', async () => {
    service.cancel.mockResolvedValue({ state: 'REFUND_REQUESTED' });
    await expect(controller.cancel(request, key)).resolves.toEqual({
      state: 'REFUND_REQUESTED',
    });
    expect(service.cancel).toHaveBeenCalledWith('7', key, 'Bearer test-token');
  });
  it('propaga el bloqueo por vencimiento del plazo', async () => {
    const error = new ConflictException('Plazo de 24 horas vencido');
    service.cancel.mockRejectedValue(error);
    await expect(controller.cancel(request, key)).rejects.toBe(error);
  });
  it('rechaza IDs de usuario invalidos en la consulta administrativa', () => {
    expect(() =>
      controller.adminUserReservations('9223372036854775808'),
    ).toThrow(BadRequestException);
    expect(service.adminUserReservations).not.toHaveBeenCalled();
  });
  it('lista las cuentas con al menos un pago confirmado para la administracion', async () => {
    const customers = [{ userId: '7' }];
    service.adminCustomerUserIds.mockResolvedValue(customers);
    await expect(controller.adminCustomers()).resolves.toBe(customers);
    expect(service.adminCustomerUserIds).toHaveBeenCalledOnce();
  });
});
