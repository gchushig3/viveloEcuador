import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnApplicationShutdown,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxyFactory } from '@nestjs/microservices';
import type { ClientGrpc } from '@nestjs/microservices';
import { Metadata, status } from '@grpc/grpc-js';
import { inventoryGrpcOptions } from '@booking/infrastructure';
import { firstValueFrom, timeout } from 'rxjs';
import type { Observable } from 'rxjs';

export interface AdminSlot {
  slotId: string;
  date: string;
  timeSlot: string;
  total: number;
  reserved: number;
  available: number;
  closed: boolean;
  status: string;
}

interface InventoryAdminClient {
  reserveBooking(
    request: {
      reservationId: string;
      itemId: string;
      date: string;
      timeSlot: string;
      quantity: number;
    },
    metadata: Metadata,
  ): Observable<{ state: string }>;
  releaseBooking(
    request: { reservationId: string },
    metadata: Metadata,
  ): Observable<{ state: string }>;
  listSlots(
    request: { itemId: string; from: string; to: string },
    metadata: Metadata,
  ): Observable<{ slots?: AdminSlot[] }>;
  registerSlots(
    request: {
      attractionId: string;
      itemId: string;
      dates: string[];
      timeSlots: string[];
      capacity: number;
    },
    metadata: Metadata,
  ): Observable<{ created: number; skipped: number }>;
  updateSlot(
    request: {
      itemId: string;
      date: string;
      timeSlot: string;
      capacity: number;
      closed: boolean;
    },
    metadata: Metadata,
  ): Observable<AdminSlot>;
}

/** Cliente gRPC del servicio de administracion de cupos de Inventory. */
@Injectable()
export class InventoryAdminService implements OnApplicationShutdown {
  private readonly logger = new Logger(InventoryAdminService.name);
  private client?: ClientGrpc & { close(): void };
  private service?: InventoryAdminClient;
  constructor(private readonly config: ConfigService) {}

  private get api(): InventoryAdminClient {
    if (!this.service) {
      this.client = ClientProxyFactory.create(
        inventoryGrpcOptions(this.config),
      ) as unknown as ClientGrpc & { close(): void };
      this.service = this.client.getService<InventoryAdminClient>(
        'InventoryAdminService',
      );
    }
    return this.service;
  }

  private metadata(): Metadata {
    const key = this.config.get<string>('INVENTORY_SYNC_API_KEY');
    if (!key)
      throw new ServiceUnavailableException(
        'La clave de sincronizacion de Inventory no esta configurada',
      );
    const metadata = new Metadata();
    metadata.set('x-api-key', key);
    return metadata;
  }

  private async call<T>(operation: string, run: () => Observable<T>): Promise<T> {
    this.logger.log({ event: 'grpc_inventario_emitido', operation });
    try {
      const result = await firstValueFrom(run().pipe(timeout(8000)));
      this.logger.log({ event: 'grpc_inventario_completado', operation });
      return result;
    } catch (error) {
      this.logger.warn({ event: 'grpc_inventario_fallido', operation });
      if (error instanceof ServiceUnavailableException) throw error;
      const rpc = error as {
        code?: number;
        details?: string;
        message?: string;
      };
      const detail = rpc.details ?? rpc.message ?? 'error de Inventory';
      if (rpc.code === status.INVALID_ARGUMENT)
        throw new BadRequestException(detail);
      if (rpc.code === status.NOT_FOUND) throw new NotFoundException(detail);
      if (rpc.code === status.RESOURCE_EXHAUSTED)
        throw new ConflictException({
          type: 'https://booking.epn.edu.ec/errors/sin-cupos',
          title: 'Cupos Agotados para el Turno Horario',
          status: 409,
          code: 'OUT_OF_STOCK',
          detail,
        });
      if (rpc.code === status.FAILED_PRECONDITION)
        throw new ConflictException(detail);
      throw new ServiceUnavailableException(
        'Inventory no disponible para administrar cupos',
      );
    }
  }

  async list(itemId: string, from: string, to: string): Promise<AdminSlot[]> {
    const response = await this.call('ListSlots', () =>
      this.api.listSlots({ itemId, from, to }, this.metadata()),
    );
    return response.slots ?? [];
  }

  reserveBooking(input: {
    reservationId: string;
    itemId: string;
    date: string;
    timeSlot: string;
    quantity: number;
  }) {
    return this.call('ReserveBooking', () => this.api.reserveBooking(input, this.metadata()));
  }

  releaseBooking(reservationId: string) {
    return this.call('ReleaseBooking', () =>
      this.api.releaseBooking({ reservationId }, this.metadata()),
    );
  }

  register(input: {
    attractionId: string;
    itemId: string;
    dates: string[];
    timeSlots: string[];
    capacity: number;
  }) {
    return this.call('RegisterSlots', () => this.api.registerSlots(input, this.metadata()));
  }

  update(input: {
    itemId: string;
    date: string;
    timeSlot: string;
    capacity: number;
    closed: boolean;
  }) {
    return this.call('UpdateSlot', () => this.api.updateSlot(input, this.metadata()));
  }

  onApplicationShutdown() {
    this.client?.close();
  }
}
