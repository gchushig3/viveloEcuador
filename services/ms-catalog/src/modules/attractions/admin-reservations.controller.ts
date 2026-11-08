import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { BookingReservationsService } from '../../booking/booking-reservations.service.js';
import { BookingClientsService } from '../../booking/booking-clients.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATES = ['CONFIRMADA', 'CANCELADA', 'PENDIENTE', 'CANCELANDO'];

interface ReservationRow {
  reserva_id: string;
  estado: string;
  atraccion_id: string;
  atraccion: string;
  fecha: string;
  hora: string;
  personas: number;
  cliente_nombre: string;
  cliente_email: string;
  creada_en: string;
  checkin_en: string | null;
  asistentes_reales: number | null;
  booking_notificado: boolean;
}

const SELECT_RESERVATION = `
  SELECT r.res_uuid AS reserva_id, r.res_estado AS estado,
         a.atr_uuid AS atraccion_id, a.atr_nombre AS atraccion,
         to_char(r.res_fecha, 'YYYY-MM-DD') AS fecha,
         to_char(r.res_hora, 'HH24:MI') AS hora,
         r.res_personas AS personas, r.res_cliente_nombre AS cliente_nombre,
         r.res_cliente_email AS cliente_email, r.res_creada_en AS creada_en,
         r.res_checkin_en AS checkin_en, r.res_checkin_asistentes AS asistentes_reales,
         r.res_checkin_notificado AS booking_notificado
    FROM reserva_atraccion r
    JOIN atraccion a ON a.atr_id = r.atr_id`;

function optionalString(value: unknown, name: string, max = 100) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max)
    throw new BadRequestException(`${name} invalido`);
  return value.trim();
}

function optionalDate(value: unknown, name: string) {
  const text = optionalString(value, name, 10);
  if (text === undefined) return undefined;
  if (!DATE.test(text) || Number.isNaN(Date.parse(text)))
    throw new BadRequestException(`${name} invalida (YYYY-MM-DD)`);
  return text;
}

function positiveInt(value: unknown, name: string, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value))
    throw new BadRequestException(`${name} invalido`);
  return Number(value);
}

