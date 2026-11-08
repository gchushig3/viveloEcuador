import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

interface PendingStock {
  dis_id: string;
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  version: string;
}

@Injectable()
export class BookingStockSyncService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BookingStockSyncService.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;

  constructor(private readonly source: DataSource, private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.source.query(`
      CREATE TABLE IF NOT EXISTS booking_stock_outbox (
        dis_id bigint PRIMARY KEY REFERENCES disponibilidad(dis_id) ON DELETE CASCADE,
        version bigint NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz DEFAULT now()
      )`);
    await this.source.query(`
      CREATE OR REPLACE FUNCTION booking_enqueue_stock() RETURNS trigger AS $$
      BEGIN
        INSERT INTO booking_stock_outbox(dis_id, version)
        SELECT NEW.dis_id, floor(extract(epoch from clock_timestamp()) * 1000)::bigint
        WHERE EXISTS (SELECT 1 FROM saga_inventory_slot WHERE dis_id = NEW.dis_id)
        ON CONFLICT (dis_id) DO UPDATE SET
          version = greatest(booking_stock_outbox.version + 1, EXCLUDED.version),
          next_attempt_at = now(), attempts = 0;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await this.source.query(`
      CREATE OR REPLACE TRIGGER booking_stock_availability
      AFTER UPDATE OF dis_cupo_total, dis_cupo_reservado, dis_cerrada ON disponibilidad
      FOR EACH ROW EXECUTE FUNCTION booking_enqueue_stock()`);
    await this.source.query(`
      CREATE OR REPLACE TRIGGER booking_stock_slot
      AFTER INSERT OR UPDATE OF zero_capacity ON saga_inventory_slot
      FOR EACH ROW EXECUTE FUNCTION booking_enqueue_stock()`);
    await this.source.query(`
      CREATE OR REPLACE FUNCTION booking_enqueue_schedule_stock() RETURNS trigger AS $$
      BEGIN
        INSERT INTO booking_stock_outbox(dis_id, version)
        SELECT d.dis_id, floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          FROM disponibilidad d JOIN saga_inventory_slot s ON s.dis_id = d.dis_id
         WHERE d.hor_id = NEW.hor_id
        ON CONFLICT (dis_id) DO UPDATE SET
          version = greatest(booking_stock_outbox.version + 1, EXCLUDED.version),
          next_attempt_at = now(), attempts = 0;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await this.source.query(`
      CREATE OR REPLACE TRIGGER booking_stock_schedule
      AFTER UPDATE OF hor_activo ON horario
      FOR EACH ROW EXECUTE FUNCTION booking_enqueue_schedule_stock()`);
    this.timer = setInterval(() => {
      this.pending ??= this.drain()
        .catch(() => this.logger.error('Error al procesar cola de stock Booking'))
        .finally(() => { this.pending = undefined; });
    }, 2000);
    this.timer.unref();
  }

  async drain() {
    for (let i = 0; i < 50; i++) {
      // The outbox lock serializes delivery with concurrent changes to the same slot.
      const processed = await this.source.transaction(async (manager) => {
        const [row] = await manager.query<PendingStock[]>(`
          SELECT o.dis_id::text, o.version::text, s.service_id, s.item_id,
                 to_char(s.date, 'YYYY-MM-DD') AS date,
                 to_char(s.time_slot, 'HH24:MI') AS time_slot,
                 CASE WHEN d.dis_cerrada OR NOT h.hor_activo OR s.zero_capacity
                      THEN 0 ELSE greatest(0, d.dis_cupo_total - d.dis_cupo_reservado)
                 END::integer AS available_units
            FROM booking_stock_outbox o
            JOIN saga_inventory_slot s ON s.dis_id = o.dis_id
            JOIN disponibilidad d ON d.dis_id = o.dis_id
            JOIN horario h ON h.hor_id = d.hor_id
           WHERE o.next_attempt_at <= now()
           ORDER BY o.next_attempt_at, o.dis_id
           LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);
        if (!row) return false;
        try {
          await this.send(row);
          await manager.query('UPDATE booking_stock_outbox SET next_attempt_at=NULL, attempts=0 WHERE dis_id=$1', [row.dis_id]);
        } catch (error) {
          this.logger.warn({
            event: 'booking_stock_retry',
            dis_id: row.dis_id,
            reason: error instanceof Error ? error.message : 'Error desconocido',
          });
          await manager.query(`
            UPDATE booking_stock_outbox SET attempts = attempts + 1,
              version = greatest(version + 1, floor(extract(epoch from clock_timestamp()) * 1000)::bigint),
              next_attempt_at = now() + interval '30 seconds'
            WHERE dis_id=$1`, [row.dis_id]);
        }
        return true;
      });
      if (!processed) break;
    }
  }

  private async send(row: PendingStock) {
    const key = this.config.get<string>('BOOKING_CORE_API_KEY')?.trim();
    if (!key) throw new Error('BOOKING_CORE_API_KEY no configurada');
    const base = (this.config.get<string>('BOOKING_CORE_URL') ?? 'https://booking-core-api.azurewebsites.net').replace(/\/+$/, '');
    this.logger.log({ event: 'booking_stock_enviado', dis_id: row.dis_id });
    const response = await fetch(`${base}/api/v3/inventory/stock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        service_id: row.service_id, item_id: row.item_id, date: row.date,
        time_slot: row.time_slot, available_units: row.available_units,
        timestamp: Number(row.version),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200) throw new Error(`Booking respondio HTTP ${response.status}`);
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' ||
        !('success' in result) || result.success !== true ||
        !('acknowledged' in result) || result.acknowledged !== true ||
        !('service_id' in result) || result.service_id !== row.service_id ||
        !('item_id' in result) || result.item_id !== row.item_id ||
        !('date' in result) || result.date !== row.date ||
        !('available_units' in result) || result.available_units !== row.available_units)
      throw new Error('Booking no confirmo la actualizacion de stock');
    this.logger.log({ event: 'booking_stock_synchronized', dis_id: row.dis_id });
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
  }
}
