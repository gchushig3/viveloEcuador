export type GatewayRole = 'ADMIN' | 'CUSTOMER' | 'PARTNER';

const roleAliases: Record<string, GatewayRole> = {
  ADMIN: 'ADMIN',
  CLIENTE: 'CUSTOMER',
  CUSTOMER: 'CUSTOMER',
  OPERADOR: 'PARTNER',
  PARTNER: 'PARTNER',
};

export function normalizeRoles(roles: readonly string[]): GatewayRole[] {
  return [...new Set(roles.map((role) => roleAliases[role.toUpperCase()]).filter(
    (role): role is GatewayRole => role !== undefined,
  ))];
}

export function requiredRolesForRequest(
  service: string,
  tail: string,
  method: string,
): GatewayRole[] | undefined {
  const path = tail.toLowerCase();
  if (service === 'identity') return ['ADMIN'];
  if (service === 'audit' || service === 'auth' && /^(users|roles)(\/|$)/.test(path))
    return ['ADMIN'];
  if (service === 'cart' && /^admin(\/|$)/.test(path)) return ['ADMIN'];
  if (service === 'clients' && /^admin(\/|$)/.test(path)) return ['ADMIN'];
  if (service === 'clients' && /^web\/register$/.test(path)) return ['CUSTOMER', 'ADMIN'];
  if (service === 'clients' && /^(id\/|integration\/)/.test(path)) return ['ADMIN'];
  if (service === 'cart') return ['CUSTOMER', 'ADMIN'];
  if (service === 'payment') return ['CUSTOMER', 'ADMIN'];
  if (service === 'catalog' && method.toUpperCase() === 'POST' &&
      ['atracciones/search', 'observabilidad/eventos'].includes(path)) return undefined;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
    if (service === 'inventory' || service === 'catalog')
      return ['PARTNER', 'ADMIN'];
  }
  if (service === 'booking') return ['CUSTOMER', 'PARTNER', 'ADMIN'];
  return undefined;
}
