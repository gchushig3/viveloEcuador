import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import type { Repository } from 'typeorm';
import { AdminListController } from '../../src/modules/attractions/admin-list.controller.js';
import { AttractionsService } from '../../src/modules/attractions/attractions.service.js';
import { AtraccionEntity } from '../../src/database/entities/atraccion.entity.js';
import { BookingProfileEntity } from '../../src/booking/booking-profile.entity.js';

describe('Administrative attraction detail', () => {
  it('returns draft fields without using the public published-only lookup', async () => {
    const item = Object.assign(new AtraccionEntity(), { atr_id: '21', atr_uuid: 'draft-uuid', atr_nombre: 'Draft', atr_estado: 'BORRADOR',
      atr_duracion_horas: 2, atr_latitud: 0, atr_longitud: 0 });
    const findById = jest.fn<AttractionsService['findById']>().mockResolvedValue(item);
    const findOne = jest.fn<Repository<BookingProfileEntity>['findOne']>().mockResolvedValue(null);
    const controller = new AdminListController({} as Repository<AtraccionEntity>,
      { findOne } as unknown as Repository<BookingProfileEntity>, { findById } as unknown as AttractionsService);
    expect(await controller.detail('21')).toMatchObject({ id: 'draft-uuid', atr_id: '21', name: 'Draft', status: 'BORRADOR' });
    expect(findById).toHaveBeenCalledWith('21');
  });
});
