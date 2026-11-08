import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { GatewayEnvironment } from '../../config/gateway-environment.js';
import type { Request } from 'express';

const services = [
  'auth',
  'cart',
  'booking',
  'catalog',
  'inventory',
  'payment',
  'audit',
] as const;

type ServiceEnvironmentName =
  | 'IDENTITY'
  | 'CART'
  | 'BOOKING'
  | 'CATALOG'
  | 'INVENTORY'
  | 'PAYMENT'
  | 'AUDIT';

const environmentNames: Record<
  (typeof services)[number],
  ServiceEnvironmentName
> = {
  auth: 'IDENTITY',
  cart: 'CART',
  booking: 'BOOKING',
  catalog: 'CATALOG',
  inventory: 'INVENTORY',
  payment: 'PAYMENT',
  audit: 'AUDIT',
};

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

interface Target {
  origin: URL;
  path: string;
}

@Injectable()
export class ProxyService {
  private readonly env: GatewayEnvironment;

  constructor(config: ConfigService<Record<string, unknown>, true>) {
    this.env = config.getOrThrow<GatewayEnvironment>('gateway');
  }

  async forward(
    incoming: IncomingMessage & Pick<Request, 'originalUrl' | 'user' | 'correlationId'>,
    outgoing: ServerResponse,
  ): Promise<void> {
    const target = this.resolveTarget(incoming.originalUrl ?? incoming.url ?? '/');
    const headers = this.requestHeaders(incoming.headers, incoming);
    const request = (target.origin.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        protocol: target.origin.protocol,
        hostname: target.origin.hostname,
        port: target.origin.port || undefined,
        method: incoming.method,
        path: target.path,
        headers,
      },
      (upstream) => this.copyResponse(upstream, outgoing),
    );
    request.setTimeout(this.env.PROXY_TIMEOUT_MS, () => {
      request.destroy(Object.assign(new Error('Upstream timed out'), { code: 'ETIMEDOUT' }));
    });
    incoming.once('aborted', () => request.destroy(new Error('Client aborted request')));
    outgoing.once('close', () => {
      if (!outgoing.writableEnded) request.destroy(new Error('Client disconnected'));
    });
    incoming.pipe(request);
    await new Promise<void>((resolve, reject) => {
      request.once('error', (error: NodeJS.ErrnoException) => {
        if (outgoing.headersSent) {
          outgoing.destroy(error);
          resolve();
          return;
        }
        reject(
          error.code === 'ETIMEDOUT'
            ? new GatewayTimeoutException('Upstream request timed out')
            : new BadGatewayException('Upstream service unavailable'),
        );
      });
      outgoing.once('finish', resolve);
      outgoing.once('close', resolve);
    });
  }

  private resolveTarget(rawUrl: string): Target {
    const match = /^\/api\/v[123]\/([^/?]+)(\/[^?]*)?(\?.*)?$/.exec(rawUrl);
    const service = match?.[1];
    if (!match || !service || !(services as readonly string[]).includes(service))
      throw new NotFoundException('Unknown API route');
    const name = environmentNames[service as (typeof services)[number]];
    const base = new URL(this.env[`${name}_URL`]);
    const prefix = this.env[`${name}_API_PREFIX`];
    const suffix = match[2] ?? '';
    const path = `${prefix === '/' ? '' : prefix}${suffix}${match[3] ?? ''}` || '/';
    return { origin: base, path };
  }

  private requestHeaders(
    source: IncomingHttpHeaders,
    incoming: IncomingMessage & Pick<Request, 'user' | 'correlationId'>,
  ): IncomingHttpHeaders {
    const connectionHeaders = new Set(
      (source.connection ?? '')
        .split(',')
        .map((header) => header.trim().toLowerCase()),
    );
    const headers: IncomingHttpHeaders = {};
    for (const [key, value] of Object.entries(source)) {
      const normalized = key.toLowerCase();
      if (
        hopByHopHeaders.has(normalized) ||
        connectionHeaders.has(normalized) ||
        normalized === 'host' ||
        normalized.startsWith('x-user-') ||
        normalized.startsWith('x-forwarded-') ||
        normalized === 'forwarded'
      )
        continue;
      headers[normalized] = value;
    }
    if (incoming.correlationId)
      headers['x-correlation-id'] = incoming.correlationId;
    if (incoming.user) {
      headers['x-user-id'] = incoming.user.id;
      headers['x-user-role'] = incoming.user.roles.join(',');
      if (incoming.user.email) headers['x-user-email'] = incoming.user.email;
    }
    return headers;
  }

  private copyResponse(
    upstream: IncomingMessage,
    outgoing: ServerResponse,
  ): void {
    outgoing.statusCode = upstream.statusCode ?? 502;
    for (const [key, value] of Object.entries(upstream.headers)) {
      if (value !== undefined && !hopByHopHeaders.has(key.toLowerCase()))
        outgoing.setHeader(key, value);
    }
    upstream.once('error', (error) => outgoing.destroy(error));
    upstream.pipe(outgoing);
  }
}
