import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GatewayEnvironment } from '../../config/gateway-environment.js';
import type { Request, Response } from 'express';

interface RateWindow {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly windows = new Map<string, RateWindow>();
  private readonly limits: Record<string, number>;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(config: ConfigService<Record<string, unknown>, true>) {
    const env = config.getOrThrow<GatewayEnvironment>('gateway');
    this.limits = {
      ADMIN: env.RATE_LIMIT_ADMIN,
      CUSTOMER: env.RATE_LIMIT_CUSTOMER,
      PARTNER: env.RATE_LIMIT_PARTNER,
      ANONYMOUS: 100,
    };
    this.cleanupTimer = setInterval(() => this.removeExpired(), 60000);
    this.cleanupTimer.unref();
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const identity = request.user?.id ?? request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const role =
      ['ADMIN', 'PARTNER', 'CUSTOMER'].find((candidate) =>
        request.user?.roles.includes(candidate),
      ) ?? 'ANONYMOUS';
    const limit = this.limits[role] ?? this.limits.ANONYMOUS ?? 100;
    const now = Date.now();
    const key = `${request.user ? 'user' : 'ip'}:${identity}`;
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      if (this.windows.size >= 100000) this.removeExpired(now);
      if (this.windows.size >= 100000)
        throw new ServiceUnavailableException('Rate limiter capacity reached');
      window = { count: 0, resetAt: now + 60000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('RateLimit-Limit', String(limit));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, limit - window.count)));
    response.setHeader('RateLimit-Reset', String(Math.ceil(window.resetAt / 1000)));
    if (window.count > limit)
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    return true;
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    this.windows.clear();
  }

  private removeExpired(now = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
