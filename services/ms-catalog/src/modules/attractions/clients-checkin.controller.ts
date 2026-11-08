import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BookingClientsService,
  parseClientInput,
} from '../../booking/booking-clients.service.js';
import {
  BookingCheckinService,
  parseCheckinInput,
} from '../../booking/booking-checkin.service.js';
import { PublicEndpoint } from '../../common/public-endpoint.decorator.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clientes cross-platform consultados por Booking Central (contrato v3.1). */
@ApiTags('Clientes')
@Controller('clientes')
export class ClientsController {
  constructor(private readonly clients: BookingClientsService) {}

  @Get()
  @PublicEndpoint()
  @ApiOperation({ summary: 'Buscar turista por email o identificacion' })
  async find(
    @Query('email') email?: string,
    @Query('identificacion') identificacion?: string,
  ) {
    if (
      (email !== undefined && typeof email !== 'string') ||
      (identificacion !== undefined && typeof identificacion !== 'string')
    )
      throw new BadRequestException('Parametros invalidos');
    const client = await this.clients.find(email, identificacion);
    if (!client) throw new NotFoundException('Cliente no encontrado');
    return {
      client_id: client.client_id,
      nombre: client.nombre,
      email: client.email,
      identificacion: client.identificacion,
    };
  }

  @Post()
  @PublicEndpoint()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar turista (sin duplicar)' })
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: { status(code: number): unknown },
  ) {
    const { client, created } = await this.clients.register(
      parseClientInput(body),
    );
    if (!created) res.status(HttpStatus.OK);
    return { client_id: client.client_id };
  }
}

/** Check-in presencial: lo ejecuta el guia/administrador autenticado. */
@ApiTags('Administracion')
@ApiBearerAuth('jwt')
@Controller('atracciones/reservas')
export class CheckinController {
  constructor(private readonly checkin: BookingCheckinService) {}

  @Post(':id/checkin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar asistencia, emitir pase y notificar a Booking',
  })
  async run(@Param('id') id: string, @Body() body: unknown) {
    if (!UUID.test(id)) throw new BadRequestException('reserva_id invalido');
    return this.checkin.checkin(id.toLowerCase(), parseCheckinInput(body));
  }
}
