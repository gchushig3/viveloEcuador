import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  OnModuleInit,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientProxyFactory } from '@nestjs/microservices';
import type { ClientProxy } from '@nestjs/microservices';
import type { Response } from 'express';
import { rabbitMqOptions } from '@booking/infrastructure';
import { PublicEndpoint } from '../../common/public-endpoint.decorator.js';
import { BookingCatalogService } from '../../booking/booking-catalog.service.js';
import { BookingReservationsService } from '../../booking/booking-reservations.service.js';

interface ReservationInput {
  atraccion_id: string;
  fecha: string;
  hora: string;
  personas: number;
  cliente_nombre: string;
  cliente_email: string;
  cliente_identificacion?: string;
  cliente_telefono?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTRACTION_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[1-9]\d{0,17})$/i;

export function parseReservation(body: unknown): ReservationInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (value: unknown, fallback = '') =>
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : fallback;
  const id = text(b.atraccion_id ?? b.attraction_id);
  const fecha = text(b.fecha ?? b.date);
  const hora = text(b.hora ?? b.time, '09:00');
  const personas = Number(b.personas ?? b.quantity);
  const nombre = text(b.cliente_nombre ?? b.customer_name).trim();
  const email = text(b.cliente_email ?? b.customer_email).trim();
  const documents = [
    b.cliente_identificacion,
    b.cliente_documento,
    b.customer_identification,
  ]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => {
      if (typeof value !== 'string' && typeof value !== 'number')
        throw new BadRequestException('identificacion invalida');
      return String(value).trim();
    })
    .filter(Boolean);
  if (new Set(documents).size > 1)
    throw new BadRequestException('identificaciones de cliente contradictorias');
  const identificacion = documents[0] ?? '';
  const telefono = text(b.cliente_telefono ?? b.customer_phone).trim();
  if (identificacion.length > 30 || telefono.length > 30)
    throw new BadRequestException('identificacion o telefono invalido');
  if (!ATTRACTION_ID.test(id))
    throw new BadRequestException('atraccion_id invalido');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
    Number.isNaN(Date.parse(fecha)) ||
    new Date(fecha).toISOString().slice(0, 10) !== fecha ||
    fecha <
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Guayaquil',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())
  )
    throw new BadRequestException('fecha invalida (YYYY-MM-DD)');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora))
    throw new BadRequestException('hora invalida (HH:MM)');
  if (!Number.isInteger(personas) || personas < 1 || personas > 100)
    throw new BadRequestException('personas debe ser un entero entre 1 y 100');
  if (!nombre || nombre.length > 200)
    throw new BadRequestException('cliente_nombre invalido');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200)
    throw new BadRequestException('cliente_email invalido');
  return {
    atraccion_id: id,
    fecha,
    hora,
    personas,
    cliente_nombre: nombre,
    cliente_email: email,
    ...(identificacion ? { cliente_identificacion: identificacion } : {}),
    ...(telefono ? { cliente_telefono: telefono } : {}),
  };
}

async function checkDependencies(dataSource: DataSource, config: ConfigService) {
  let databaseConnected = false;
  let rabbitmqConnected = false;
  try {
    await dataSource.query('SELECT 1');
    databaseConnected = true;
  } catch {
    // Both dependencies are checked even when one is unavailable.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let client: ClientProxy | undefined;
  try {
    const options = rabbitMqOptions(config);
    options.options = { ...options.options, noAck: true };
    client = ClientProxyFactory.create(options);
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RabbitMQ timeout')), 3000);
      }),
    ]);
    rabbitmqConnected = true;
  } catch {
    // The dependency remains unavailable.
  } finally {
    if (timer) clearTimeout(timer);
    await client?.close();
  }
  const result = {
    status: databaseConnected && rabbitmqConnected ? 'UP' : 'DOWN',
    database_connected: databaseConnected,
    rabbitmq_connected: rabbitmqConnected,
    service: 'Atracciones',
  };
  return result;
}

/** Semaforo central de Booking: GET /api/v3/health. */
@ApiTags('Booking')
@Controller('health')
export class BookingRootHealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  @PublicEndpoint()
  @Get()
  @ApiOperation({ summary: 'Health central para Booking (incluye PostgreSQL)' })
  async health(@Res({ passthrough: true }) response: Response) {
    const result = await checkDependencies(this.dataSource, this.config);
    if (result.status === 'DOWN') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}

/** Contrato de integracion con Booking; debe registrarse antes de `:id`. */
@ApiTags('Booking')
@Controller('atracciones')
export class BookingContractController implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly catalog: BookingCatalogService,
    private readonly reservations: BookingReservationsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS reserva_atraccion (
        res_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        res_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
        atr_id bigint NOT NULL REFERENCES atraccion(atr_id),
        res_fecha date NOT NULL,
        res_hora time NOT NULL,
        res_personas integer NOT NULL CHECK (res_personas > 0),
        res_cliente_nombre varchar(200) NOT NULL,
        res_cliente_email varchar(200) NOT NULL,
        res_estado varchar(20) NOT NULL DEFAULT 'CONFIRMADA',
        res_creada_en timestamptz NOT NULL DEFAULT now()
      )`);
    await this.dataSource.query(`ALTER TABLE reserva_atraccion
      ADD COLUMN IF NOT EXISTS res_idempotency_key varchar(128),
      ADD COLUMN IF NOT EXISTS res_payload_hash varchar(64)`);
    await this.dataSource
      .query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_idempotency
      ON reserva_atraccion(res_idempotency_key) WHERE res_idempotency_key IS NOT NULL`);
  }

  @PublicEndpoint()
  @Get('health')
  @ApiOperation({ summary: 'Health check para Booking (incluye PostgreSQL)' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'UP' },
        database_connected: { type: 'boolean', example: true },
        service: { type: 'string', example: 'Atracciones' },
      },
    },
  })
  async health(@Res({ passthrough: true }) response: Response) {
    const result = await checkDependencies(this.dataSource, this.config);
    if (result.status === 'DOWN') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }

  @PublicEndpoint()
  @Get('promociones/contrato')
  @ApiOperation({ summary: 'Contrato B2B de promociones con Booking Central' })
  promotionsContract() {
    return {
      proveedor_codigo: 'NODE_ATR_GLORIA',
      nombre_socio: 'Vívelo Ecuador',
      vertical: 'ATRACCIONES',
      permite_promociones: true,
      porcentaje_descuento: 15,
      condiciones_combo:
        'Aplica para reservas combinadas auto + atracción con Booking Central',
    };
  }

  @PublicEndpoint()
  @Post('reservas')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una reserva de atraccion desde Booking' })
  async createReservation(
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    const input = parseReservation(body);
    return this.reservations.create(input, key);
  }

  @PublicEndpoint()
  @Get(':id/disponibilidad')
  @ApiOperation({ summary: 'Consultar disponibilidad de una atraccion' })
  availability(
    @Param('id') id: string,
    @Query('fecha') fecha?: string,
    @Query('personas') personas?: string,
  ) {
    return this.catalog.availability(
      id,
      String(fecha ?? ''),
      personas === undefined ? 1 : Number(personas),
    );
  }

  @PublicEndpoint()
  @Post('reservas/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar una reserva (compensacion Saga)' })
  async cancelReservation(@Param('id') id: string) {
    if (!UUID.test(id)) throw new BadRequestException('reserva_id invalido');
    return this.reservations.cancel(id.toLowerCase());
  }
}
