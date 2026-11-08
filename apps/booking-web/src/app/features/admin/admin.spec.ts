import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { API_URL, CATALOG_API_URL, IDENTITY_API_URL, CART_API_URL } from '../../core/api.config';
import { AuthService } from '../../services/auth.service';

function jwt(role: 'CLIENTE' | 'ADMIN') {
  return 'h.' + btoa(JSON.stringify({ sub: 'id', sid: 'session-id', token_use: 'access', roles: [role] })) + '.s';
}
function session(role: 'CLIENTE' | 'ADMIN') {
  localStorage.setItem('access_token', jwt(role));
  localStorage.setItem('auth_user', JSON.stringify({ id: 'id', name: 'Ana', email: 'ana@example.com' }));
  const auth = TestBed.inject(AuthService);
  auth.authenticated.set(true);
  auth.user.set({ id: 'id', name: 'Ana', email: 'ana@example.com', roles: [role], verified: true });
}

describe('Admin catalog routes', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_URL, useValue: '/api/v1' },
        { provide: CATALOG_API_URL, useValue: '/api/v2' },
        { provide: IDENTITY_API_URL, useValue: '/api/v2' },
        { provide: CART_API_URL, useValue: '/cart-api/v2' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); localStorage.clear(); });

  it('prevents a client account from opening an ADMIN route', async () => {
    session('CLIENTE');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin');
    expect(TestBed.inject(Router).url).toContain('/acceso-denegado');
    expect(TestBed.inject(Router).url).toContain('motivo=403');
    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(true);
    http.expectNone(() => true);
  });

  it('opens the operational summary on /admin', async () => {
    session('ADMIN');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin');
    expect(TestBed.inject(Router).url).toBe('/admin');
    const summary = http.expectOne('/api/v2/atracciones/admin/resumen');
    http.expectOne(request => request.url === '/api/v2/users' || request.url.endsWith('/users')).flush({ items: [], total: 7, page: 1, limit: 1 });
    summary.flush({
      reservas: { total: 3, confirmadas: 2, canceladas: 1, hoy: 1, proximas: 1, ultimas_24h: 2, personas_proximas: 4 },
      atracciones: { total: 2, publicadas: 1, borradores: 1, inactivas: 0 },
      top_atracciones: [], recientes: [],
    });
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Resumen operativo');
    expect(harness.routeNativeElement?.textContent).toContain('7');
  });

  it('lists and cancels reservations from the admin endpoint', async () => {
    session('ADMIN');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/reservas');
    http.expectOne('/cart-api/v2/cart/admin/reservations').flush([]);
    const list = http.expectOne(request => request.url === '/api/v2/atracciones/admin/reservas');
    expect(list.request.params.get('limit')).toBe('10');
    const reservation = {
      reserva_id: '11111111-1111-4111-8111-111111111111', estado: 'CONFIRMADA', atraccion_id: 'a', atraccion: 'Cotopaxi',
      fecha: '2026-12-01', hora: '09:00', personas: 2, cliente_nombre: 'Ana', cliente_email: 'ana@example.com', creada_en: '2026-11-01T10:00:00Z',
    };
    list.flush({ items: [reservation], total: 1, page: 1, limit: 10, total_pages: 1 });
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.textContent).toContain('Cotopaxi');
    const buttons = () => Array.from(root.querySelectorAll('button'));
    buttons().find(button => button.textContent?.trim() === 'Detalle')!.click();
    harness.detectChanges();
    buttons().find(button => button.textContent?.trim() === 'Cancelar reserva')!.click();
    harness.detectChanges();
    buttons().find(button => button.textContent?.trim() === 'Sí, cancelar')!.click();
    const cancel = http.expectOne(`/api/v2/atracciones/admin/reservas/${reservation.reserva_id}/cancel`);
    expect(cancel.request.method).toBe('POST');
    cancel.flush({ ...reservation, estado: 'CANCELADA' });
    harness.detectChanges();
    expect(root.textContent).toContain('Reserva cancelada');
  });

  it('shows attendance status and allows retrying a failed Booking notification', async () => {
    session('ADMIN');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/reservas');
    http.expectOne('/cart-api/v2/cart/admin/reservations').flush([]);
    const reservation = {
      reserva_id: '11111111-1111-4111-8111-111111111111', estado: 'CONFIRMADA', atraccion_id: 'a', atraccion: 'Cotopaxi',
      fecha: '2026-12-01', hora: '09:00', personas: 1, cliente_nombre: 'Ana', cliente_email: 'ana@example.com', creada_en: '2026-11-01T10:00:00Z',
    };
    http.expectOne(request => request.url === '/api/v2/atracciones/admin/reservas').flush({ items: [reservation], total: 1, page: 1, limit: 10, total_pages: 1 });
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.textContent).toContain('PENDIENTE_ASISTENCIA');
    const buttons = () => Array.from(root.querySelectorAll('button'));
    buttons().find(button => button.textContent?.trim() === 'Detalle')!.click();
    harness.detectChanges();
    const fields = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    fields[0].value = '12345'; fields[0].dispatchEvent(new Event('input'));
    fields[1].value = 'Guia'; fields[1].dispatchEvent(new Event('input'));
    harness.detectChanges();
    buttons().find(button => button.textContent?.trim() === 'Check-in / Confirmar asistencia')!.click();
    const request = http.expectOne(`/api/v2/atracciones/reservas/${reservation.reserva_id}/checkin`);
    expect(request.request.body).toEqual({ documento_identidad: '12345', guia_codigo: 'Guia' });
    request.flush({ reserva_id: reservation.reserva_id, hora_checkin: '2026-11-06T15:00:00Z', asistentes_reales: 1, booking_notificado: false, booking_error: 'Booking no disponible' });
    harness.detectChanges();
    expect(root.textContent).toContain('CONFIRMADO_ASISTIDO');
    expect(root.textContent).toContain('Reintentar notificación a Booking');
    expect(root.textContent).toContain('Booking no disponible');
  });

  it('manages users: loads roles and assigns one', async () => {
    session('ADMIN');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/usuarios');
    http.expectOne('/api/v2/roles').flush([{ id: 1, name: 'ADMIN', description: '', active: true }, { id: 3, name: 'CLIENTE', description: '', active: true }]);
    const list = http.expectOne(request => request.url === '/api/v2/users');
    const user = { id: '5', email: 'ana@example.com', first_name: 'Ana', last_name: 'P', phone: null, verified: true, active: true, roles: ['CLIENTE'] };
    list.flush({ items: [user], total: 1, page: 1, limit: 10 });
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    const select = root.querySelector('select') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    const assign = http.expectOne('/api/v2/users/5/roles');
    expect(assign.request.body).toEqual({ role_id: 1 });
    assign.flush({});
    http.expectOne(request => request.url === '/api/v2/users').flush({ items: [{ ...user, roles: ['CLIENTE', 'ADMIN'] }], total: 1, page: 1, limit: 10 });
    harness.detectChanges();
    expect(root.textContent).toContain('rol ADMIN asignado');
  });

  it('creates an administrator with the authenticated Identity API', async () => {
    session('ADMIN');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/usuarios');
    http.expectOne('/api/v2/roles').flush([]);
    http.expectOne(request => request.url === '/api/v2/users').flush({ items: [], total: 0 });
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    for (const [field, value] of Object.entries({ first_name: 'Nuevo', last_name: 'Administrador', email: 'nuevo@example.test', password: 'Clave-inicial-segura-42!' })) {
      const input = root.querySelector(`[formControlName="${field}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const create = http.expectOne('/api/v2/users/administrators');
    expect(create.request.method).toBe('POST');
    expect(create.request.body.email).toBe('nuevo@example.test');
    create.flush({ id: '10', email: 'nuevo@example.test', roles: ['ADMIN'] });
    http.expectOne(request => request.url === '/api/v2/users').flush({ items: [], total: 1 });
    harness.detectChanges();
    expect(root.textContent).toContain('Administrador creado: nuevo@example.test');
    expect((root.querySelector('[formControlName="password"]') as HTMLInputElement).value).toBe('');
  });

  it('opens the attractions admin and loads its page from the current catalog search', async () => {
    session('ADMIN');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/atracciones');
    const request = http.expectOne('/api/v2/atracciones/admin/lista?page=1&limit=10');
    expect(request.request.method).toBe('GET');
    request.flush({ data: [], metadata: { total_results: 0, page: 1, limit: 10, total_pages: 1 } });
  });
});
