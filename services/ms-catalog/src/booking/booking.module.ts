import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RabbitMqModule, JsonSchemaModule } from '@booking/infrastructure';
import { AtraccionEntity } from '../database/entities/atraccion.entity.js';
import { CategoriaEntity } from '../database/entities/categoria.entity.js';
import { BookingProfileEntity } from './booking-profile.entity.js';
import { BookingCatalogService } from './booking-catalog.service.js';
import { CatalogEventsService } from './catalog-events.service.js';
import { ReviewEventsController } from './review-events.controller.js';
import { ReviewProjectionService } from './review-projection.service.js';
import { InventoryAvailabilityService } from './inventory-availability.service.js';
import { InventoryAdminService } from './inventory-admin.service.js';
import { BookingReservationsService } from './booking-reservations.service.js';
import { BookingClientsService } from './booking-clients.service.js';
import { BookingCheckinService } from './booking-checkin.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AtraccionEntity,
      CategoriaEntity,
      BookingProfileEntity,
    ]),
    RabbitMqModule,
    JsonSchemaModule,
  ],
  controllers: [ReviewEventsController],
  providers: [
    BookingClientsService,
    BookingCheckinService,
    BookingReservationsService,
    BookingCatalogService,
    ReviewProjectionService,
    CatalogEventsService,
    InventoryAvailabilityService,
    InventoryAdminService,
  ],
  exports: [
    BookingCatalogService,
    CatalogEventsService,
    InventoryAdminService,
    BookingReservationsService,
    BookingClientsService,
    BookingCheckinService,
  ],
})
export class BookingModule {}
