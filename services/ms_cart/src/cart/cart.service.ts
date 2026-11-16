import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  SagaStore,
  lockSaga,
  sagaHash,
  PermanentSagaError,
} from '@booking/infrastructure';
import type {
  SagaEvent,
  SagaLine,
  ReservationData,
} from '@booking/infrastructure';
import { InventoryClient } from './inventory.client.js';
import type { AddCartItem } from './cart.schemas.js';

export function idempotencyKey(value: string | undefined): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BadRequestException('Idempotency-Key UUID required');
  }
  return value;
}
interface ReservationRow {
  created_at?: Date | string;
  checkin_en?: string | null;
  state: string;
  paid: boolean;
  stock_confirmed: boolean;
  payload: ReservationData;
}

interface CancellationProgress {
  status: string;
  cancel_code: string;
  reembolso_id: string;
  monto_reembolsado: number;
  refund: {
    refund_id: string;
    status: string;
    amount: number;
    currency: string;
    message: string;
  };
  stock_restoration: {
    status: string;
    restored_spots: number;
    message: string;
  };
  message: string;
}

@Injectable()
export class CartService {
  constructor(
    private readonly source: DataSource,
    private readonly store: SagaStore,
    private readonly inventory: InventoryClient,
    private readonly config: ConfigService,
  ) {}

