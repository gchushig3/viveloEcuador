import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { parseInput } from '../dist/clients.service.js';

test('web registrations require a 10-digit cedula or 13-digit RUC', () => {
  const result = parseInput(
    { nombre: 'Ana Ejemplo', email: ' ANA@EXAMPLE.COM ', identificacion: '0123456789' },
    '42',
  );
  assert.equal(result.identificacion, '0123456789');
  assert.equal(result.email, 'ana@example.com');
  assert.equal(result.usuario_id, '42');

  const ruc = parseInput(
    { nombre: 'Ana Ejemplo', email: 'ana@example.com', identificacion: '0123456789001' },
    '42',
  );
  assert.equal(ruc.identificacion, '0123456789001');
});

test('web registrations reject missing or malformed identification', () => {
  assert.throws(
    () => parseInput({ nombre: 'Ana Ejemplo', email: 'ana@example.com' }, '42'),
    BadRequestException,
  );
  assert.throws(
    () => parseInput({ nombre: 'Ana Ejemplo', email: 'ana@example.com', identificacion: '123456789' }, '42'),
    BadRequestException,
  );
  assert.throws(
    () => parseInput({ nombre: 'Ana Ejemplo', email: 'ana@example.com', identificacion: 'ABCDEFGHIJ' }, '42'),
    BadRequestException,
  );
});

test('Booking input can omit Ecuadorian identification', () => {
  const result = parseInput({ nombre: 'Tourist Example', email: 'tourist@example.com' });
  assert.equal(result.identificacion, undefined);
});

test('web registration accepts a valid phone and rejects values with fewer than seven digits', () => {
  const result = parseInput(
    { nombre: 'Ana Ejemplo', email: 'ana@example.com', identificacion: '0123456789', telefono: '+593 99 123 4567' },
    '42',
  );
  assert.equal(result.telefono, '+593 99 123 4567');
  assert.throws(
    () => parseInput({ nombre: 'Ana Ejemplo', email: 'ana@example.com', identificacion: '0123456789', telefono: '---    ' }, '42'),
    BadRequestException,
  );
});
