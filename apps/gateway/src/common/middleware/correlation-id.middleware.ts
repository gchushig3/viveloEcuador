import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      requestStartedAt?: number;
      accessLogAttached?: boolean;
      user?: {
        id: string;
        email?: string;
        roles: string[];
      };
    }
  }
}

const validCorrelationId = /^[A-Za-z0-9._:-]{1,128}$/;

@Injectable()
export class CorrelationIdMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    request.requestStartedAt = performance.now();
    const supplied = request.headers['x-correlation-id'];
    if (Array.isArray(supplied) || supplied && !validCorrelationId.test(supplied)) {
      next(new BadRequestException('Invalid X-Correlation-Id'));
      return;
    }
    const correlationId = supplied ?? randomUUID();
    request.correlationId = correlationId;
    response.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