/** Consulta y operacion administrativa de reservas; el guard global exige ADMIN. */
@ApiTags('Administracion')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({
  description:
    'Requiere access JWT, sesion vigente y rol ADMIN validados por Identity.',
})
@Controller('atracciones/admin')
export class AdminReservationsController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reservations: BookingReservationsService,
    private readonly clients: BookingClientsService,
  ) {}

  @Get('reservas')
  @ApiOperation({ summary: 'Listar reservas con filtros y paginacion' })
  async list(@Query() query: Record<string, unknown>) {
    const allowed = [
      'estado',
      'q',
      'fecha_desde',
      'fecha_hasta',
      'page',
      'limit',
    ];
    if (Object.keys(query).some((key) => !allowed.includes(key)))
      throw new BadRequestException('Parametro de consulta no permitido');
    const estado = optionalString(query.estado, 'estado', 20);
    if (estado !== undefined && !STATES.includes(estado))
      throw new BadRequestException('estado invalido');
    await this.clients.ensureReservationColumns();
    const q = optionalString(query.q, 'q', 100);
    const desde = optionalDate(query.fecha_desde, 'fecha_desde');
    const hasta = optionalDate(query.fecha_hasta, 'fecha_hasta');
    const page = positiveInt(query.page, 'page', 1);
    const limit = positiveInt(query.limit, 'limit', 10);
    if (limit > 100) throw new BadRequestException('limit maximo 100');

    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };
    if (estado) add('r.res_estado = ?', estado);
    if (desde) add('r.res_fecha >= ?', desde);
    if (hasta) add('r.res_fecha <= ?', hasta);
    if (q) {
      const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
      params.push(`%${escaped}%`);
      const n = `$${params.length}`;
      conditions.push(
        `(r.res_cliente_nombre ILIKE ${n} OR r.res_cliente_email ILIKE ${n} OR a.atr_nombre ILIKE ${n} OR r.res_uuid::text ILIKE ${n} OR EXISTS
          (SELECT 1 FROM cliente_atraccion c WHERE c.cli_uuid = r.res_cliente_uuid AND c.cli_identificacion ILIKE ${n}))`,
      );
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const counted = await this.dataSource.query<Array<{ total: number }>>(
      `SELECT count(*)::int AS total FROM reserva_atraccion r
         JOIN atraccion a ON a.atr_id = r.atr_id ${where}`,
      params,
    );
    const total = counted[0]?.total ?? 0;
    const items = await this.dataSource.query<ReservationRow[]>(
      `${SELECT_RESERVATION} ${where}
        ORDER BY r.res_creada_en DESC, r.res_id DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return {
      items,
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  @Get('reservas/:id')
  @ApiOperation({ summary: 'Consultar una reserva' })
  async detail(@Param('id') id: string) {
    if (!UUID.test(id)) throw new BadRequestException('reserva_id invalido');
    await this.clients.ensureReservationColumns();
    const rows = await this.dataSource.query<ReservationRow[]>(
      `${SELECT_RESERVATION} WHERE r.res_uuid = $1`,
      [id.toLowerCase()],
    );
    if (!rows.length) throw new NotFoundException('Reserva no encontrada');
    return rows[0];
  }

  @Post('reservas/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar una reserva desde administracion' })
  async cancel(@Param('id') id: string) {
    if (!UUID.test(id)) throw new BadRequestException('reserva_id invalido');
    await this.reservations.cancel(id.toLowerCase());
    return this.detail(id);
  }

  @Get('resumen')
  @ApiOperation({
    summary: 'Resumen operativo para el panel de administracion',
  })
  async summary() {
    await this.clients.ensureReservationColumns();
    const [reservations] = await this.dataSource.query<
      Array<Record<string, number>>
    >(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE res_estado = 'CONFIRMADA')::int AS confirmadas,
             count(*) FILTER (WHERE res_estado = 'CANCELADA')::int AS canceladas,
             count(*) FILTER (WHERE res_estado = 'CONFIRMADA'
                                AND res_fecha = CURRENT_DATE)::int AS hoy,
             count(*) FILTER (WHERE res_estado = 'CONFIRMADA'
                                AND res_fecha > CURRENT_DATE)::int AS proximas,
             count(*) FILTER (WHERE res_creada_en >= now() - interval '24 hours')::int AS ultimas_24h,
             coalesce(sum(res_personas) FILTER (WHERE res_estado = 'CONFIRMADA'
                                AND res_fecha >= CURRENT_DATE), 0)::int AS personas_proximas
        FROM reserva_atraccion`);
    const [attractions] = await this.dataSource.query<
      Array<Record<string, number>>
    >(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE atr_estado = 'PUBLICADA')::int AS publicadas,
             count(*) FILTER (WHERE atr_estado = 'BORRADOR')::int AS borradores,
             count(*) FILTER (WHERE atr_estado = 'INACTIVA')::int AS inactivas
        FROM atraccion WHERE atr_eliminado_en IS NULL`);
    const top = await this.dataSource.query<unknown[]>(`
      SELECT a.atr_uuid AS atraccion_id, a.atr_nombre AS atraccion,
             count(*)::int AS reservas, sum(r.res_personas)::int AS personas
        FROM reserva_atraccion r JOIN atraccion a ON a.atr_id = r.atr_id
       WHERE r.res_estado = 'CONFIRMADA'
       GROUP BY a.atr_uuid, a.atr_nombre
       ORDER BY reservas DESC, a.atr_nombre
       LIMIT 5`);
    const recent = await this.dataSource.query<ReservationRow[]>(
      `${SELECT_RESERVATION} ORDER BY r.res_creada_en DESC, r.res_id DESC LIMIT 5`,
    );
    return {
      reservas: reservations,
      atracciones: attractions,
      top_atracciones: top,
      recientes: recent,
    };
  }
}
