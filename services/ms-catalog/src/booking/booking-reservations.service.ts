import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { InventoryAdminService } from './inventory-admin.service.js';
import { BookingClientsService } from './booking-clients.service.js';

export interface BookingReservationInput {
  atraccion_id: string;
  fecha: string;
  hora: string;
  personas: number;
  cliente_nombre: string;
  cliente_email: string;
  cliente_identificacion?: string;
  cliente_telefono?: string;
}

@Injectable()
export class BookingReservationsService {
  constructor(
    private readonly source: DataSource,
    private readonly inventory: InventoryAdminService,
    private readonly clients: BookingClientsService,
  ) {}

  async create(input: BookingReservationInput, key?: string) {
    await this.clients.ensureReservationColumns();
    if (key !== undefined && !/^[\w-]{8,128}$/.test(key))
      throw new BadRequestException('Idempotency-Key invalida');
    const hash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    // Persistir PENDIENTE antes del RPC permite recuperar una respuesta perdida sin vender dos veces.
    const id = await this.source.transaction(async (manager) => {
      if (key) {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [`booking:${key}`],
        );
        const [prior] = await manager.query<
          Array<{ res_uuid: string; res_payload_hash: string }>
        >(
          'SELECT res_uuid,res_payload_hash FROM reserva_atraccion WHERE res_idempotency_key=$1',
          [key],
        );
        if (prior) {
          if (prior.res_payload_hash !== hash)
            throw new ConflictException(
              'Idempotency-Key reutilizada con otros datos',
            );
          return prior.res_uuid;
        }
      }
      const [attraction] = await manager.query<Array<{ atr_id: string }>>(
        `SELECT atr_id FROM atraccion WHERE (atr_uuid::text=lower($1) OR atr_id::text=$1)
         AND atr_estado='PUBLICADA' AND atr_eliminado_en IS NULL`,
        [input.atraccion_id],
      );
      if (!attraction) throw new NotFoundException('Atraccion no disponible');
      const reservationId = randomUUID();
      const { client } = await this.clients.register(
        {
          nombre: input.cliente_nombre,
          email: input.cliente_email.toLowerCase(),
          identificacion: input.cliente_identificacion,
          telefono: input.cliente_telefono,
        },
        manager,
      );
      await manager.query(
        `INSERT INTO reserva_atraccion
        (res_uuid,atr_id,res_fecha,res_hora,res_personas,res_cliente_nombre,res_cliente_email,res_estado,res_idempotency_key,res_payload_hash,res_cliente_uuid)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDIENTE',$8,$9,$10::uuid)`,
        [
          reservationId,
          attraction.atr_id,
          input.fecha,
          input.hora,
          input.personas,
          input.cliente_nombre,
          input.cliente_email,
          key ?? null,
          hash,
          client.client_id,
        ],
      );
      return reservationId;
    });
    return this.source.transaction(async (manager) => {
      const [row] = await manager.query<
        Array<{ res_estado: string; item_id: string; atr_nombre: string }>
      >(
        `SELECT r.res_estado,a.atr_uuid::text AS item_id,a.atr_nombre FROM reserva_atraccion r
         JOIN atraccion a USING(atr_id) WHERE r.res_uuid=$1 FOR UPDATE OF r`,
        [id],
      );
      if (!row) throw new NotFoundException('Reserva no encontrada');
      if (row.res_estado === 'CANCELADA' || row.res_estado === 'CANCELANDO')
        throw new ConflictException(
          'Reserva cancelada o cancelacion en proceso',
        );
      if (row.res_estado !== 'CONFIRMADA') {
        await this.inventory.reserveBooking({
          reservationId: id,
          itemId: row.item_id,
          date: input.fecha,
          timeSlot: input.hora,
          quantity: input.personas,
        });
        await manager.query(
          "UPDATE reserva_atraccion SET res_estado='CONFIRMADA' WHERE res_uuid=$1",
          [id],
        );
      }
      return {
        reserva_id: id,
        estado: 'CONFIRMADA',
        atraccion_id: input.atraccion_id,
        atraccion: row.atr_nombre,
        fecha: input.fecha,
        hora: input.hora,
        personas: input.personas,
      };
    });
  }

  async cancel(id: string) {
    // La intencion de cancelar sobrevive a una caida entre el RPC y el commit local.
    await this.source.transaction(async (manager) => {
      const [row] = await manager.query<Array<{ res_estado: string }>>(
        'SELECT res_estado FROM reserva_atraccion WHERE res_uuid=$1 FOR UPDATE',
        [id],
      );
      if (!row) throw new NotFoundException('Reserva no encontrada');
      if (row.res_estado !== 'CANCELADA')
        await manager.query(
          "UPDATE reserva_atraccion SET res_estado='CANCELANDO' WHERE res_uuid=$1",
          [id],
        );
    });
    return this.source.transaction(async (manager) => {
      const [row] = await manager.query<
        Array<{ res_uuid: string; res_estado: string }>
      >(
        'SELECT res_uuid,res_estado FROM reserva_atraccion WHERE res_uuid=$1 FOR UPDATE',
        [id],
      );
      if (!row) throw new NotFoundException('Reserva no encontrada');
      // Tambien se ejecuta al reintentar: Inventory libera una sola vez.
      await this.inventory.releaseBooking(id);
      await manager.query(
        "UPDATE reserva_atraccion SET res_estado='CANCELADA' WHERE res_uuid=$1",
        [id],
      );
      return { reserva_id: id, estado: 'CANCELADA' };
    });
  }
}
