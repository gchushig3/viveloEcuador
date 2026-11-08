import { ConflictException, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource, EntityManager } from 'typeorm';
import { SagaStore, lockSaga, sagaHash } from '@booking/infrastructure';
import { invalid, timestamp, time24, validateSlot } from './slot.js';
import type { SlotKey, StockDelta, StockUpdate } from './slot.js';

export interface SlotRow {
  dis_id: string;
  dis_cupo_total: number;
  dis_cupo_reservado: number;
  dis_cerrada: boolean;
  hor_activo: boolean;
  source_timestamp: string;
  zero_capacity: boolean;
  service_id: string;
  item_id: string;
  slot_id: string;
  date: string;
  time_slot: string;
}

@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    private readonly source: DataSource,
    private readonly store: SagaStore,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.source
      .query(`CREATE TABLE IF NOT EXISTS booking_inventory_allocation (
      reservation_id UUID PRIMARY KEY, payload_hash TEXT,
      dis_id BIGINT REFERENCES disponibilidad(dis_id), quantity INTEGER,
      state TEXT NOT NULL CHECK(state IN ('CONFIRMED','RELEASED'))
    )`);
  }

  async find(
    manager: EntityManager,
    key: SlotKey,
    lock = false,
  ): Promise<SlotRow | undefined> {
    const [row] = await manager.query<SlotRow[]>(
      `SELECT s.*,d.dis_cupo_total,d.dis_cupo_reservado,d.dis_cerrada,h.hor_activo
      FROM saga_inventory_slot s JOIN disponibilidad d USING(dis_id) JOIN horario h ON h.hor_id=d.hor_id
      WHERE s.service_id=$1 AND s.item_id=$2 AND s.date=$3 AND s.slot_id=$4 ${lock ? 'FOR UPDATE OF s,d' : ''}`,
      [key.serviceId, key.itemId, key.date, key.slotId],
    );
    return row;
  }

  async availability(key: SlotKey) {
    validateSlot(key);
    const row = await this.find(this.source.manager, key);
    if (!row)
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Slot not found',
      });
    const available =
      row.dis_cerrada || !row.hor_activo
        ? 0
        : row.dis_cupo_total - row.dis_cupo_reservado;
    return {
      itemId: key.itemId,
      slotId: key.slotId,
      date: key.date,
      timeSlot: time24(key.timeSlot),
      availableUnits: available,
      status:
        available === 0
          ? 'AGOTADO'
          : available <= 5
            ? 'ULTIMOS_CUPOS'
            : 'DISPONIBLE',
      lastUpdatedEpoch: row.source_timestamp,
    };
  }

  async reserveBooking(input: {
    reservationId: string;
    itemId: string;
    date: string;
    timeSlot: string;
    quantity: number;
  }) {
    if (
      !BOOKING_UUID.test(input.reservationId) ||
      typeof input.date !== 'string' ||
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 100
    )
      invalid('Invalid booking allocation');
    const time = time24(input.timeSlot);
    const key = {
      serviceId: this.config.getOrThrow<string>('INVENTORY_SERVICE_ID'),
      itemId: input.itemId,
      date: input.date,
      timeSlot: time,
      slotId: `slot-${input.date.replaceAll('-', '')}-${time.slice(0, 5).replace(':', '')}`,
    };
    validateSlot(key);
    const hash = sagaHash({ ...input, timeSlot: time });
    return this.source.transaction(async (manager) => {
      await lockSaga(manager, `booking:${input.reservationId}`);
      const [prior] = await manager.query<
        Array<{ payload_hash: string; state: string }>
      >(
        'SELECT payload_hash,state FROM booking_inventory_allocation WHERE reservation_id=$1',
        [input.reservationId],
      );
      if (prior) {
        if (prior.state === 'RELEASED' || prior.payload_hash !== hash)
          throw new RpcException({
            code: status.FAILED_PRECONDITION,
            message: 'Booking already released or payload changed',
          });
        return { state: prior.state };
      }
      const row = await this.find(manager, key, true);
      if (
        !row ||
        row.dis_cerrada ||
        !row.hor_activo ||
        row.dis_cupo_total - row.dis_cupo_reservado < input.quantity
      )
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: `Cupos agotados para este horario. Disponibles: ${!row || row.dis_cerrada || !row.hor_activo ? 0 : Math.max(0, row.dis_cupo_total - row.dis_cupo_reservado)}.`,
        });
      await manager.query(
        'UPDATE disponibilidad SET dis_cupo_reservado=dis_cupo_reservado+$2 WHERE dis_id=$1',
        [row.dis_id, input.quantity],
      );
      await manager.query(
        "INSERT INTO booking_inventory_allocation(reservation_id,payload_hash,dis_id,quantity,state) VALUES ($1,$2,$3,$4,'CONFIRMED')",
        [input.reservationId, hash, row.dis_id, input.quantity],
      );
      return { state: 'CONFIRMED' };
    });
  }

  async releaseBooking(reservationId: string) {
    if (!BOOKING_UUID.test(reservationId))
      invalid('Invalid booking reservation');
    return this.source.transaction(async (manager) => {
      await lockSaga(manager, `booking:${reservationId}`);
      const [prior] = await manager.query<
        Array<{ dis_id: string; quantity: number; state: string }>
      >(
        'SELECT dis_id,quantity,state FROM booking_inventory_allocation WHERE reservation_id=$1',
        [reservationId],
      );
      if (prior?.state === 'CONFIRMED') {
        await manager.query(
          'UPDATE disponibilidad SET dis_cupo_reservado=dis_cupo_reservado-$2 WHERE dis_id=$1',
          [prior.dis_id, prior.quantity],
        );
        await manager.query(
          "UPDATE booking_inventory_allocation SET state='RELEASED' WHERE reservation_id=$1",
          [reservationId],
        );
      } else if (!prior) {
        // Una cancelacion adelantada impide que un reintento tardio vuelva a reservar.
        await manager.query(
          "INSERT INTO booking_inventory_allocation(reservation_id,state) VALUES ($1,'RELEASED')",
          [reservationId],
        );
      }
      return { state: 'RELEASED' };
    });
  }

  async snapshot(input: StockUpdate) {
    validateSlot(input);
    const stamp = timestamp(input.timestamp);
    if (
      !Number.isInteger(input.availableUnits) ||
      input.availableUnits < 0 ||
      input.availableUnits > 2147483647
    )
      invalid('Invalid available_units');
    return this.source.transaction(async (manager) => {
      const row = await this.find(manager, input, true);
      if (!row)
        return {
          success: false,
          errorCode: 'ITEM_NOT_FOUND',
          currentAvailable: 0,
          message: 'Register the slot before synchronization',
          processedAt: String(Date.now()),
        };
      const free = row.dis_cupo_total - row.dis_cupo_reservado;
      const stale = BigInt(stamp) <= BigInt(row.source_timestamp);
      if (!stale) {
        // Snapshot externo no puede restaurar cupos retenidos/confirmados localmente.
        const available = row.dis_cupo_reservado
          ? Math.min(free, input.availableUnits)
          : input.availableUnits;
        const total = row.dis_cupo_reservado + available;
        await manager.query(
          'UPDATE disponibilidad SET dis_cupo_total=$2 WHERE dis_id=$1',
          [row.dis_id, total || 1],
        );
        // dis_cupo_total > 0 en el SQL oficial; un slot externo a cero se cierra.
        await manager.query(
          'UPDATE disponibilidad SET dis_cerrada=$2 WHERE dis_id=$1',
          [row.dis_id, total === 0],
        );
        await manager.query(
          'UPDATE saga_inventory_slot SET source_timestamp=$2,zero_capacity=$3 WHERE dis_id=$1',
          [row.dis_id, stamp, total === 0],
        );
        return {
          success: true,
          errorCode: 'OK',
          currentAvailable: available,
          message: 'Stock synchronized',
          processedAt: String(Date.now()),
        };
      }
      return {
        success: true,
        errorCode: 'STALE_TIMESTAMP_IGNORED',
        currentAvailable: row.dis_cerrada ? 0 : free,
        message: 'Stale snapshot ignored',
        processedAt: String(Date.now()),
      };
    });
  }

  async delta(input: StockDelta): Promise<boolean> {
    validateSlot(input);
    const stamp = timestamp(input.timestamp);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.eventId,
      ) ||
      !Number.isInteger(input.delta) ||
      Math.abs(input.delta) > 2147483647
    )
      invalid('Invalid delta/event_id');
    return this.source.transaction(async (manager) => {
      await lockSaga(manager, input.eventId);
      const hash = sagaHash(input);
      const [prior] = await manager.query<Array<{ payload_hash: string }>>(
        'SELECT payload_hash FROM saga_inbox WHERE event_id=$1',
        [input.eventId],
      );
      if (prior) {
        if (prior.payload_hash !== hash) invalid('Event ID reused');
        return false;
      }
      const row = await this.find(manager, input, true);
      if (!row)
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Slot not registered',
        });
      let applied = false;
      if (BigInt(stamp) >= BigInt(row.source_timestamp)) {
        const total =
          (row.zero_capacity ? 0 : row.dis_cupo_total) + input.delta;
        if (total < row.dis_cupo_reservado || total > 2147483647 || total < 0)
          throw new RpcException({
            code: status.RESOURCE_EXHAUSTED,
            message: 'Delta conflicts with active allocations',
          });
        await manager.query(
          'UPDATE disponibilidad SET dis_cupo_total=$2,dis_cerrada=$3 WHERE dis_id=$1',
          [row.dis_id, total || 1, total === 0],
        );
        await manager.query(
          'UPDATE saga_inventory_slot SET source_timestamp=$2,zero_capacity=$3 WHERE dis_id=$1',
          [row.dis_id, stamp, total === 0],
        );
        applied = true;
      }
      await manager.query(
        'INSERT INTO saga_inbox(event_id,payload_hash) VALUES ($1,$2)',
        [input.eventId, hash],
      );
      return applied;
    });
  }

  async register(
    userId: string,
    key: string,
    body: {
      attractionId: string;
      itemId: string;
      date: string;
      timeSlot: string;
      capacity: number;
    },
  ) {
    const time = time24(body.timeSlot);
    const slot: SlotKey = {
      serviceId: this.config.getOrThrow<string>('INVENTORY_SERVICE_ID'),
      itemId: body.itemId,
      date: body.date,
      timeSlot: time,
      slotId: `slot-${body.date.replaceAll('-', '')}-${time.slice(0, 5).replace(':', '')}`,
    };
    validateSlot(slot);
    if (BigInt(body.attractionId) > 9223372036854775807n)
      invalid('Invalid attractionId');
    return this.store.http(
      userId,
      'inventory.register',
      key,
      body,
      async (manager) => {
        await lockSaga(manager, `inventory:${body.attractionId}:${time}`);
        const [schedule] = await manager.query<Array<{ hor_id: string }>>(
          `INSERT INTO horario(atr_id,hor_hora,hor_cupo) VALUES ($1,$2,$3)
        ON CONFLICT(atr_id,hor_hora) DO UPDATE SET hor_hora=EXCLUDED.hor_hora RETURNING hor_id`,
          [body.attractionId, time, body.capacity],
        );
        const prior = await manager.query(
          'SELECT 1 FROM disponibilidad WHERE atr_id=$1 AND hor_id=$2 AND dis_fecha=$3',
          [body.attractionId, schedule.hor_id, body.date],
        );
        if (prior.length)
          throw new ConflictException('Slot already registered');
        const [availability] = await manager.query<Array<{ dis_id: string }>>(
          'INSERT INTO disponibilidad(atr_id,hor_id,dis_fecha,dis_cupo_total) VALUES ($1,$2,$3,$4) RETURNING dis_id',
          [body.attractionId, schedule.hor_id, body.date, body.capacity],
        );
        await manager.query(
          'INSERT INTO saga_inventory_slot(service_id,item_id,date,slot_id,time_slot,dis_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            slot.serviceId,
            slot.itemId,
            slot.date,
            slot.slotId,
            time,
            availability.dis_id,
          ],
        );
        return { ...slot, availabilityId: availability.dis_id };
      },
    );
  }

  private adminView(row: {
    slot_id: string;
    date: string;
    time_slot: string;
    total: number;
    reserved: number;
    closed: boolean;
  }) {
    const available = row.closed ? 0 : Math.max(0, row.total - row.reserved);
    return {
      slotId: row.slot_id,
      date: row.date,
      timeSlot: row.time_slot.slice(0, 5),
      total: row.total,
      reserved: row.reserved,
      available,
      closed: row.closed,
      status:
        row.closed || available === 0
          ? 'AGOTADO'
          : available <= 5
            ? 'ULTIMOS_CUPOS'
            : 'DISPONIBLE',
    };
  }

  async listSlots(input: { itemId: string; from: string; to: string }) {
    if (
      typeof input.itemId !== 'string' ||
      !input.itemId ||
      input.itemId.length > 220 ||
      !validDate(input.from) ||
      !validDate(input.to) ||
      input.from > input.to
    )
      invalid('Invalid slot query');
    const rows = await this.source.query<
      Array<{
        slot_id: string;
        date: string;
        time_slot: string;
        total: number;
        reserved: number;
        closed: boolean;
      }>
    >(
      `SELECT s.slot_id, to_char(s.date,'YYYY-MM-DD') AS date, s.time_slot::text AS time_slot,
        CASE WHEN s.zero_capacity THEN 0 ELSE d.dis_cupo_total END::int AS total,
        d.dis_cupo_reservado::int AS reserved, (d.dis_cerrada OR NOT h.hor_activo) AS closed
      FROM saga_inventory_slot s JOIN disponibilidad d USING(dis_id) JOIN horario h ON h.hor_id=d.hor_id
      WHERE s.service_id=$1 AND s.item_id=$2 AND s.date BETWEEN $3 AND $4
      ORDER BY s.date, s.time_slot LIMIT 1000`,
      [
        this.config.getOrThrow<string>('INVENTORY_SERVICE_ID'),
        input.itemId,
        input.from,
        input.to,
      ],
    );
    return { slots: rows.map((row) => this.adminView(row)) };
  }

  async registerSlots(input: {
    attractionId: string;
    itemId: string;
    dates: string[];
    timeSlots: string[];
    capacity: number;
  }) {
    if (
      !/^[1-9]\d{0,17}$/.test(String(input.attractionId)) ||
      typeof input.itemId !== 'string' ||
      !input.itemId ||
      input.itemId.length > 220 ||
      !Array.isArray(input.dates) ||
      !Array.isArray(input.timeSlots) ||
      !input.dates.length ||
      !input.timeSlots.length ||
      input.dates.length > 120 ||
      input.timeSlots.length > 24 ||
      !input.dates.every(validDate) ||
      !Number.isInteger(input.capacity) ||
      input.capacity < 1 ||
      input.capacity > 2147483647
    )
      invalid('Invalid slot batch');
    const dates = [...new Set(input.dates)];
    const times = [...new Set(input.timeSlots.map(time24))];
    const serviceId = this.config.getOrThrow<string>('INVENTORY_SERVICE_ID');
    return this.source.transaction(async (manager) => {
      let created = 0;
      let skipped = 0;
      for (const time of times) {
        await lockSaga(manager, `inventory:${input.attractionId}:${time}`);
        const [schedule] = await manager.query<Array<{ hor_id: string }>>(
          `INSERT INTO horario(atr_id,hor_hora,hor_cupo) VALUES ($1,$2,$3)
          ON CONFLICT(atr_id,hor_hora) DO UPDATE SET hor_hora=EXCLUDED.hor_hora RETURNING hor_id`,
          [input.attractionId, time, input.capacity],
        );
        for (const date of dates) {
          const prior = await manager.query(
            'SELECT 1 FROM disponibilidad WHERE atr_id=$1 AND hor_id=$2 AND dis_fecha=$3',
            [input.attractionId, schedule.hor_id, date],
          );
          if (prior.length) {
            skipped++;
            continue;
          }
          const [availability] = await manager.query<Array<{ dis_id: string }>>(
            'INSERT INTO disponibilidad(atr_id,hor_id,dis_fecha,dis_cupo_total) VALUES ($1,$2,$3,$4) RETURNING dis_id',
            [input.attractionId, schedule.hor_id, date, input.capacity],
          );
          await manager.query(
            'INSERT INTO saga_inventory_slot(service_id,item_id,date,slot_id,time_slot,dis_id) VALUES ($1,$2,$3,$4,$5,$6)',
            [
              serviceId,
              input.itemId,
              date,
              `slot-${date.replaceAll('-', '')}-${time.slice(0, 5).replace(':', '')}`,
              time,
              availability.dis_id,
            ],
          );
          created++;
        }
      }
      return { created, skipped };
    });
  }

  async updateSlot(input: {
    itemId: string;
    date: string;
    timeSlot: string;
    capacity: number;
    closed: boolean;
  }) {
    const time = time24(input.timeSlot);
    const key: SlotKey = {
      serviceId: this.config.getOrThrow<string>('INVENTORY_SERVICE_ID'),
      itemId: input.itemId,
      date: input.date,
      timeSlot: time,
      slotId: `slot-${String(input.date).replaceAll('-', '')}-${time.slice(0, 5).replace(':', '')}`,
    };
    validateSlot(key);
    if (
      !Number.isInteger(input.capacity) ||
      input.capacity < 1 ||
      input.capacity > 2147483647
    )
      invalid('Invalid capacity');
    return this.source.transaction(async (manager) => {
      const row = await this.find(manager, key, true);
      if (!row)
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Slot not found',
        });
      if (input.capacity < row.dis_cupo_reservado)
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: `La capacidad no puede ser menor a los cupos ya reservados (${row.dis_cupo_reservado})`,
        });
      const closed = input.closed === true;
      await manager.query(
        'UPDATE disponibilidad SET dis_cupo_total=$2,dis_cerrada=$3 WHERE dis_id=$1',
        [row.dis_id, input.capacity, closed],
      );
      // Un cambio del administrador invalida snapshots anteriores de la tienda socia.
      await manager.query(
        'UPDATE saga_inventory_slot SET source_timestamp=$2,zero_capacity=false WHERE dis_id=$1',
        [row.dis_id, String(Date.now())],
      );
      return this.adminView({
        slot_id: key.slotId,
        date: key.date,
        time_slot: time,
        total: input.capacity,
        reserved: row.dis_cupo_reservado,
        closed,
      });
    });
  }
}

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
const BOOKING_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
