import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

export interface ClientRecord {
  client_id: string;
  nombre: string;
  email: string;
  identificacion: string | null;
  telefono: string | null;
  origenes?: string[];
  creado_en?: string;
}

export interface ClientInput {
  nombre: string;
  email: string;
  identificacion?: string;
  telefono?: string;
  origen?: 'TIENDA' | 'BOOKING';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalText(value: unknown, name: string, max: number) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > max)
    throw new BadRequestException(`${name} invalido`);
  return value.trim() || undefined;
}

export function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 200)
    throw new BadRequestException('email invalido');
  return email;
}

export function parseClientInput(body: unknown): ClientInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const nombre = optionalText(b.nombre, 'nombre', 200);
  if (!nombre) throw new BadRequestException('nombre invalido');
  const origen = b.origen ?? 'BOOKING';
  if (origen !== 'TIENDA' && origen !== 'BOOKING')
    throw new BadRequestException('origen invalido');
  return {
    nombre,
    email: normalizeEmail(b.email),
    identificacion: optionalText(b.identificacion, 'identificacion', 30)?.toUpperCase(),
    telefono: optionalText(b.telefono, 'telefono', 30),
    origen,
  };
}

@Injectable()
export class BookingClientsService implements OnModuleInit {
  private readonly baseUrl: string;

  constructor(
    private readonly source: DataSource,
    config: ConfigService,
  ) {
    this.baseUrl = (config.get<string>('CLIENT_SERVICE_URL') ?? 'http://127.0.0.1:3018/api/v2/clientes').replace(/\/$/, '');
  }

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  /** Los perfiles ahora pertenecen a ms-cliente; se conserva el método para compatibilidad. */
  async ensureSchema(): Promise<void> {}

  private reservationColumns?: Promise<void>;

  ensureReservationColumns(): Promise<void> {
    this.reservationColumns ??= this.source
      .query(`ALTER TABLE reserva_atraccion
        ADD COLUMN IF NOT EXISTS res_cliente_uuid uuid,
        ADD COLUMN IF NOT EXISTS res_checkin_en timestamptz,
        ADD COLUMN IF NOT EXISTS res_checkin_asistentes integer,
        ADD COLUMN IF NOT EXISTS res_checkin_admin varchar(100),
        ADD COLUMN IF NOT EXISTS res_checkin_observaciones varchar(500),
        ADD COLUMN IF NOT EXISTS res_checkin_notificado boolean NOT NULL DEFAULT false`)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.reservationColumns = undefined;
        throw error;
      });
    return this.reservationColumns;
  }

  async find(email?: string, identificacion?: string): Promise<ClientRecord | null> {
    const query = new URLSearchParams();
    if (email) query.set('email', normalizeEmail(email));
    if (identificacion) query.set('identificacion', optionalText(identificacion, 'identificacion', 30)!);
    if (!query.size) throw new BadRequestException('email o identificacion requerido');
    const result = await this.request(`${this.baseUrl}?${query}`);
    if (result.status === 404) return null;
    if (!result.ok) throw new ServiceUnavailableException('ms-cliente no disponible');
    return await result.json() as ClientRecord;
  }

  async byId(id: string): Promise<ClientRecord | null> {
    const result = await this.request(`${this.baseUrl}/id/${encodeURIComponent(id)}`);
    if (result.status === 404) return null;
    if (!result.ok) throw new ServiceUnavailableException('ms-cliente no disponible');
    return await result.json() as ClientRecord;
  }

  async register(input: ClientInput, _manager?: unknown): Promise<{ client: ClientRecord; created: boolean }> {
    return this.registerAt(input, 'integration/register');
  }

  async registerAdmin(input: ClientInput): Promise<{ client: ClientRecord; created: boolean }> {
    return this.registerAt({ ...input, origen: 'TIENDA' }, 'admin');
  }

  private async registerAt(input: ClientInput, path: string): Promise<{ client: ClientRecord; created: boolean }> {
    const result = await this.request(`${this.baseUrl}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, origen: input.origen ?? 'BOOKING' }),
    });
    if (!result.ok) {
      const payload = await result.json().catch(() => null) as { message?: string } | null;
      if (result.status === 409) throw new ConflictException(payload?.message ?? 'Conflicto de identidad del cliente');
      if (result.status === 400) throw new BadRequestException(payload?.message ?? 'Datos de cliente invalidos');
      throw new ServiceUnavailableException('ms-cliente no disponible');
    }
    const payload = await result.json() as { client_id: string; cliente: ClientRecord; reused?: boolean };
    return { client: payload.cliente, created: !payload.reused };
  }

  async list(page: number, limit: number, q?: string) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) query.set('q', q);
    const result = await this.request(`${this.baseUrl}/admin?${query}`);
    if (!result.ok) throw new ServiceUnavailableException('ms-cliente no disponible');
    return await result.json() as { items: ClientRecord[]; total: number; page: number; limit: number; total_pages: number };
  }

  private async request(url: string, init?: RequestInit) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    } catch {
      throw new ServiceUnavailableException('ms-cliente no disponible');
    }
  }
}
