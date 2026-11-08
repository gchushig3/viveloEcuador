import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { In, Repository } from 'typeorm';
import { AtraccionEntity } from '../../database/entities/atraccion.entity.js';
import { BookingProfileEntity } from '../../booking/booking-profile.entity.js';
import { toAttractionResponseDto } from './dto/attraction-response.dto.js';

const STATUSES = ['BORRADOR', 'PUBLICADA', 'INACTIVA'];

/** Listado de administracion: incluye borradores e inactivas; el guard global exige ADMIN. */
@ApiTags('Administracion')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({
  description:
    'Requiere access JWT, sesion vigente y rol ADMIN validados por Identity.',
})
@Controller('atracciones/admin/lista')
export class AdminListController {
  constructor(
    @InjectRepository(AtraccionEntity)
    private readonly attractions: Repository<AtraccionEntity>,
    @InjectRepository(BookingProfileEntity)
    private readonly profiles: Repository<BookingProfileEntity>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar todas las atracciones (cualquier estado) para el panel',
  })
  async list(
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(limitRaw ?? '10', 10) || 10),
    );
    if (status && !STATUSES.includes(status))
      throw new BadRequestException('status invalido');

    const qb = this.attractions
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.operador', 'o')
      .leftJoinAndSelect('a.categorias', 'ac')
      .leftJoinAndSelect('ac.categoria', 'c')
      .leftJoinAndSelect('a.idiomas', 'ai')
      .leftJoinAndSelect('ai.idioma', 'i')
      .leftJoinAndSelect('a.inclusiones', 'ainc')
      .leftJoinAndSelect('ainc.inclusion', 'inc')
      .leftJoinAndSelect('a.fotos', 'f')
      .where('a.atr_eliminado_en IS NULL');
    if (status) qb.andWhere('a.atr_estado = :status', { status });
    if (q?.trim())
      qb.andWhere('(a.atr_nombre ILIKE :q OR a.atr_descripcion ILIKE :q)', {
        q: `%${q.trim()}%`,
      });
    qb.orderBy('a.atr_id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    const profiles = items.length
      ? await this.profiles.find({
          where: { atr_id: In(items.map((item) => item.atr_id)) },
        })
      : [];
    const byAttraction = new Map(
      profiles.map((p) => [String(p.atr_id), p.payload]),
    );

    const data = items.map((item) => {
      const dto = toAttractionResponseDto(item);
      const profile = byAttraction.get(String(item.atr_id));
      return {
        ...dto,
        id: item.atr_uuid,
        atr_id: String(item.atr_id),
        operator_id: dto.operator_id,
        ...(profile
          ? {
              city: profile.city,
              price: profile.price,
              inclusions: profile.inclusions,
              itinerary: profile.itinerary,
              accessibility: profile.accessibility,
              permite_paquete: profile.permite_paquete,
              rating: {
                score: dto.average_rating,
                review_count: dto.reviews_count,
                breakdown: profile.ratings_breakdown,
              },
            }
          : {}),
      };
    });

    return {
      data,
      metadata: {
        total_results: total,
        page,
        limit,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
