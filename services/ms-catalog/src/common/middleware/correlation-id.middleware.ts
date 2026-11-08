import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('BookingHttp');

export interface RequestWithCorrelationId extends Request {
  correlationId?: string;
}

export function correlationIdMiddleware(
  req: RequestWithCorrelationId,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('x-correlation-id');
  const correlationId =
    typeof incoming === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(incoming)
      ? incoming.trim()
      : randomUUID();

  req.correlationId = correlationId;
  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  const path = req.path;
  const logged =
    (req.method === 'GET' && path === '/api/v2/clientes') ||
    (req.method === 'POST' &&
      (path === '/api/v2/atracciones/reservas' ||
        /^\/api\/v2\/atracciones\/reservas\/[^/]+\/checkin$/.test(path)));
  if (logged) {
    const operation = path.endsWith('/checkin')
      ? 'checkin'
      : path.endsWith('/clientes')
        ? 'clientes_consulta'
        : 'reserva';
    logger.log({ event: 'solicitud_recibida', operation, correlation_id: correlationId });
    res.once('finish', () =>
      logger.log({
        event: 'solicitud_completada',
        operation,
        correlation_id: correlationId,
        status_code: res.statusCode,
      }),
    );
  }
  next();
}
