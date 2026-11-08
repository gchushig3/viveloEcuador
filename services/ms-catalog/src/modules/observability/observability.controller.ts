import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  OnModuleInit,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { PublicEndpoint } from '../../common/public-endpoint.decorator.js';

const CATEGORIES = [
  'PERFORMANCE',
  'ERROR',
  'RESOURCE_ERROR',
  'INTERACTION',
  'VISIBILITY',
  'VIEWPORT',
  'CONNECTION',
  'CAPABILITY',
  'HTTP',
  'DOMAIN',
] as const;
const MAX_BATCH = 20;
const SAMPLE_LIMIT = 200;
const MAX_ROWS = 5000;
const RETENTION_DAYS = 7;
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

type Payload = Record<string, string | number | boolean>;
type RequestInfo = { headers: Record<string, unknown>; ip?: string };

interface EventRow {
  id: string;
  received_at: string;
  category: string;
  type: string;
  occurred_at: string;
  route: string;
  session_id: string;
  payload: Payload;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new BadRequestException(`${name} invalido`);
  return value;
}

function cleanPayload(value: unknown): Payload {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('payload invalido');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) throw new BadRequestException('payload invalido');
  const out: Payload = {};
  for (const [key, item] of entries) {
    if (key.length > 40) throw new BadRequestException('payload invalido');
    if (typeof item === 'string') out[key] = item.slice(0, 240);
    else if (typeof item === 'number' && Number.isFinite(item)) out[key] = item;
    else if (typeof item === 'boolean') out[key] = item;
  }
  return out;
}

/** Ingesta publica de eventos del navegador y consulta administrativa. */
@ApiTags('Observabilidad')
@Controller()
export class ObservabilityController implements OnModuleInit {
  private readonly hits = new Map<string, { count: number; reset: number }>();

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS telemetria_evento (
        tel_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tel_categoria varchar(20) NOT NULL,
        tel_tipo varchar(60) NOT NULL,
        tel_ocurrido_en timestamptz NOT NULL,
        tel_ruta varchar(200) NOT NULL,
        tel_sesion varchar(64) NOT NULL,
        tel_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        tel_recibido_en timestamptz NOT NULL DEFAULT now()
      )`);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS ix_telemetria_recibido
        ON telemetria_evento (tel_recibido_en DESC)`);
  }

  private throttle(req: RequestInfo) {
    const forwarded = req.headers['x-forwarded-for'];
    const key =
      (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '') ||
      req.ip ||
      'unknown';
    const now = Date.now();
    if (this.hits.size > 10_000) this.hits.clear();
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + RATE_WINDOW_MS });
      return;
    }
    if (++entry.count > RATE_LIMIT)
      throw new HttpException(
        'Demasiadas solicitudes',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  @Post('observabilidad/eventos')
  @PublicEndpoint()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Registrar eventos tecnicos del navegador' })
  async ingest(@Body() body: unknown, @Req() req: RequestInfo) {
    this.throttle(req);
    const events = (body as { events?: unknown } | null)?.events;
    if (!Array.isArray(events) || !events.length || events.length > MAX_BATCH)
      throw new BadRequestException('events invalido');
    const rows = events.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object')
        throw new BadRequestException('evento invalido');
      const e = raw as Record<string, unknown>;
      const category = text(e.category, 'category', 20);
      if (!(CATEGORIES as readonly string[]).includes(category))
        throw new BadRequestException('category invalida');
      const timestamp = text(e.timestamp, 'timestamp', 40);
      if (Number.isNaN(Date.parse(timestamp)))
        throw new BadRequestException('timestamp invalido');
      return [
        category,
        text(e.type, 'type', 60),
        new Date(timestamp).toISOString(),
        text(e.route, 'route', 200),
        text(e.sessionId, 'sessionId', 64),
        JSON.stringify(cleanPayload(e.payload)),
      ];
    });
    const params: unknown[] = [];
    const values = rows.map((row) => {
      const start = params.length;
      params.push(...row);
      return `($${start + 1},$${start + 2},$${start + 3},$${start + 4},$${start + 5},$${start + 6}::jsonb)`;
    });
    await this.dataSource.query(
      `INSERT INTO telemetria_evento
         (tel_categoria, tel_tipo, tel_ocurrido_en, tel_ruta, tel_sesion, tel_payload)
       VALUES ${values.join(',')}`,
      params,
    );
    if (Math.random() < 0.02) await this.prune();
    return { accepted: rows.length };
  }

  private async prune() {
    await this.dataSource.query(
      `DELETE FROM telemetria_evento
        WHERE tel_recibido_en < now() - ($1 || ' days')::interval
           OR tel_id <= (SELECT COALESCE(max(tel_id), 0) FROM telemetria_evento) - $2`,
      [String(RETENTION_DAYS), MAX_ROWS],
    );
  }

  @Get('admin/observabilidad/eventos')
  @ApiBearerAuth('jwt')
  @ApiUnauthorizedResponse({
    description: 'Requiere access JWT y rol ADMIN validados por Identity.',
  })
  @ApiOperation({ summary: 'Ultimos eventos de navegador y resumen' })
  async recent() {
    const rows = await this.dataSource.query<EventRow[]>(
      `SELECT tel_id::text AS id, tel_recibido_en AS received_at,
              tel_categoria AS category, tel_tipo AS type,
              tel_ocurrido_en AS occurred_at, tel_ruta AS route,
              tel_sesion AS session_id, tel_payload AS payload
         FROM telemetria_evento
        ORDER BY tel_id DESC
        LIMIT ${SAMPLE_LIMIT}`,
    );
    const events = rows.map((r) => ({
      id: r.id,
      receivedAt: new Date(r.received_at).toISOString(),
      category: r.category,
      type: r.type,
      timestamp: new Date(r.occurred_at).toISOString(),
      route: r.route,
      sessionId: r.session_id,
      payload: r.payload,
    }));
    const counts: Record<string, number> = Object.fromEntries(
      CATEGORIES.map((c) => [c, 0]),
    );
    for (const event of events)
      counts[event.category] = (counts[event.category] ?? 0) + 1;
    const loads = events
      .filter((e) => e.type === 'navigation_timing')
      .map((e) => e.payload.loadMs)
      .filter((v): v is number => typeof v === 'number');
    return {
      events,
      summary: {
        sampleSize: events.length,
        sampleLimit: SAMPLE_LIMIT,
        counts,
        navigationSamples: loads.length,
        averageLoadMs: loads.length
          ? loads.reduce((a, b) => a + b, 0) / loads.length
          : null,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
