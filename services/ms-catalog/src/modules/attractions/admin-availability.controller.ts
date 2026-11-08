import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { AtraccionEntity } from '../../database/entities/atraccion.entity.js';
import { BookingProfileEntity } from '../../booking/booking-profile.entity.js';
import { InventoryAdminService } from '../../booking/inventory-admin.service.js';

const DAY_MS = 86_400_000;
const MAX_LIST_DAYS = 93;
const MAX_REGISTER_DAYS = 120;

function parseDate(value: unknown, field: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException(`${field} debe tener formato YYYY-MM-DD`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException(`${field} no es una fecha valida`);
  return time;
}

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function parseTime(value: unknown): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new BadRequestException('Las horas deben tener formato HH:MM');
  return value;
}

function parseCapacity(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 100000
  )
    throw new BadRequestException(
      'capacity debe ser un entero entre 1 y 100000',
    );
  return value as number;
}

/** Gestion de cupos por fecha y horario; el guard global exige ADMIN. */
@ApiTags('Administracion')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({
  description:
    'Requiere access JWT, sesion vigente y rol ADMIN validados por Identity.',
})
@Controller('atracciones/admin/:id/cupos')
export class AdminAvailabilityController {
  constructor(
    @InjectRepository(AtraccionEntity)
    private readonly attractions: Repository<AtraccionEntity>,
    @InjectRepository(BookingProfileEntity)
    private readonly profiles: Repository<BookingProfileEntity>,
    private readonly inventory: InventoryAdminService,
  ) {}

  private async attraction(id: string) {
    const item = await this.attractions
      .createQueryBuilder('a')
      .where(
        '(a.atr_uuid::text = :id OR a.atr_slug = :id OR a.atr_id::text = :id)',
        { id },
      )
      .getOne();
    if (!item) throw new NotFoundException('Atraccion no encontrada');
    return item;
  }

  @Get()
  @ApiOperation({
    summary: 'Cupos registrados de una atraccion por rango de fechas',
  })
  async list(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const item = await this.attraction(id);
    const start = from
      ? parseDate(from, 'from')
      : parseDate(iso(Date.now()), 'from');
    const end = to ? parseDate(to, 'to') : start + 29 * DAY_MS;
    if (end < start)
      throw new BadRequestException('to debe ser posterior a from');
    if ((end - start) / DAY_MS >= MAX_LIST_DAYS)
      throw new BadRequestException(
        `El rango maximo es de ${MAX_LIST_DAYS} dias`,
      );
    const profile = await this.profiles.findOne({
      where: { atr_id: item.atr_id },
    });
    return {
      attraction: { id: item.atr_uuid, name: item.atr_nombre },
      from: iso(start),
      to: iso(end),
      schedule_times: (profile?.payload.schedule_times ?? []).map((t) =>
        t.slice(0, 5),
      ),
      slots: await this.inventory.list(item.atr_uuid, iso(start), iso(end)),
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Crear cupos para un rango de fechas y uno o varios horarios',
  })
  async register(
    @Param('id') id: string,
    @Body()
    body: {
      from?: string;
      to?: string;
      weekdays?: number[];
      times?: string[];
      capacity?: number;
    },
  ) {
    const item = await this.attraction(id);
    const start = parseDate(body?.from, 'from');
    const end = parseDate(body?.to ?? body?.from, 'to');
    if (end < start)
      throw new BadRequestException('to debe ser posterior a from');
    if (iso(start) < iso(Date.now()))
      throw new BadRequestException(
        'No se pueden crear cupos en fechas pasadas',
      );
    if ((end - start) / DAY_MS >= MAX_REGISTER_DAYS)
      throw new BadRequestException(
        `El rango maximo es de ${MAX_REGISTER_DAYS} dias`,
      );
    const times = [...new Set((body?.times ?? []).map(parseTime))];
    if (!times.length || times.length > 24)
      throw new BadRequestException('Indica entre 1 y 24 horarios');
    const capacity = parseCapacity(body?.capacity);
    const weekdays = body?.weekdays;
    if (
      weekdays !== undefined &&
      (!Array.isArray(weekdays) ||
        !weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    )
      throw new BadRequestException(
        'weekdays debe contener enteros de 0 (domingo) a 6',
      );
    const dates: string[] = [];
    for (let t = start; t <= end; t += DAY_MS)
      if (!weekdays?.length || weekdays.includes(new Date(t).getUTCDay()))
        dates.push(iso(t));
    if (!dates.length)
      throw new BadRequestException(
        'El rango no incluye ningun dia seleccionado',
      );
    const result = await this.inventory.register({
      attractionId: item.atr_id,
      itemId: item.atr_uuid,
      dates,
      timeSlots: times.map((t) => `${t}:00`),
      capacity,
    });
    // La busqueda por fecha consulta los horarios del perfil Booking; se mantienen alineados.
    const profile = await this.profiles.findOne({
      where: { atr_id: item.atr_id },
    });
    if (profile) {
      const merged = [
        ...new Set([
          ...(profile.payload.schedule_times ?? []).map((t) => t.slice(0, 5)),
          ...times,
        ]),
      ].sort();
      profile.payload = {
        ...profile.payload,
        schedule_times: merged.map((t) => `${t}:00`),
      };
      await this.profiles.save(profile);
    }
    return { ...result, dates: dates.length, times: times.length };
  }

  @Patch()
  @ApiOperation({ summary: 'Cambiar capacidad o cerrar/abrir un cupo' })
  async update(
    @Param('id') id: string,
    @Body()
    body: { date?: string; time?: string; capacity?: number; closed?: boolean },
  ) {
    const item = await this.attraction(id);
    parseDate(body?.date, 'date');
    const time = parseTime(body?.time);
    const capacity = parseCapacity(body?.capacity);
    if (body?.closed !== undefined && typeof body.closed !== 'boolean')
      throw new BadRequestException('closed debe ser booleano');
    return this.inventory.update({
      itemId: item.atr_uuid,
      date: body.date as string,
      timeSlot: `${time}:00`,
      capacity,
      closed: body.closed === true,
    });
  }
}