  async add(userId: string, key: string, body: AddCartItem) {
    if (BigInt(body.attractionId) > 9223372036854775807n)
      throw new BadRequestException('Invalid attractionId');
    return this.store.http(userId, 'cart.add', key, body, async (manager) => {
      await lockSaga(manager, `cart:${userId}`);
      let detail: {
        id: string;
        price: { currency: string; adult: number; child: number };
      };
      try {
        const base = this.config.getOrThrow<string>('CATALOG_BASE_URL');
        const response = await fetch(
          `${base.replace(/\/$/, '')}/atracciones/${encodeURIComponent(body.attractionId)}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (response.status === 404)
          throw new NotFoundException('Attraction unavailable');
        if (!response.ok) throw new Error('Catalog error');
        detail = (await response.json()) as typeof detail;
        if (
          !detail?.id ||
          detail.price?.currency !== 'USD' ||
          ![detail.price.adult, detail.price.child].every(
            (p) => Number.isFinite(p) && p >= 0,
          )
        )
          throw new Error('Invalid quote');
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        throw new ServiceUnavailableException('Catalog quote unavailable');
      }
      const cents =
        Math.round(detail.price.adult * 100) * body.adults +
        Math.round(detail.price.child * 100) * body.children;
      if (!Number.isSafeInteger(cents) || cents < 1 || cents > 999999999999)
        throw new BadRequestException('Invalid quote amount');
      const line: SagaLine = {
        ...body,
        itemId: detail.id,
        serviceId: this.config.getOrThrow<string>('INVENTORY_SERVICE_ID'),
        amountCents: cents,
      };
      if ((await this.inventory.check(line)) < body.adults + body.children)
        throw new ConflictException('Insufficient stock');
      let [cart] = await manager.query<Array<{ car_id: string }>>(
        'SELECT car_id FROM carrito WHERE usu_id=$1 AND car_activo FOR UPDATE',
        [userId],
      );
      if (!cart)
        [cart] = await manager.query<Array<{ car_id: string }>>(
          'INSERT INTO carrito(usu_id) VALUES ($1) RETURNING car_id',
          [userId],
        );
      const existing = await manager.query(
        'SELECT 1 FROM saga_cart_line WHERE car_id=$1 AND item_id=$2 AND date=$3 AND slot_id=$4',
        [cart.car_id, line.itemId, line.date, line.slotId],
      );
      if (existing.length)
        throw new ConflictException(
          'Slot already in cart; use a new cart or remove the existing item',
        );
      const [{ count }] = await manager.query<Array<{ count: string }>>(
        'SELECT count(*) FROM carrito_item WHERE car_id=$1',
        [cart.car_id],
      );
      if (Number(count) >= 20)
        throw new BadRequestException('Cart supports at most 20 items');
      const [item] = await manager.query<Array<{ cai_id: string }>>(
        'INSERT INTO carrito_item(car_id,atr_id,cai_adultos,cai_ninos) VALUES ($1,$2,$3,$4) RETURNING cai_id',
        [cart.car_id, body.attractionId, body.adults, body.children],
      );
      await manager.query(
        'INSERT INTO saga_cart_line(cai_id,car_id,item_id,date,slot_id,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
        [
          item.cai_id,
          cart.car_id,
          line.itemId,
          line.date,
          line.slotId,
          JSON.stringify(line),
        ],
      );
      return { cartId: cart.car_id, itemId: item.cai_id, line };
    });
  }

  async checkout(
    userId: string,
    key: string,
    body: { testMode?: 'test_success' | 'test_fail' },
  ) {
    if (
      body.testMode &&
      (this.config.get('NODE_ENV') === 'production' ||
        this.config.get('PAYMENT_ALLOW_TEST_PAYLOADS') !== 'true')
    ) {
      throw new ForbiddenException('Test payloads disabled');
    }
    return this.store.http(
      userId,
      'cart.checkout',
      key,
      body,
      async (manager) => {
        await lockSaga(manager, `cart:${userId}`);
        const [cart] = await manager.query<Array<{ car_id: string }>>(
          'SELECT car_id FROM carrito WHERE usu_id=$1 AND car_activo FOR UPDATE',
          [userId],
        );
        if (!cart) throw new NotFoundException('Active cart not found');
        const rows = await manager.query<Array<{ payload: SagaLine }>>(
          'SELECT payload FROM saga_cart_line WHERE car_id=$1 ORDER BY cai_id',
          [cart.car_id],
        );
        if (!rows.length) throw new BadRequestException('Cart is empty');
        const ttl = Number(this.config.get('RESERVATION_TTL_SECONDS') ?? 300);
        if (!Number.isInteger(ttl) || ttl < 10 || ttl > 900)
          throw new Error('Invalid RESERVATION_TTL_SECONDS');
        const [{ expires_at }] = await manager.query<
          Array<{ expires_at: Date }>
        >("SELECT now()+($1::int * interval '1 second') AS expires_at", [ttl]);
        const data: ReservationData = {
          reservationId: randomUUID(),
          userId,
          expiresAt: expires_at.toISOString(),
          currency: 'USD',
          amountCents: rows.reduce(
            (sum, row) => sum + row.payload.amountCents,
            0,
          ),
          lines: rows.map((row) => row.payload),
          ...body,
        };
        if (
          !Number.isSafeInteger(data.amountCents) ||
          data.amountCents > 999999999999
        )
          throw new BadRequestException('Cart total too large');
        await manager.query(
          'INSERT INTO saga_cart_reservation(reservation_id,car_id,user_id,payload) VALUES ($1,$2,$3,$4::jsonb)',
          [data.reservationId, cart.car_id, userId, JSON.stringify(data)],
        );
        await manager.query(
          'UPDATE carrito SET car_activo=false WHERE car_id=$1',
          [cart.car_id],
        );
        await this.store.enqueue(manager, 'reserva.creada', data);
        return {
          reservationId: data.reservationId,
          correlationId: data.reservationId,
          expiresAt: data.expiresAt,
          state: 'PENDING',
          amountCents: data.amountCents,
          currency: 'USD',
        };
      },
    );
  }

  async reservation(userId: string, id: string) {
    const [row] = await this.source.query(
      `SELECT reservation_id AS "reservationId",state,payload,r.created_at AS "createdAt",c.response AS cancellation,h.response AS checkin,h.response->>'hora_checkin' AS checkin_en
       FROM saga_cart_reservation r LEFT JOIN saga_http_request c ON c.request_key='cancel:'||r.reservation_id::text
        LEFT JOIN saga_http_request h ON h.request_key='checkin:'||r.reservation_id::text
       WHERE reservation_id=$1 AND user_id=$2`,
      [id, userId],
    );
    if (!row) throw new NotFoundException('Reservation not found');
    return row;
  }

  async list(userId: string) {
    return this.source.query(
      `SELECT reservation_id AS "reservationId",state,paid,stock_confirmed AS "stockConfirmed",
        r.created_at AS "createdAt",payload,c.response AS cancellation,h.response AS checkin,h.response->>'hora_checkin' AS checkin_en FROM saga_cart_reservation r
        LEFT JOIN saga_http_request c ON c.request_key='cancel:'||r.reservation_id::text
        LEFT JOIN saga_http_request h ON h.request_key='checkin:'||r.reservation_id::text
        WHERE user_id=$1 ORDER BY r.created_at DESC LIMIT 100`,
      [userId],
    );
  }

  async adminReservations() {
    return this.source.query(`SELECT r.reservation_id AS "reservationId",r.user_id::text AS "userId",
      state,paid,stock_confirmed AS "stockConfirmed",r.created_at AS "createdAt",payload,
      c.response AS cancellation,h.response AS checkin,h.response->>'hora_checkin' AS checkin_en
      FROM saga_cart_reservation r
      LEFT JOIN saga_http_request c ON c.request_key='cancel:'||r.reservation_id::text
      LEFT JOIN saga_http_request h ON h.request_key='checkin:'||r.reservation_id::text
      ORDER BY r.created_at DESC LIMIT 100`);
  }

  async adminCustomerUserIds() {
    return this.source.query(
      `SELECT DISTINCT user_id::text AS "userId"
         FROM saga_cart_reservation
        WHERE paid=true
        ORDER BY "userId"`,
    );
  }

  async adminSummary() {
    const [reservas] = await this.source.query(`WITH reservations AS (
      SELECT r.*, EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'lines') l
        WHERE l->>'date' = to_char(now() AT TIME ZONE 'America/Guayaquil','YYYY-MM-DD')) AS today,
        EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'lines') l
        WHERE l->>'date' > to_char(now() AT TIME ZONE 'America/Guayaquil','YYYY-MM-DD')) AS upcoming,
        (SELECT COALESCE(sum((l->>'adults')::int + (l->>'children')::int),0)
         FROM jsonb_array_elements(payload->'lines') l
         WHERE l->>'date' >= to_char(now() AT TIME ZONE 'America/Guayaquil','YYYY-MM-DD')) AS persons
      FROM saga_cart_reservation r)
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE state='CONFIRMED')::int AS confirmadas,
        count(*) FILTER (WHERE state='CANCELLED')::int AS canceladas,
        count(*) FILTER (WHERE today AND state='CONFIRMED')::int AS hoy,
        count(*) FILTER (WHERE upcoming AND state='CONFIRMED')::int AS proximas,
        count(*) FILTER (WHERE created_at >= now()-interval '24 hours')::int AS ultimas_24h,
        COALESCE(sum(persons) FILTER (WHERE state='CONFIRMED'),0)::int AS personas_proximas
      FROM reservations`);
    return { reservas };
  }

  async adminUserReservations(userId: string) {
    return this.source.query(`SELECT r.reservation_id AS "reservationId",state,paid,
      stock_confirmed AS "stockConfirmed",r.created_at AS "createdAt",payload,
      c.response AS cancellation,h.response AS checkin,h.response->>'hora_checkin' AS checkin_en
      FROM saga_cart_reservation r
      LEFT JOIN saga_http_request c ON c.request_key='cancel:'||r.reservation_id::text
      LEFT JOIN saga_http_request h ON h.request_key='checkin:'||r.reservation_id::text
      WHERE user_id=$1 ORDER BY r.created_at DESC LIMIT 100`, [userId]);
  }

  async checkin(adminId: string, id: string, body: unknown) {
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const document = typeof input.documento_identidad === 'string' ? input.documento_identidad.trim() : '';
    const guide = typeof input.guia_codigo === 'string' ? input.guia_codigo.trim() : '';
    if (!/^\d{10}(?:\d{3})?$/.test(document) || !guide || guide.length > 100)
      throw new BadRequestException('Documento de 10 o 13 digitos y guia requeridos');
    return this.source.transaction(async manager => {
      const [row] = await manager.query<ReservationRow[]>(
        'SELECT state,paid,stock_confirmed,payload FROM saga_cart_reservation WHERE reservation_id=$1 FOR UPDATE', [id]);
      if (!row) throw new NotFoundException('Reservation not found');
      const [previous] = await manager.query('SELECT response FROM saga_http_request WHERE request_key=$1', [`checkin:${id}`]);
      if (previous) return previous.response;
      const [cancelling] = await manager.query('SELECT response FROM saga_http_request WHERE request_key=$1', [`cancel:${id}`]);
      // Allow check-in for CONFIRMED or PENDING (paid, awaiting stock confirmation) reservations.
      if ((!['CONFIRMED', 'PENDING'].includes(row.state)) || !row.paid || cancelling)
        throw new ConflictException('Solo reservas pagadas y sin cancelacion en proceso');
      // Match the document to the authenticated customer profile, never just accept a typed number.
      const base = this.config.getOrThrow<string>('CLIENT_SERVICE_URL');
      let response: Response;
      try {
        response = await fetch(`${base.replace(/\/$/, '')}?identificacion=${encodeURIComponent(document)}`, { signal: AbortSignal.timeout(4000) });
      } catch { throw new ServiceUnavailableException('No se pudo verificar el documento del cliente'); }
      if (response.status === 404) throw new BadRequestException('Documento del cliente no encontrado');
      if (!response.ok) throw new ServiceUnavailableException('No se pudo verificar el documento del cliente');
      const found = await response.json() as { client_id: string };
      let detail: Response;
      try { detail = await fetch(`${base.replace(/\/$/, '')}/id/${encodeURIComponent(found.client_id)}`, { signal: AbortSignal.timeout(4000) }); }
      catch { throw new ServiceUnavailableException('No se pudo verificar el titular'); }
      if (!detail.ok) throw new ServiceUnavailableException('No se pudo verificar el titular');
      const client = await detail.json() as { usuario_id?: string };
      if (String(client.usuario_id) !== String(row.payload.userId))
        throw new BadRequestException('El documento no corresponde al titular de la reserva');
      const total = row.payload.lines.reduce((sum, line) => sum + line.adults + line.children, 0);
      const attendees = input.asistentes_reales ?? total;
      if (!Number.isInteger(attendees) || Number(attendees) < 1 || Number(attendees) > total)
        throw new BadRequestException('Cantidad de asistentes invalida');
      const receipt = { reserva_id: id, hora_checkin: new Date().toISOString(), asistentes_reales: attendees, guia_codigo: guide, admin_id: adminId };
      await manager.query('INSERT INTO saga_http_request(request_key,payload_hash,response) VALUES ($1,$2,$3::jsonb)',
        [`checkin:${id}`, sagaHash({ id, adminId }), JSON.stringify(receipt)]);
      return receipt;
    });
  }

  async clear(userId: string) {
    return this.source.transaction(async (manager) => {
      await lockSaga(manager, `cart:${userId}`);
      const [cart] = await manager.query<Array<{ car_id: string }>>(
        'SELECT car_id FROM carrito WHERE usu_id=$1 AND car_activo FOR UPDATE',
        [userId],
      );
      if (cart) {
        await manager.query('DELETE FROM saga_cart_line WHERE car_id=$1', [
          cart.car_id,
        ]);
        await manager.query('DELETE FROM carrito_item WHERE car_id=$1', [
          cart.car_id,
        ]);
      }
      return { cleared: true };
    });
  }

  async cancel(userId: string, id: string, authorization: string) {
    const [row] = await this.source.query<ReservationRow[]>(
      `SELECT state,paid,stock_confirmed,payload,created_at,
       (SELECT response->>'hora_checkin' FROM saga_http_request WHERE request_key='checkin:'||reservation_id::text) AS checkin_en
       FROM saga_cart_reservation WHERE reservation_id=$1 AND user_id=$2`,
      [id, userId],
    );
    if (!row) throw new NotFoundException('Reservation not found');
    if (row.checkin_en || ['CHECKED_IN', 'CONFIRMADO_ASISTIDO', 'COMPLETED'].includes(row.state))
      throw new ConflictException({
        title: 'Cancelación No Permitida',
        detail:
          'No se puede cancelar una reserva que ya realizó check-in o fue asistida.',
        status: 409,
      });
    if (row.state === 'CANCELLED') return this.reservation(userId, id);
    if (row.state !== 'CONFIRMED')
      throw new ConflictException(
        'Solo se pueden cancelar reservas confirmadas; espere el resultado del pago',
      );
    const now = Date.now();
    if (
      !row.payload.lines.length ||
      row.payload.lines.some((line) => {
        const startsAt = Date.parse(`${line.date}T${line.timeSlot}-05:00`);
        return !Number.isFinite(startsAt) || startsAt - now < 86_400_000;
      })
    )
      throw new ConflictException({
        title: 'Cancelación Fuera de Plazo',
        status: 409,
        detail:
          'La cancelación y reembolso solo están permitidos con al menos 24 horas de anticipación al horario reservado.',
      });
    const code = `REF-ATR-${id}`;
    const receipt: CancellationProgress = {
      status: 'CANCELLING',
      cancel_code: code,
      reembolso_id: code,
      monto_reembolsado: 0,
      refund: {
        refund_id: code,
        status: 'PENDING',
        amount: row.payload.amountCents / 100,
        currency: row.payload.currency,
        message: 'Reembolso simulado del 100% pendiente.',
      },
      stock_restoration: {
        status: 'PENDING',
        restored_spots: 0,
        message: 'Restitución de cupos pendiente.',
      },
      message: 'Cancelación en proceso.',
    };
    await this.source.transaction(async manager => {
      await manager.query('SELECT reservation_id FROM saga_cart_reservation WHERE reservation_id=$1 FOR UPDATE', [id]);
      const [checkedIn] = await manager.query('SELECT response FROM saga_http_request WHERE request_key=$1', [`checkin:${id}`]);
      if (checkedIn) throw new ConflictException('No se puede cancelar despues del check-in');
      await manager.query(`INSERT INTO saga_http_request(request_key,payload_hash,response) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT (request_key) DO NOTHING`, [`cancel:${id}`, sagaHash({ id, userId }), JSON.stringify(receipt)]);
    });
    let response: Response;
    try {
      const base = this.config.getOrThrow<string>('REFUND_BASE_URL');
      response = await fetch(`${base.replace(/\/$/, '')}/refunds`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization,
        },
        body: JSON.stringify({
          pag_id: userId,
          correlationId: id,
          rem_numero: `RF-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          rem_monto: row.payload.amountCents / 100,
          rem_motivo: 'Cancelación solicitada por el cliente',
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException('Reembolsos no disponible');
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        'No se pudo solicitar el reembolso',
      );
    return { reservationId: id, state: 'REFUND_REQUESTED' };
  }

  async event(event: SagaEvent) {
    await this.store.consume(event, async (manager) => {
      const [row] = await manager.query<ReservationRow[]>(
        'SELECT state,paid,stock_confirmed,payload FROM saga_cart_reservation WHERE reservation_id=$1 FOR UPDATE',
        [event.correlationId],
      );
      if (row) {
        const { reason: _reason, ...original } = event.data;
        if (sagaHash(original) !== sagaHash(row.payload))
          throw new PermanentSagaError('Reservation payload changed');
      }
      // Se confirma cada efecto por separado: CANCELLED puede llegar antes de liberar inventario.
      if (
        row &&
        ['pago.reembolsado', 'inventario_liberado'].includes(event.tipo)
      ) {
        const [saved] = await manager.query<
          Array<{ response: CancellationProgress }>
        >(
          'SELECT response FROM saga_http_request WHERE request_key=$1 FOR UPDATE',
          [`cancel:${event.correlationId}`],
        );
        if (saved) {
          const receipt = saved.response;
          if (event.tipo === 'pago.reembolsado') {
            receipt.refund.status = 'PROCESSED';
            receipt.refund.message = 'Reembolso simulado del 100% procesado.';
            receipt.monto_reembolsado = receipt.refund.amount;
          } else {
            receipt.stock_restoration.status = 'RESTORED';
            receipt.stock_restoration.restored_spots = row.payload.lines.reduce(
              (sum, line) => sum + line.adults + line.children,
              0,
            );
            receipt.stock_restoration.message =
              'Cupos reincorporados a la disponibilidad del operador local.';
          }
          if (
            receipt.refund.status === 'PROCESSED' &&
            receipt.stock_restoration.status === 'RESTORED'
          ) {
            receipt.status = 'CANCELLED';
            receipt.message =
              'Reserva cancelada exitosamente y cupos restituidos.';
          }
          await manager.query(
            'UPDATE saga_http_request SET response=$2::jsonb WHERE request_key=$1',
            [`cancel:${event.correlationId}`, JSON.stringify(receipt)],
          );
        }
      }
      if (!row || row.state === 'CANCELLED') return;
      if (row.state === 'CONFIRMED' && event.tipo !== 'pago.reembolsado')
        return;
      if (
        [
          'pago.fallido',
          'pago_fallido',
          'reserva.rechazada',
          'reserva.expirada',
          'inventario_liberado',
          'pago.reembolsado',
        ].includes(event.tipo)
      ) {
        await manager.query(
          "UPDATE saga_cart_reservation SET state='CANCELLED' WHERE reservation_id=$1",
          [event.correlationId],
        );
        return;
      }
      const paid = row.paid || event.tipo === 'pago.procesado';
      const stock =
        row.stock_confirmed || event.tipo === 'inventario.confirmado';
      await manager.query(
        'UPDATE saga_cart_reservation SET paid=$2,stock_confirmed=$3,state=$4 WHERE reservation_id=$1',
        [
          event.correlationId,
          paid,
          stock,
          paid && stock ? 'CONFIRMED' : 'PENDING',
        ],
      );
    });
  }
}
