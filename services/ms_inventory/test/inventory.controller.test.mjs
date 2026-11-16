import 'reflect-metadata';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { Metadata, status } from '@grpc/grpc-js';
import { firstValueFrom, of } from 'rxjs';
import { InventoryController } from '../dist/inventory.controller.js';
import { InventoryService } from '../dist/inventory.service.js';
import { InventorySagaService } from '../dist/inventory-saga.service.js';

describe('InventoryController (unitario)', () => {
  let module, controller, service;
  const key = 'test-inventory-secret-at-least-32-characters';
  const reservationId = '72854a89-5f2b-4c42-8802-3a976cd2db6b';
  const slot = {
    serviceId: 'NODE_ATR_TEST',
    itemId: 'tour',
    date: '2030-01-01',
    timeSlot: '10:00:00',
    slotId: 'slot-20300101-1000',
  };
  const metadata = () => {
    const value = new Metadata();
    value.set('x-api-key', key);
    return value;
  };
  beforeEach(async () => {
    service = {
      availability: mock.fn(async () => ({ availableUnits: 5 })),
      snapshot: mock.fn(async () => ({ success: true })),
      listSlots: mock.fn(async () => ({ slots: [] })),
      reserveBooking: mock.fn(async () => ({ state: 'CONFIRMED' })),
      releaseBooking: mock.fn(async () => ({ state: 'RELEASED' })),
      registerSlots: mock.fn(),
      updateSlot: mock.fn(),
      register: mock.fn(async () => ({ registered: true })),
      delta: mock.fn(async () => true),
    };
    module = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        { provide: InventoryService, useValue: service },
        { provide: InventorySagaService, useValue: { event: mock.fn() } },
        {
          provide: ConfigService,
          useValue: new ConfigService({ INVENTORY_SYNC_API_KEY: key }),
        },
      ],
    }).compile();
    controller = module.get(InventoryController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('consulta disponibilidad conservando fecha, turno e identidad del proveedor', async () => {
    assert.deepEqual(await controller.availability(slot), {
      availableUnits: 5,
    });
    assert.deepEqual(service.availability.mock.calls[0].arguments, [slot]);
  });
  it('rechaza modificaciones sin clave gRPC antes de tocar inventario', () => {
    assert.throws(
      () => controller.releaseBooking({ reservationId }, new Metadata()),
      (error) => error.getError().code === status.UNAUTHENTICATED,
    );
    assert.equal(service.releaseBooking.mock.callCount(), 0);
  });
  it('reserva y libera con la clave correcta sin cambiar la cantidad', async () => {
    const input = {
      reservationId,
      itemId: slot.itemId,
      date: slot.date,
      timeSlot: slot.timeSlot,
      quantity: 5,
    };
    assert.deepEqual(await controller.reserveBooking(input, metadata()), {
      state: 'CONFIRMED',
    });
    assert.deepEqual(service.reserveBooking.mock.calls[0].arguments, [input]);
    assert.deepEqual(
      await controller.releaseBooking({ reservationId }, metadata()),
      { state: 'RELEASED' },
    );
    assert.deepEqual(service.releaseBooking.mock.calls[0].arguments, [
      reservationId,
    ]);
  });
  it('lista turnos solo despues de autenticar la integracion', async () => {
    const input = { itemId: slot.itemId, from: slot.date, to: slot.date };
    assert.deepEqual(await controller.adminList(input, metadata()), {
      slots: [],
    });
    assert.deepEqual(service.listSlots.mock.calls[0].arguments, [input]);
  });
  it('registra un turno HTTP usando el usuario y la clave idempotente', async () => {
    const request = { principal: { userId: '7' } };
    const body = {
      attractionId: '42',
      itemId: slot.itemId,
      date: slot.date,
      timeSlot: slot.timeSlot,
      capacity: 20,
    };
    await controller.register(request, reservationId, body);
    assert.deepEqual(service.register.mock.calls[0].arguments, [
      '7',
      reservationId,
      body,
    ]);
    assert.throws(
      () => controller.register(request, 'invalid', body),
      BadRequestException,
    );
    assert.equal(service.register.mock.callCount(), 1);
  });
  it('procesa cambios del stream en orden y cuenta solo los aplicados', async () => {
    let index = 0;
    service.delta.mock.mockImplementation(async () => ++index === 1);
    const changes = [
      { ...slot, delta: 1 },
      { ...slot, delta: 2 },
    ];
    const result = await firstValueFrom(
      controller.stream(of(...changes), metadata()),
    );
    assert.equal(result.totalEventsProcessed, 1);
    assert.equal(result.isSynchronized, true);
    assert.deepEqual(
      service.delta.mock.calls.map((call) => call.arguments[0]),
      changes,
    );
  });
});
