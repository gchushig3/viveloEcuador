import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import {
  normalizeEmail,
  parseClientInput,
} from '../../src/booking/booking-clients.service.js';
import { parseCheckinInput } from '../../src/booking/booking-checkin.service.js';

describe('Clientes y check-in Booking v3.1', () => {
  it('normaliza el email y valida el cliente', () => {
    expect(normalizeEmail(' Ana@Mail.COM ')).toBe('ana@mail.com');
    expect(
      parseClientInput({ nombre: 'Ana', email: 'A@b.co', identificacion: '1' }),
    ).toMatchObject({ email: 'a@b.co', identificacion: '1' });
    expect(() => parseClientInput({ nombre: '', email: 'a@b.co' })).toThrow();
    expect(() => parseClientInput({ nombre: 'Ana', email: 'x' })).toThrow();
  });

  it('valida el cuerpo del check-in', () => {
    expect(parseCheckinInput({})).toEqual({});
    expect(parseCheckinInput({ asistentes_reales: 2, admin_id: 'g' })).toEqual({
      asistentes_reales: 2,
      admin_id: 'g',
    });
    expect(() => parseCheckinInput({ asistentes_reales: 0 })).toThrow();
    expect(() => parseCheckinInput({ asistentes_reales: '2' })).toThrow();
  });
});
