import { BadRequestException, ConflictException } from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';

export const cancellationResponseSchema: SchemaObject = {
  type: 'object',
  required: [
    'status',
    'cancel_code',
    'reembolso_id',
    'monto_reembolsado',
    'refund',
    'stock_restoration',
    'message',
  ],
  properties: {
    reserva_id: { type: 'string' },
    estado: { type: 'string', enum: ['CANCELADA'] },
    status: { type: 'string', enum: ['CANCELLED'] },
    cancel_code: { type: 'string' },
    reembolso_id: { type: 'string' },
    monto_reembolsado: { type: 'number', minimum: 0 },
    message: { type: 'string' },
    refund: {
      type: 'object',
      required: ['refund_id', 'status', 'amount', 'currency', 'message'],
      properties: {
        refund_id: { type: 'string' },
        status: { type: 'string', enum: ['PROCESSED'] },
        amount: { type: 'number', minimum: 0 },
        currency: { type: 'string' },
        message: { type: 'string' },
      },
    },
    stock_restoration: {
      type: 'object',
      required: ['status', 'restored_spots', 'message'],
      properties: {
        status: { type: 'string', enum: ['RESTORED'] },
        restored_spots: { type: 'integer', minimum: 0 },
        message: { type: 'string' },
      },
    },
  },
};

export function validateCancellation(
  body: unknown,
  key?: string,
  correlation?: string,
) {
  if (
    body !== undefined &&
    body !== null &&
    (typeof body !== 'object' || Array.isArray(body))
  )
    throw new BadRequestException('Cuerpo de cancelacion invalido');
  const reason = (body as { reason?: unknown } | undefined | null)?.reason;
  if (
    reason !== undefined &&
    (typeof reason !== 'string' || reason.length > 500)
  )
    throw new BadRequestException('reason invalido (maximo 500 caracteres)');
  for (const value of [key, correlation])
    if (value !== undefined && !/^[\w.-]{1,128}$/.test(value))
      throw new BadRequestException('Header de cancelacion invalido');
}

export function assertCancellable(state: string, checkin?: unknown) {
  if (
    checkin ||
    ['CHECKED_IN', 'CONFIRMADO_ASISTIDO', 'COMPLETED'].includes(state)
  )
    throw new ConflictException({
      title: 'Cancelación No Permitida',
      detail:
        'No se puede cancelar una reserva que ya realizó check-in o fue asistida.',
      status: 409,
    });
}

export function assertCancellationDeadline(
  date: string,
  time: string,
  now = Date.now(),
) {
  // Los turnos del operador usan America/Guayaquil (UTC-05:00).
  const startsAt = Date.parse(`${date}T${time}-05:00`);
  if (!Number.isFinite(startsAt) || startsAt - now < 86_400_000)
    throw new ConflictException({
      title: 'Cancelación Fuera de Plazo',
      detail:
        'La cancelación y reembolso solo están permitidos con al menos 24 horas de anticipación al horario reservado.',
      status: 409,
    });
}

export function cancellationReceipt(
  id: string,
  spots: number,
  amount: number,
  currency: string,
) {
  const code = `REF-ATR-${id}`;
  return {
    reserva_id: id,
    estado: 'CANCELADA',
    status: 'CANCELLED',
    cancel_code: code,
    reembolso_id: code,
    monto_reembolsado: amount,
    refund: {
      refund_id: code,
      status: 'PROCESSED',
      amount,
      currency,
      message: 'Reembolso simulado del 100% procesado.',
    },
    stock_restoration: {
      status: 'RESTORED',
      restored_spots: spots,
      message: 'Cupos reincorporados a la disponibilidad del operador local.',
    },
    message: 'Reserva cancelada exitosamente y cupos restituidos.',
  };
}
