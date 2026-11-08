import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

export interface ClientRecord {
  client_id: string;
  nombre: string;
  email: string;
  identificacion: string | null;
  telefono: string | null;
}

export interface ClientInput {
  nombre: string;
  email: string;
  identificacion?: string;
  telefono?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELECT_CLIENT = `SELECT cli_uuid::text AS client_id, cli_nombre AS nombre,
  cli_email AS email, cli_identificacion AS identificacion, cli_telefono AS telefono
  FROM cliente_atraccion`;

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
  return {
    nombre,
    email: normalizeEmail(b.email),
    identificacion: optionalText(b.identificacion, 'identificacion', 30),
    telefono: optionalText(b.telefono, 'telefono', 30),
  };
}

@Injectable()
export class BookingClientsService implements OnModuleInit {
  constructor(private readonly source: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async ensureSchema(): Promise<void> {
    await this.source.query(`
      CREATE TABLE IF NOT EXISTS cliente_atraccion (
        cli_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        cli_uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        cli_nombre varchar(200) NOT NULL,
        cli_email varchar(200) NOT NULL,
        cli_identificacion varchar(30),
        cli_telefono varchar(30),
        cli_creado_en timestamptz NOT NULL DEFAULT now()
      )`);
    await this.source
      .query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_atraccion_email
      ON cliente_atraccion (lower(cli_email))`);
    await this.source
      .query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_atraccion_identificacion
      ON cliente_atraccion (cli_identificacion) WHERE cli_identificacion IS NOT NULL`);
  }

  private reservationColumns?: Promise<void>;

  /** Idempotente; se ejecuta bajo demanda porque reserva_atraccion se crea en otro modulo. */
  ensureReservationColumns(): Promise<void> {
    this.reservationColumns ??= this.source
      .query(
        `ALTER TABLE reserva_atraccion
          ADD COLUMN IF NOT EXISTS res_cliente_uuid uuid,
          ADD COLUMN IF NOT EXISTS res_checkin_en timestamptz,
          ADD COLUMN IF NOT EXISTS res_checkin_asistentes integer,
          ADD COLUMN IF NOT EXISTS res_checkin_admin varchar(100),
          ADD COLUMN IF NOT EXISTS res_checkin_observaciones varchar(500),
          ADD COLUMN IF NOT EXISTS res_checkin_notificado boolean NOT NULL DEFAULT false`,
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.reservationColumns = undefined;
        throw error;
      });
    return this.reservationColumns;
  }

  async find(
    email?: string,
    identificacion?: string,
  ): Promise<ClientRecord | null> {
    const mail = email ? normalizeEmail(email) : undefined;
    const id = optionalText(identificacion, 'identificacion', 30);
    if (!mail && !id)
      throw new BadRequestException('email o identificacion requerido');
    return this.lookup(this.source.manager, mail, id);
  }

  /** Reutiliza al turista por identificacion o email; nunca duplica. */
  async register(
    input: ClientInput,
    manager?: EntityManager,
  ): Promise<{ client: ClientRecord; created: boolean }> {
    if (!manager)
      return this.source.transaction((tx) => this.register(input, tx));
    const email = input.email.toLowerCase();
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `cliente:${email}`,
    ]);
    if (input.identificacion)
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`cliente-id:${input.identificacion}`],
      );
    const byEmail = await this.lookup(manager, email, undefined);
    const byId = input.identificacion
      ? await this.lookup(manager, undefined, input.identificacion)
      : null;
    if (byEmail && byId && byEmail.client_id !== byId.client_id)
      throw new ConflictException(
        'email e identificacion pertenecen a clientes distintos',
      );
    const existing = byEmail ?? byId;
    if (existing) {
      if (
        existing.identificacion &&
        input.identificacion &&
        existing.identificacion !== input.identificacion
      )
        throw new ConflictException(
          'el cliente ya tiene otra identificacion registrada',
        );
      await manager.query(
        `UPDATE cliente_atraccion
            SET cli_identificacion = COALESCE(cli_identificacion, $2),
                cli_telefono = COALESCE(cli_telefono, $3)
          WHERE cli_uuid = $1::uuid`,
        [
          existing.client_id,
          input.identificacion ?? null,
          input.telefono ?? null,
        ],
      );
      const client = await this.lookupByUuid(manager, existing.client_id);
      return { client: client ?? existing, created: false };
    }
    const [row] = await manager.query<Array<{ client_id: string }>>(
      `INSERT INTO cliente_atraccion (cli_nombre, cli_email, cli_identificacion, cli_telefono)
       VALUES ($1,$2,$3,$4) RETURNING cli_uuid::text AS client_id`,
      [
        input.nombre,
        email,
        input.identificacion ?? null,
        input.telefono ?? null,
      ],
    );
    const client = await this.lookupByUuid(manager, row?.client_id ?? '');
    if (!client) throw new ConflictException('No se pudo registrar el cliente');
    return { client, created: true };
  }

  private async lookup(
    manager: EntityManager,
    email?: string,
    identificacion?: string,
  ): Promise<ClientRecord | null> {
    if (identificacion) {
      const [byId] = await manager.query<ClientRecord[]>(
        `${SELECT_CLIENT} WHERE cli_identificacion = $1`,
        [identificacion],
      );
      if (byId) return byId;
    }
    if (email) {
      const [byEmail] = await manager.query<ClientRecord[]>(
        `${SELECT_CLIENT} WHERE lower(cli_email) = $1`,
        [email.toLowerCase()],
      );
      if (byEmail) return byEmail;
    }
    return null;
  }

  private async lookupByUuid(manager: EntityManager, uuid: string) {
    const [row] = await manager.query<ClientRecord[]>(
      `${SELECT_CLIENT} WHERE cli_uuid = $1::uuid`,
      [uuid],
    );
    return row ?? null;
  }
}
