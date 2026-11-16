import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';

export interface ClientInput {
  nombre: string;
  email: string;
  identificacion?: string;
  telefono?: string;
  origen?: 'TIENDA' | 'BOOKING';
  usuario_id?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDENTIFICATION = /^[\p{L}\p{N}.-]{3,30}$/u;
const CLIENT_COLUMNS = `cli_uuid::text AS client_id, cli_nombre AS nombre,
 cli_email AS email, cli_identificacion AS identificacion,
 cli_telefono AS telefono, cli_origenes AS origenes, cli_usuario_id::text AS usuario_id, cli_creado_en AS creado_en`;

export function parseInput(value: unknown, tiendaUserId?: string): ClientInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const identificacion = typeof body.identificacion === 'string' ? body.identificacion.trim().toUpperCase() : undefined;
  const telefono = typeof body.telefono === 'string' ? body.telefono.trim() : undefined;
  const origen = body.origen ?? 'TIENDA';
  if (!nombre || nombre.length > 200) throw new BadRequestException('nombre invalido');
  if (!EMAIL.test(email) || email.length > 200) throw new BadRequestException('email invalido');
  if (identificacion && !IDENTIFICATION.test(identificacion)) throw new BadRequestException('identificacion invalida');
  if (telefono && (telefono.length > 30 || !/^\+?[0-9 ()-]{7,30}$/.test(telefono) || (telefono.match(/\d/g) ?? []).length < 7))
    throw new BadRequestException('telefono invalido');
  if (origen !== 'TIENDA' && origen !== 'BOOKING') throw new BadRequestException('origen invalido');
  if (tiendaUserId && (!identificacion || !/^\d{10}(?:\d{3})?$/.test(identificacion)))
    throw new BadRequestException('cedula o RUC invalido');
  if (tiendaUserId && (!/^[1-9]\d{0,18}$/.test(tiendaUserId) || BigInt(tiendaUserId) > 9223372036854775807n)) throw new BadRequestException('usuario_id invalido');
  return { nombre, email, ...(identificacion ? { identificacion } : {}), ...(telefono ? { telefono } : {}), ...(tiendaUserId ? { usuario_id: tiendaUserId } : {}), origen };
}

