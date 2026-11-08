import { Module } from '@nestjs/common';
import { BookingModule } from '../../booking/booking.module.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AtraccionEntity } from '../../database/entities/atraccion.entity.js';
import { AtraccionCategoriaEntity } from '../../database/entities/atraccion-categoria.entity.js';
import { AtraccionIdiomaEntity } from '../../database/entities/atraccion-idioma.entity.js';
import { AtraccionInclusionEntity } from '../../database/entities/atraccion-inclusion.entity.js';
import { AtraccionFotoEntity } from '../../database/entities/atraccion-foto.entity.js';
import { OperadorEntity } from '../../database/entities/operador.entity.js';
import { CategoriaEntity } from '../../database/entities/categoria.entity.js';
import { IdiomaEntity } from '../../database/entities/idioma.entity.js';
import { InclusionEntity } from '../../database/entities/inclusion.entity.js';
import { AttractionsService } from './attractions.service.js';
import { AttractionsController } from './attractions.controller.js';
import {
  BookingContractController,
  BookingRootHealthController,
} from './booking-contract.controller.js';
import { AdminReservationsController } from './admin-reservations.controller.js';
import {
  CheckinController,
  ClientsController,
} from './clients-checkin.controller.js';
import { AdminLookupsController } from './admin-lookups.controller.js';
import { AdminListController } from './admin-list.controller.js';
import { AdminAvailabilityController } from './admin-availability.controller.js';
import { BookingProfileEntity } from '../../booking/booking-profile.entity.js';

@Module({
  imports: [
    BookingModule,
    TypeOrmModule.forFeature([
      AtraccionEntity,
      BookingProfileEntity,
      AtraccionCategoriaEntity,
      AtraccionIdiomaEntity,
      AtraccionInclusionEntity,
      AtraccionFotoEntity,
      OperadorEntity,
      CategoriaEntity,
      IdiomaEntity,
      InclusionEntity,
    ]),
  ],
  controllers: [
    ClientsController,
    CheckinController,
    BookingContractController,
    BookingRootHealthController,
    AdminReservationsController,
    AdminLookupsController,
    AdminListController,
    AdminAvailabilityController,
    AttractionsController,
  ],
  providers: [AttractionsService],
  exports: [AttractionsService],
})
export class AttractionsModule {}
