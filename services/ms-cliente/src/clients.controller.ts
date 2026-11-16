import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClientsService, parseInput } from './clients.service.js';

@ApiTags('Clientes')
@Controller('clientes')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  async find(@Query('email') email?: string, @Query('identificacion') identificacion?: string) {
    const client = await this.clients.find(email, identificacion);
    if (!client) throw new NotFoundException('Cliente no encontrado');
    return {
      client_id: client.client_id,
      nombre: client.nombre,
      email: client.email,
      identificacion: client.identificacion,
    };
  }

  @Get('id/:id')
  async byId(@Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('client_id invalido');
    return this.clients.byId(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @Res({ passthrough: true }) response: { status(code: number): unknown }) {
    const { client, created } = await this.clients.register({ ...parseInput(body), origen: 'BOOKING' });
    if (!created) response.status(HttpStatus.OK);
    return { client_id: client.client_id };
  }

  @Post('integration/register')
  async registerIntegration(@Body() body: unknown) {
    const { client, created } = await this.clients.register({ ...parseInput(body), origen: 'BOOKING' });
    return { ...(created ? {} : { reused: true }), client_id: client.client_id, cliente: client };
  }

  @Post('web/register')
  @HttpCode(HttpStatus.OK)
  async registerWeb(@Body() body: unknown, @Headers('x-user-id') userId?: string) {
    if (!userId) throw new BadRequestException('usuario autenticado requerido');
    const { client, created } = await this.clients.register({
      ...parseInput(body, userId),
      origen: 'TIENDA',
    });
    return { ...(created ? {} : { reused: true }), client_id: client.client_id, cliente: client };
  }

  @Get('admin')
  async list(@Query('page') pageValue = '1', @Query('limit') limitValue = '20', @Query('q') q?: string) {
    const page = Number(pageValue);
    const limit = Number(limitValue);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('paginacion invalida');
    if (q !== undefined && (typeof q !== 'string' || q.length > 100)) throw new BadRequestException('q invalido');
    return this.clients.list(page, limit, q);
  }

  @Post('admin')
  async createAdmin(@Body() body: unknown) {
    const { client, created } = await this.clients.register({ ...parseInput(body), origen: 'TIENDA' });
    return { cliente: client, reused: !created };
  }

  @Get('admin/:id')
  async detail(@Param('id') id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new BadRequestException('client_id invalido');
    return this.clients.byId(id);
  }
}
