import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES } from '../decorators/roles.decorator.js';
import { requiredRolesForRequest } from '../security/roles.js';
import type { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const explicit = this.reflector.getAllAndOverride<
      readonly string[] | undefined
    >(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    const route = /^\/api\/v[123]\/([^/]+)(?:\/([^?]*))?$/.exec(request.path);
    const required =
      explicit ??
      (route
        ? requiredRolesForRequest(
            route[1] ?? '',
            route[2] ?? '',
            request.method,
          )
        : undefined);
    if (!required?.length) return true;
    if (!request.user || !required.some((role) => request.user?.roles.includes(role)))
      throw new ForbiddenException('Insufficient role');
    return true;
  }
}