@Injectable()
export class ClientsService implements OnModuleInit {
  private readonly poolMax = this.readPoolMax();
  private readonly pool = new Pool({
    ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 5448),
      user: process.env.DB_USERNAME ?? 'cliente',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE ?? 'ms_cliente',
    }),
    max: this.poolMax,
    connectionTimeoutMillis: 3000,
  });

  private readPoolMax() {
    const value = Number(process.env.DB_POOL_MAX ?? 5);
    if (!Number.isInteger(value) || value < 1 || value > 50)
      throw new Error('DB_POOL_MAX must be an integer between 1 and 50');
    return value;
  }

  async onModuleInit() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS cliente (
        cli_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        cli_uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        cli_nombre varchar(200) NOT NULL,
        cli_email varchar(200) NOT NULL,
        cli_identificacion varchar(30),
        cli_telefono varchar(30),
        cli_usuario_id bigint,
        cli_origenes text[] NOT NULL DEFAULT ARRAY['TIENDA']::text[],
        cli_creado_en timestamptz NOT NULL DEFAULT now(),
        cli_actualizado_en timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_email ON cliente(lower(cli_email));
      CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_identificacion ON cliente(cli_identificacion) WHERE cli_identificacion IS NOT NULL;`);
    await this.pool.query(`ALTER TABLE cliente ADD COLUMN IF NOT EXISTS cli_origenes text[] NOT NULL DEFAULT ARRAY['TIENDA']::text[]`);
    await this.pool.query(`ALTER TABLE cliente ADD COLUMN IF NOT EXISTS cli_usuario_id bigint`);
    await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_usuario_id ON cliente(cli_usuario_id) WHERE cli_usuario_id IS NOT NULL`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ix_cliente_creado_en ON cliente(cli_creado_en DESC, cli_id DESC)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS ix_cliente_origenes ON cliente USING GIN(cli_origenes)`);
  }

  async ready() {
    await this.pool.query('SELECT 1');
  }

  async find(email?: string, identificacion?: string) {
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedId = identificacion?.trim().toUpperCase();
    if (!normalizedEmail && !normalizedId) throw new BadRequestException('email o identificacion requerido');
    const result = await this.pool.query(
      `SELECT ${CLIENT_COLUMNS} FROM cliente WHERE ($1::text IS NOT NULL AND lower(cli_email)=$1)
       OR ($2::text IS NOT NULL AND cli_identificacion=$2) ORDER BY (cli_identificacion=$2) DESC NULLS LAST LIMIT 2`,
      [normalizedEmail ?? null, normalizedId ?? null],
    );
    // Misma cédula → mismo cliente sin importar cuántos correos tenga: retornar el que tiene la cédula.
    return result.rows[0] ?? null;
  }

  async byId(id: string) {
    const result = await this.pool.query(`SELECT ${CLIENT_COLUMNS} FROM cliente WHERE cli_uuid=$1::uuid`, [id]);
    if (!result.rows[0]) throw new NotFoundException('Cliente no encontrado');
    return result.rows[0];
  }

  async register(input: ClientInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const keys = [
        `email:${input.email}`,
        ...(input.identificacion ? [`id:${input.identificacion}`] : []),
        ...(input.usuario_id ? [`user:${input.usuario_id}`] : []),
      ].sort();
      for (const key of keys) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      const current = await client.query(
        `SELECT ${CLIENT_COLUMNS} FROM cliente WHERE ($1::text IS NOT NULL AND cli_identificacion=$1)
         OR lower(cli_email)=$2 OR ($3::bigint IS NOT NULL AND cli_usuario_id=$3)
         ORDER BY (cli_identificacion=$1) DESC NULLS LAST LIMIT 3`,
        [input.identificacion ?? null, input.email, input.usuario_id ?? null],
      );
      const uniqueIds = new Set(current.rows.map((row: { client_id: string }) => row.client_id));
      if (uniqueIds.size > 1) {
        // Regla de negocio: misma cédula → mismo cliente. Fusionar: conservar el que tiene la cédula
        // (primero en el ORDER BY) y absorber los datos del resto.
        const primary = current.rows.find((r: { identificacion: string | null }) => r.identificacion === (input.identificacion ?? null))
          ?? current.rows[0];
        const toMerge = current.rows.filter((r: { client_id: string }) => r.client_id !== primary.client_id);
        for (const dup of toMerge) {
          await client.query(
            `UPDATE cliente SET
               cli_identificacion=COALESCE(cli_identificacion,$2),
               cli_telefono=COALESCE(cli_telefono,$3),
               cli_usuario_id=COALESCE(cli_usuario_id,$4::bigint),
               cli_origenes=ARRAY(SELECT DISTINCT unnest(cli_origenes || $5::text[])),
               cli_actualizado_en=now()
             WHERE cli_uuid=$1::uuid`,
            [primary.client_id, dup.identificacion ?? null, dup.telefono ?? null, dup.usuario_id ?? null, dup.origenes ?? []],
          );
          await client.query(`DELETE FROM cliente WHERE cli_uuid=$1::uuid`, [dup.client_id]);
        }
        // Continúa como si fuera un update normal sobre el primario
        const merged = await client.query(
          `UPDATE cliente SET cli_identificacion=COALESCE(cli_identificacion,$2),
             cli_telefono=COALESCE(cli_telefono,$3),
             cli_usuario_id=COALESCE(cli_usuario_id,$4::bigint),
             cli_origenes=ARRAY(SELECT DISTINCT unnest(cli_origenes || $5::text[])),
             cli_actualizado_en=now() WHERE cli_uuid=$1::uuid RETURNING ${CLIENT_COLUMNS}`,
          [primary.client_id, input.identificacion ?? null, input.telefono ?? null, input.usuario_id ?? null, [input.origen ?? 'TIENDA']],
        );
        await client.query('COMMIT');
        return { client: merged.rows[0], created: false };
      }
      const old = current.rows[0];
      if (old?.identificacion && input.identificacion && old.identificacion !== input.identificacion)
        throw new ConflictException('el cliente ya tiene otra identificacion registrada');
      if (old) {
        const updated = await client.query(
          `UPDATE cliente SET cli_identificacion=COALESCE(cli_identificacion,$2),
             cli_telefono=COALESCE(cli_telefono,$3),
             cli_usuario_id=COALESCE(cli_usuario_id,$4::bigint),
             cli_origenes=ARRAY(SELECT DISTINCT unnest(cli_origenes || $5::text[])),
             cli_actualizado_en=now() WHERE cli_uuid=$1::uuid RETURNING ${CLIENT_COLUMNS}`,
          [old.client_id, input.identificacion ?? null, input.telefono ?? null, input.usuario_id ?? null, [input.origen ?? 'TIENDA']],
        );
        await client.query('COMMIT');
        return { client: updated.rows[0], created: false };
      }
      const inserted = await client.query(
        `INSERT INTO cliente(cli_nombre,cli_email,cli_identificacion,cli_telefono,cli_usuario_id,cli_origenes)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING ${CLIENT_COLUMNS}`,
        [input.nombre, input.email, input.identificacion ?? null, input.telefono ?? null, input.usuario_id ?? null, [input.origen ?? 'TIENDA']],
      );
      await client.query('COMMIT');
      return { client: inserted.rows[0], created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof ConflictException) throw error;
      if ((error as { code?: string }).code === '23505') throw new ConflictException('email o identificacion ya registrada');
      if ((error as { code?: string }).code) throw new ServiceUnavailableException('No fue posible guardar el cliente');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(page: number, limit: number, q?: string) {
    const offset = (page - 1) * limit;
    const filter = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, '\\$&')}%` : null;
    const [rows, count] = await Promise.all([
      this.pool.query(`SELECT ${CLIENT_COLUMNS} FROM cliente WHERE $1::text IS NULL OR cli_nombre ILIKE $1 OR cli_email ILIKE $1 OR cli_identificacion ILIKE $1 ORDER BY cli_creado_en DESC, cli_id DESC LIMIT $2 OFFSET $3`, [filter, limit, offset]),
      this.pool.query(`SELECT count(*)::int AS total FROM cliente WHERE $1::text IS NULL OR cli_nombre ILIKE $1 OR cli_email ILIKE $1 OR cli_identificacion ILIKE $1`, [filter]),
    ]);
    const total = count.rows[0].total as number;
    return { items: rows.rows, total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) };
  }
}
