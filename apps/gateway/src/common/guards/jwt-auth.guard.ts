import {
  ServiceUnavailableException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, errors, importSPKI, jwtVerify } from 'jose';
import { createPublicKey } from 'node:crypto';
import type { GatewayEnvironment } from '../../config/gateway-environment.js';
import { IS_PUBLIC } from '../decorators/public.decorator.js';
import { normalizeRoles } from '../security/roles.js';
import type { Request } from 'express';

const publicIdentityRoutes = new Set([
  'POST /register',
  'POST /login',
  'POST /refresh',
  'POST /verify-email',
  'POST /resend-verification',
  'POST /forgot-password',
  'POST /reset-password',
]);

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtAuthGuard implements CanActivate, OnModuleInit {
  private keySet!: ReturnType<typeof createRemoteJWKSet> | Awaited<
    ReturnType<typeof importSPKI>
  >;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly publicKey?: string;
  private readonly jwksUrl: string;
  private readonly usesRemoteJwks: boolean;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Record<string, unknown>, true>,
  ) {
    const env = config.getOrThrow<GatewayEnvironment>('gateway');
    this.issuer = env.JWT_ISSUER;
    this.audience = env.JWT_AUDIENCE;
    this.publicKey = env.JWT_PUBLIC_KEY;
    this.jwksUrl = env.JWT_JWKS_URL;
    this.usesRemoteJwks = !env.JWT_PUBLIC_KEY;
  }

  async onModuleInit(): Promise<void> {
    if (!this.publicKey) {
      this.keySet = createRemoteJWKSet(new URL(this.jwksUrl));
      return;
    }
    const publicKey = createPublicKey(this.publicKey);
    if (
      publicKey.asymmetricKeyType !== 'rsa' ||
      (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072
    )
      throw new Error('JWT_PUBLIC_KEY must be an RSA key with at least 3072 bits');
    this.keySet = await importSPKI(this.publicKey, 'RS256');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || this.isPublicRoute(request)) return true;

    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string'
      ? /^Bearer ([^\s]+)$/i.exec(authorization)
      : null;
    if (!match?.[1]) throw new UnauthorizedException('Bearer token required');

    try {
      const { payload } = await jwtVerify(match[1], this.keySet, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: this.audience,
        typ: 'identity-access+jwt',
        requiredClaims: ['sub', 'sid', 'jti', 'iat', 'exp', 'token_use'],
      });
      if (
        typeof payload.sub !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(payload.sub) ||
        BigInt(payload.sub) > 9223372036854775807n ||
        typeof payload.sid !== 'string' ||
        !uuid.test(payload.sid) ||
        typeof payload.jti !== 'string' ||
        !uuid.test(payload.jti) ||
        payload.token_use !== 'access' ||
        typeof payload.iat !== 'number' ||
        payload.iat > Math.floor(Date.now() / 1000) ||
        !Array.isArray(payload.roles) ||
        !payload.roles.every((role) => typeof role === 'string') ||
        normalizeRoles(payload.roles).length === 0 ||
        payload.email !== undefined && typeof payload.email !== 'string'
      )
        throw new Error('Invalid access token claims');

      request.user = {
        id: payload.sub,
        ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
        roles: normalizeRoles(payload.roles),
      };
      return true;
    } catch (error) {
      if (
        this.usesRemoteJwks &&
        (error instanceof TypeError ||
          error instanceof errors.JWKSTimeout ||
          error instanceof errors.JOSEError &&
            ['ERR_JOSE_GENERIC', 'ERR_JWKS_INVALID'].includes(error.code))
      )
        throw new ServiceUnavailableException(
          'Identity signing keys are unavailable',
        );
      throw new UnauthorizedException('Invalid or expired credentials');
    }
  }

  private isPublicRoute(request: Request): boolean {
    if (
      request.path === '/docs' ||
      request.path.startsWith('/docs/') ||
      request.path === '/docs-json' ||
      request.path.startsWith('/docs-json/')
    )
      return true;
    const match = /^\/api\/v[123]\/auth(\/.*)?$/.exec(request.path);
    return Boolean(
      match &&
        publicIdentityRoutes.has(
          `${request.method.toUpperCase()} ${match[1] ?? '/'}`,
        ),
    );
  }
}
