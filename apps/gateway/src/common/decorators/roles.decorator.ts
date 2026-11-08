import { SetMetadata } from '@nestjs/common';
import type { GatewayRole } from '../security/roles.js';

export const REQUIRED_ROLES = 'gateway:required-roles';
export const Roles = (...roles: GatewayRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);
