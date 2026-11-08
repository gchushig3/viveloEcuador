import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

interface LocationCity {
  ciu_id: number;
  ciu_nombre: string;
  prov_id: number;
  ciu_activa?: boolean;
}

interface LocationProvince {
  prov_id: number;
  prov_nombre: string;
}

export interface CityOption {
  id: number;
  name: string;
  province_id: number;
  province: string | null;
}

const CACHE_MS = 5 * 60_000;
const TIMEOUT_MS = 5000;

/** Catalogos de apoyo para el formulario de atracciones; el guard global exige ADMIN. */
@ApiTags('Administracion')
@ApiBearerAuth('jwt')
@ApiUnauthorizedResponse({
  description:
    'Requiere access JWT, sesion vigente y rol ADMIN validados por Identity.',
})
@Controller('atracciones/admin')
export class AdminLookupsController {
  private cache?: { at: number; items: CityOption[] };

  constructor(private readonly config: ConfigService) {}

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Location respondio ${response.status}`);
    return (await response.json()) as T;
  }

  @Get('ciudades')
  @ApiOperation({
    summary: 'Ciudades activas del servicio Location para elegir en el alta',
  })
  async cities(): Promise<CityOption[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS)
      return this.cache.items;
    const base = this.config.get<string>('LOCATION_BASE_URL');
    if (!base)
      throw new ServiceUnavailableException(
        'El servicio de ubicaciones no esta configurado',
      );
    const root = base.replace(/\/+$/, '');
    let cities: LocationCity[];
    try {
      cities = await this.fetchJson<LocationCity[]>(`${root}/ciudades`);
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo consultar el servicio de ubicaciones',
      );
    }
    // Las provincias solo enriquecen la etiqueta; si fallan se omiten.
    const provinces = new Map<number, string>();
    try {
      const list = await this.fetchJson<LocationProvince[]>(
        `${root}/provincias`,
      );
      for (const p of list) provinces.set(p.prov_id, p.prov_nombre);
    } catch {
      /* sin nombre de provincia */
    }
    const items = cities
      .filter((c) => c.ciu_activa !== false)
      .map((c) => ({
        id: c.ciu_id,
        name: c.ciu_nombre,
        province_id: c.prov_id,
        province: provinces.get(c.prov_id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    this.cache = { at: Date.now(), items };
    return items;
  }
}
