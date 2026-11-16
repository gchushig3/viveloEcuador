import { HttpStatus, ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { CrearPagoRequestDto } from './dto/crear-pago-request.dto.js';
import { ListarPagosQueryDto } from './dto/listar-pagos-query.dto.js';
import { PagoResponseDto } from './dto/pago-response.dto.js';
import { PagoController } from './pago.controller.js';
import { PagoService } from './pago.service.js';
import { SimularPagoRequestDto } from './dto/simular-pago-request.dto.js';

describe('PagoController', () => {
  const pago = { id: '42' } as PagoResponseDto;
  const crear = vi.fn<PagoService['crear']>();
  const listar = vi.fn<PagoService['listar']>();
  const obtenerPorId = vi.fn<PagoService['obtenerPorId']>();
  const simular = vi.fn<PagoService['simular']>();
  const pagoService = {
    crear,
    listar,
    obtenerPorId,
    simular,
  };
  let controller: PagoController;
  let module: TestingModule;

  beforeEach(async () => {
    vi.resetAllMocks();
    module = await Test.createTestingModule({
      controllers: [PagoController],
      providers: [{ provide: PagoService, useValue: pagoService }],
    }).compile();
    controller = module.get(PagoController);
  });
  afterEach(async () => {
    await module?.close();
  });

  it('propaga conflictos sin anunciar un pago creado', async () => {
    const error = new ConflictException('Numero de pago duplicado');
    crear.mockRejectedValue(error);
    const response = { status: vi.fn(), setHeader: vi.fn() };
    await expect(
      controller.crear(
        {
          numero: 'PAY-1',
          orden_id: '42',
          metodo_codigo: 'TARJETA',
          monto: '1.00',
        },
        response as unknown as Response,
      ),
    ).rejects.toBe(error);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('delegates creation and sets 201 with a Location header', async () => {
    const request = {
      numero: 'PAY-1',
      orden_id: '42',
      metodo_codigo: 'TARJETA',
      monto: '1.00',
    } satisfies CrearPagoRequestDto;
    const setStatus = vi.fn();
    const setHeader = vi.fn();
    const response = { status: setStatus, setHeader } as unknown as Response;
    crear.mockResolvedValue({ status: HttpStatus.CREATED, pago });

    await expect(controller.crear(request, response)).resolves.toBe(pago);

    expect(crear).toHaveBeenCalledWith(request);
    expect(setStatus.mock.calls).toEqual([[HttpStatus.CREATED]]);
    expect(setHeader.mock.calls).toEqual([['Location', '/api/v2/pagos/42']]);
  });

  it('delegates equivalent retries with 200 and omits Location', async () => {
    const setStatus = vi.fn();
    const setHeader = vi.fn();
    const response = { status: setStatus, setHeader } as unknown as Response;
    crear.mockResolvedValue({ status: HttpStatus.OK, pago });

    await controller.crear(
      {
        numero: 'PAY-1',
        orden_id: '42',
        metodo_codigo: 'TARJETA',
        monto: '1.00',
      },
      response,
    );

    expect(setStatus.mock.calls).toEqual([[HttpStatus.OK]]);
    expect(setHeader.mock.calls).toHaveLength(0);
  });

  it('delegates list filters and BIGINT identifiers to the service', async () => {
    const query: ListarPagosQueryDto = {
      estado: 'PENDIENTE',
      limit: 20,
      offset: 0,
    };

    await controller.listar(query);
    await controller.obtenerPorId('9007199254740993');

    expect(listar).toHaveBeenCalledWith(query);
    expect(obtenerPorId).toHaveBeenCalledWith('9007199254740993');
  });

  it('delegates simulation result and request to the service', async () => {
    const body: SimularPagoRequestDto = {
      resultado: 'RECHAZADO',
      motivo: 'Rechazado por prueba',
    };
    simular.mockResolvedValue(pago);

    await expect(controller.simular('9007199254740993', body)).resolves.toBe(
      pago,
    );

    expect(simular).toHaveBeenCalledWith('9007199254740993', body);
  });
});
