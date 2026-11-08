import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GatewayEnvironment } from '../../config/gateway-environment.js';

const services = [
  'IDENTITY',
  'CART',
  'BOOKING',
  'CATALOG',
  'INVENTORY',
  'PAYMENT',
] as const;

export interface HealthResult {
  status: 'UP' | 'DOWN';
}

@Injectable()
export class HealthService {
  private readonly env: GatewayEnvironment;

  constructor(config: ConfigService<Record<string, unknown>, true>) {
    this.env = config.getOrThrow<GatewayEnvironment>('gateway');
  }

  async check(): Promise<HealthResult> {
    const available = await Promise.all(
      services.map(async (service) => {
        const url = new URL(
          this.env[`HEALTH_${service}_PATH`],
          this.env[`${service}_URL`],
        );
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(this.env.HEALTH_TIMEOUT_MS),
            redirect: 'manual',
          });
          return response.ok;
        } catch {
          return false;
        }
      }),
    );
    return {
      status: available.every(Boolean) ? 'UP' : 'DOWN',
    };
  }
}
