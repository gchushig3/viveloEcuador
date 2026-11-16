import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminApiService } from './admin-api.service';
import { CART_API_URL, CATALOG_API_URL, IDENTITY_ADMIN_API_URL } from '../../core/api.config';

describe('Combined customer directory', () => {
  let http: HttpTestingController;
  let api: AdminApiService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: CART_API_URL, useValue: '/cart' }, { provide: CATALOG_API_URL, useValue: '/catalog' }, { provide: IDENTITY_ADMIN_API_URL, useValue: '/identity' }] });
    http = TestBed.inject(HttpTestingController); api = TestBed.inject(AdminApiService);
  });
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });
  const user = { id: '7', first_name: 'Alexander', last_name: 'Carrion', email: 'alexander@example.test', phone: null, roles: ['CLIENTE'] };
  const flushPurchaseSources = (paidUserIds: string[], reservations: unknown[] = []) => {
    http.expectOne(r => r.url === '/cart/cart/admin/customers').flush(paidUserIds.map(userId => ({ userId })));
    http.expectOne(r => r.url === '/catalog/atracciones/admin/reservas').flush({ items: reservations, total: reservations.length });
  };
  it('shows a registered web customer only when the account has a paid purchase', () => {
    let result: any;
    api.clients(1, 20, 'carrion').subscribe(page => result = page);
    http.expectOne(r => r.url === '/catalog/atracciones/admin/clientes').flush({ items: [], total: 0 });
    http.expectOne(r => r.url === '/identity/users').flush({ items: [user, { ...user, id: '8', email: 'admin@example.test', roles: ['ADMIN'] }], total: 2 });
    flushPurchaseSources(['7']);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ nombre: 'Alexander Carrion', usuario_id: '7', origenes: ['TIENDA'] });
    api.client(result.items[0].client_id).subscribe(detail => expect(detail.reservas).toEqual([]));
    http.expectNone(r => r.method !== 'GET');
  });

  it('lists clients without accounts or purchases and posts only profile data', () => {
    const profile = { client_id: 'manual', nombre: 'Ana', email: 'ana@example.test', usuario_id: null, origenes: ['TIENDA'] };
    let result: any;
    api.clients(1, 20).subscribe(page => result = page);
    http.expectOne(r => r.url === '/catalog/atracciones/admin/clientes').flush({ items: [profile], total: 1 });
    http.expectOne(r => r.url === '/identity/users').flush({ items: [], total: 0 });
    flushPurchaseSources([]);
    expect(result.items).toEqual([profile]);
    api.createClient({ nombre: 'Ana', email: profile.email }).subscribe();
    const request = http.expectOne(r => r.method === 'POST');
    expect(request.request.url).toBe('/catalog/atracciones/admin/clientes');
    expect(request.request.body).toEqual({ nombre: 'Ana', email: profile.email });
    request.flush({ cliente: profile, reused: false });
  });
  it('excludes unpaid web accounts and keeps purchased Booking clients', () => {
    let result: any;
    api.clients(1, 20).subscribe(page => result = page);
    const profile = { client_id: 'p', nombre: 'Alexander Carrion', email: 'ALEXANDER@example.test', origenes: ['BOOKING'] };
    http.expectOne(r => r.url === '/catalog/atracciones/admin/clientes').flush({ items: [profile], total: 1 });
    http.expectOne(r => r.url === '/identity/users').flush({ items: [user], total: 1 });
    flushPurchaseSources([], [{ cliente_email: 'alexander@example.test', estado: 'CANCELADA' }]);
    expect(result.total).toBe(1);
    expect(result.items[0].origenes).toEqual(['BOOKING', 'TIENDA']);
    let detail: any;
    api.client('p').subscribe(value => detail = value);
    http.expectOne('/catalog/atracciones/admin/clientes/p').flush({ ...profile, reservas: [{ reserva_id: 'booking' }] });
    expect(detail.usuario_id).toBe('7'); expect(detail.reservas).toHaveLength(1);
  });
  it('does not list a registered account or a pending Booking reservation without payment', () => {
    let result: any;
    api.clients(1, 20).subscribe(page => result = page);
    http.expectOne(r => r.url === '/catalog/atracciones/admin/clientes').flush({ items: [], total: 0 });
    http.expectOne(r => r.url === '/identity/users').flush({ items: [user], total: 1 });
    flushPurchaseSources([], [{ client_id: 'pending', estado: 'PENDIENTE' }]);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
  it('searches later identity pages before paginating the merged directory', () => {
    let result: any;
    api.clients(1, 20, 'carrion').subscribe(page => result = page);
    http.expectOne(r => r.url === '/catalog/atracciones/admin/clientes').flush({ items: [], total: 0 });
    http.expectOne(r => r.url === '/identity/users' && r.params.get('page') === '1').flush({
      items: Array.from({ length: 100 }, (_, i) => ({ ...user, id: String(i + 10), last_name: 'Otro', email: `other${i}@example.test` })), total: 101,
    });
    http.expectOne(r => r.url === '/identity/users' && r.params.get('page') === '2').flush({ items: [user], total: 101 });
    flushPurchaseSources(['7']);
    expect(result.total).toBe(1); expect(result.items[0].nombre).toBe('Alexander Carrion');
  });
});
