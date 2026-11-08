import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { BookingClientsService } from './booking-clients.service.js';

export interface CheckinInput {
  asistentes_reales?: number;
  admin_id?: string;
  observaciones?: string;
  documento_identidad?: string;
  guia_codigo?: string;
  codigo_voucher_qr?: string;
}

interface CheckinRow {
  res_uuid: string;
  res_estado: string;
  res_personas: number;
  res_cliente_nombre: string;
  res_cliente_email: string;
  res_cliente_uuid: string | null;
  identificacion: string | null;
  res_checkin_en: Date | null;
  res_checkin_asistentes: number | null;
  res_checkin_admin: string | null;
  res_checkin_observaciones: string | null;
  res_checkin_notificado: boolean;
  atr_nombre: string;
  fecha: string;
  hora: string;
}

const DEFAULT_ADMIN = 'guia-turistico';
const DEFAULT_NOTES =
  'Turista validado en punto de encuentro con codigo QR y cedula fisica';
const DEFAULT_BOOKING_URL = 'https://booking-core-api.azurewebsites.net';

export function parseCheckinInput(body: unknown): CheckinInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const input: CheckinInput = {};
  if (b.asistentes_reales !== undefined) {
    const n = b.asistentes_reales;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1)
      throw new BadRequestException('asistentes_reales invalido');
    input.asistentes_reales = n;
  }
  for (const [key, max] of [
    ['admin_id', 100],
    ['observaciones', 500],
    ['documento_identidad', 30],
    ['guia_codigo', 100],
    ['codigo_voucher_qr', 200],
  ] as const) {
    const value = b[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.trim().length > max)
      throw new BadRequestException(`${key} invalido`);
    input[key] = value.trim();
  }
  return input;
}

@Injectable()
export class BookingCheckinService {
  private readonly logger = new Logger(BookingCheckinService.name);

  constructor(
    private readonly source: DataSource,
    private readonly clients: BookingClientsService,
    private readonly config: ConfigService,
  ) {}

  async checkin(id: string, input: CheckinInput) {
    await this.clients.ensureReservationColumns();
    const row = await this.source.transaction(async (manager) => {
      const [current] = await manager.query<CheckinRow[]>(
        `SELECT r.res_uuid::text AS res_uuid, r.res_estado, r.res_personas,
                r.res_cliente_nombre, r.res_cliente_email, r.res_cliente_uuid::text AS res_cliente_uuid,
                r.res_checkin_en, r.res_checkin_asistentes, r.res_checkin_admin,
                r.res_checkin_observaciones, r.res_checkin_notificado,
                (SELECT c.cli_identificacion FROM cliente_atraccion c
                  WHERE c.cli_uuid = r.res_cliente_uuid) AS identificacion,
                a.atr_nombre, to_char(r.res_fecha,'YYYY-MM-DD') AS fecha,
                to_char(r.res_hora,'HH24:MI') AS hora
           FROM reserva_atraccion r JOIN atraccion a USING (atr_id)
          WHERE r.res_uuid = $1 FOR UPDATE OF r`,
        [id],
      );
      if (!current) throw new NotFoundException('Reserva no encontrada');
      if (current.res_estado !== 'CONFIRMADA')
        throw new ConflictException(
          'Solo una reserva CONFIRMADA admite check-in',
        );
      const { client } = await this.clients.register(
        {
          nombre: current.res_cliente_nombre,
          email: current.res_cliente_email.toLowerCase(),
          identificacion: input.documento_identidad,
        },
        manager,
      );
      if (current.res_checkin_en) {
        return { ...current, identificacion: client.identificacion };
      }
      const asistentes = input.asistentes_reales ?? current.res_personas;
      if (asistentes > current.res_personas)
        throw new BadRequestException(
          'asistentes_reales excede las personas reservadas',
        );
      const admin = input.admin_id ?? input.guia_codigo ?? DEFAULT_ADMIN;
      const notes = input.observaciones ?? DEFAULT_NOTES;
      const [saved] = await manager.query<Array<{ res_checkin_en: Date }>>(
        `UPDATE reserva_atraccion
            SET res_checkin_en = now(), res_checkin_asistentes = $2,
                res_checkin_admin = $3, res_checkin_observaciones = $4,
                res_cliente_uuid = $5::uuid
          WHERE res_uuid = $1 RETURNING res_checkin_en`,
        [id, asistentes, admin, notes, client.client_id],
      );
      return {
        ...current,
        identificacion: client.identificacion,
        res_cliente_uuid: client.client_id,
        res_checkin_en: saved?.res_checkin_en ?? new Date(),
        res_checkin_asistentes: asistentes,
        res_checkin_admin: admin,
        res_checkin_observaciones: notes,
      };
    });

    let notified = row.res_checkin_notificado;
    let error: string | undefined;
    if (!notified) {
      const result = await this.notifyBooking(row);
      notified = result.ok;
      error = result.error;
      if (notified)
        await this.source.query(
          'UPDATE reserva_atraccion SET res_checkin_notificado = true WHERE res_uuid = $1',
          [id],
        );
    }
    const when = new Date(row.res_checkin_en as Date).toISOString();
    return {
      reserva_id: row.res_uuid,
      reservation_code: row.res_uuid,
      estado: 'CHECKED_IN',
      estado_booking: 'CONFIRMADO_ASISTIDO',
      client_id: row.res_cliente_uuid,
      titular_nombre: row.res_cliente_nombre,
      titular_documento: row.identificacion,
      guia_asignado: row.res_checkin_admin,
      hora_checkin: when,
      fecha_checkin: when,
      asistentes_reales: row.res_checkin_asistentes,
      pase_abordar_qr: `ATR-CHECKIN:${row.res_uuid}`,
      pase_abordar: {
        codigo: row.res_uuid,
        qr: `ATR-CHECKIN:${row.res_uuid}`,
        atraccion: row.atr_nombre,
        fecha: row.fecha,
        hora: row.hora,
        titular: row.res_cliente_nombre,
        asistentes: row.res_checkin_asistentes,
      },
      booking_notificado: notified,
      ...(error ? { booking_error: error } : {}),
    };
  }

  private async notifyBooking(
    row: CheckinRow,
  ): Promise<{ ok: boolean; error?: string }> {
    const key = this.config.get<string>('BOOKING_CORE_API_KEY')?.trim();
    if (!key) return { ok: false, error: 'API key de Booking no configurada' };
    if (!row.identificacion)
      return { ok: false, error: 'Documento de identidad requerido para Booking' };
    const base = (
      this.config.get<string>('BOOKING_CORE_URL') ?? DEFAULT_BOOKING_URL
    ).replace(/\/+$/, '');
    try {
      const response = await fetch(
        `${base}/api/v3/atracciones/reservas/${encodeURIComponent(row.res_uuid)}/checkin`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({
            documento_identidad: row.identificacion,
            guia_asignado: row.res_checkin_admin,
          }),
          signal: AbortSignal.timeout(8000),
        },
      );
      if (response.status !== 200) {
        this.logger.warn(`Booking check-in rechazado: HTTP ${response.status}`);
        return {
          ok: false,
          error: `Booking respondio HTTP ${response.status}`,
        };
      }
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('estado' in body) ||
        body.estado !== 'CHECKED_IN'
      ) {
        this.logger.warn('Booking no confirmo el estado de asistencia');
        return { ok: false, error: 'Booking no confirmo el estado de asistencia' };
      }
      return { ok: true };
    } catch {
      this.logger.warn('Booking check-in no disponible');
      return { ok: false, error: 'Booking no disponible' };
    }
  }
}
