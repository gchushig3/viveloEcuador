import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GatewayEnvironment } from '../../config/gateway-environment.js';
import { checkGrpcHealth } from './grpc-health.js';

const services = [
  'IDENTITY',
  'CART',
  'BOOKING',
  'CATALOG',
  'INVENTORY',
  'PAYMENT',
  'CLIENTS',
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
    const httpChecks = new Map<string, Promise<boolean>>();
    const available = await Promise.all(
      services.map(async (service) => {
        if (service === 'INVENTORY' && this.env.INVENTORY_GRPC_HEALTH_URL) {
          try { return await checkGrpcHealth(this.env.INVENTORY_GRPC_HEALTH_URL, this.env.INVENTORY_GRPC_HEALTH_TLS ?? true, this.env.HEALTH_TIMEOUT_MS); }
          catch { return false; }
        }
        const url = new URL(
          this.env[`HEALTH_${service}_PATH`],
          this.env[`${service}_URL`],
        );
        const key = url.href;
        let check = httpChecks.get(key);
        if (!check) {
          check = (async () => {
            try {
              const response = await fetch(url, {
                signal: AbortSignal.timeout(this.env.HEALTH_TIMEOUT_MS),
                redirect: 'manual',
              });
              if (!response.ok) return false;
              const body = await response.json() as { status?: string };
              return body.status === 'UP';
            } catch {
              return false;
            }
          })();
          httpChecks.set(key, check);
        }
        return check;
      }),
    );
    return {
      status: available.every(Boolean) ? 'UP' : 'DOWN',
    };
  }
}
