import type { GatewayEnvironment } from './gateway-environment.js';

const serviceNames = [
  'IDENTITY',
  'CART',
  'BOOKING',
  'CATALOG',
  'INVENTORY',
  'PAYMENT',
  'AUDIT',
] as const;

const healthServiceNames = [
  'IDENTITY',
  'CART',
  'BOOKING',
  'CATALOG',
  'INVENTORY',
  'PAYMENT',
] as const;

const defaultPrefixes: Record<(typeof serviceNames)[number], string> = {
  IDENTITY: '/api/v2/auth',
  CART: '/api/v2/cart',
  BOOKING: '/api/v3/atracciones/reservas',
  CATALOG: '/api/v2',
  INVENTORY: '/api/v2/inventory',
  PAYMENT: '/api/v2',
  AUDIT: '/api/v2/audit',
};

function requiredString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Missing configuration: ${key}`);
  return value.trim();
}

function integer(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = source[key] ?? fallback;
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d+$/.test(String(value))
  )
    throw new Error(`Invalid configuration: ${key}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`Invalid configuration: ${key}`);
  return parsed;
}

function serviceUrl(source: Record<string, unknown>, key: string): string {
  const value = requiredString(source, key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid configuration: ${key}`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(`Invalid configuration: ${key}`);
  return url.origin;
}

function apiPrefix(source: Record<string, unknown>, service: string): string {
  const key = `${service}_API_PREFIX`;
  const value = source[key] ?? defaultPrefixes[service as keyof typeof defaultPrefixes];
  if (
    typeof value !== 'string' ||
    !/^\/[A-Za-z0-9._/-]*$/.test(value) ||
    value.includes('//') ||
    value.split('/').includes('..')
  )
    throw new Error(`Invalid configuration: ${key}`);
  return value.replace(/\/+$/, '') || '/';
}

function healthPath(source: Record<string, unknown>, service: string): string {
  const key = `HEALTH_${service}_PATH`;
  const value = source[key] ?? '/api/v2/health/ready';
  if (
    typeof value !== 'string' ||
    !/^\/[A-Za-z0-9._/-]*$/.test(value) ||
    value.includes('//') ||
    value.split('/').includes('..')
  )
    throw new Error(`Invalid configuration: ${key}`);
  return value;
}

function corsOrigins(source: Record<string, unknown>): string[] {
  const raw = source.CORS_ORIGINS ?? '';
  if (typeof raw !== 'string') throw new Error('Invalid configuration: CORS_ORIGINS');
  const values = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (values.includes('*') && values.length !== 1)
    throw new Error('CORS_ORIGINS cannot combine * with explicit origins');
  for (const origin of values) {
    if (origin === '*') continue;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('Invalid configuration: CORS_ORIGINS');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error('Invalid configuration: CORS_ORIGINS');
  }
  return values;
}

export function validateEnvironment(
  source: Record<string, unknown>,
): GatewayEnvironment {
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (
    typeof nodeEnv !== 'string' ||
    !['development', 'test', 'production'].includes(nodeEnv)
  )
    throw new Error('Invalid configuration: NODE_ENV');

  const services = Object.fromEntries(
    serviceNames.map((name) => [
      `${name}_URL`,
      serviceUrl(source, `${name}_URL`),
    ]),
  ) as Pick<GatewayEnvironment, `${(typeof serviceNames)[number]}_URL`>;
  const prefixes = Object.fromEntries(
    serviceNames.map((name) => [
      `${name}_API_PREFIX`,
      apiPrefix(source, name),
    ]),
  ) as Pick<
    GatewayEnvironment,
    `${(typeof serviceNames)[number]}_API_PREFIX`
  >;
  const healthPaths = Object.fromEntries(
    healthServiceNames.map((name) => [
      `HEALTH_${name}_PATH`,
      healthPath(source, name),
    ]),
  ) as Pick<
    GatewayEnvironment,
    `HEALTH_${(typeof healthServiceNames)[number]}_PATH`
  >;

  const identityUrl = services.IDENTITY_URL;
  const jwksUrl = source.JWT_JWKS_URL ?? `${identityUrl}/api/v2/.well-known/jwks.json`;
  if (typeof jwksUrl !== 'string') throw new Error('Invalid configuration: JWT_JWKS_URL');
  let parsedJwksUrl: URL;
  try {
    parsedJwksUrl = new URL(jwksUrl);
  } catch {
    throw new Error('Invalid configuration: JWT_JWKS_URL');
  }
  if (
    !['http:', 'https:'].includes(parsedJwksUrl.protocol) ||
    parsedJwksUrl.username ||
    parsedJwksUrl.password ||
    parsedJwksUrl.hash
  )
    throw new Error('Invalid configuration: JWT_JWKS_URL');

  const publicKey = source.JWT_PUBLIC_KEY;
  if (
    publicKey !== undefined &&
    typeof publicKey !== 'string'
  )
    throw new Error('Invalid configuration: JWT_PUBLIC_KEY');
  const issuer = source.JWT_ISSUER ?? 'urn:descubreec:identity';
  const audience = source.JWT_AUDIENCE ?? 'urn:descubreec:internal-api';
  if (
    typeof issuer !== 'string' ||
    issuer.length === 0 ||
    issuer.length > 256 ||
    typeof audience !== 'string' ||
    audience.length === 0 ||
    audience.length > 256
  )
    throw new Error('Invalid JWT issuer or audience');

  return {
    NODE_ENV: nodeEnv as GatewayEnvironment['NODE_ENV'],
    PORT: integer(source, 'PORT', 3000, 1, 65535),
    ...services,
    ...prefixes,
    ...healthPaths,
    JWT_JWKS_URL: parsedJwksUrl.href,
    JWT_PUBLIC_KEY: publicKey?.replace(/\\n/g, '\n') || undefined,
    JWT_ISSUER: issuer,
    JWT_AUDIENCE: audience,
    CORS_ORIGINS: corsOrigins(source),
    RATE_LIMIT_CUSTOMER: integer(source, 'RATE_LIMIT_CUSTOMER', 100, 1, 1000000),
    RATE_LIMIT_PARTNER: integer(source, 'RATE_LIMIT_PARTNER', 500, 1, 1000000),
    RATE_LIMIT_ADMIN: integer(source, 'RATE_LIMIT_ADMIN', 1000, 1, 1000000),
    PROXY_TIMEOUT_MS: integer(source, 'PROXY_TIMEOUT_MS', 30000, 100, 120000),
    HEALTH_TIMEOUT_MS: integer(source, 'HEALTH_TIMEOUT_MS', 2500, 100, 30000),
  };
}
