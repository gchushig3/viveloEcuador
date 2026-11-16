import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AdminApiService } from './admin-api.service';
import { AdminClients } from './admin-clients';

describe('AdminClients', () => {
  let fixture: ComponentFixture<AdminClients>;
  let api: {
    clients: ReturnType<typeof vi.fn>;
    createClient: ReturnType<typeof vi.fn>;
    client: ReturnType<typeof vi.fn>;
    clientLocalReservations: ReturnType<typeof vi.fn>;
    errorMessage: ReturnType<typeof vi.fn>;
  };

  const client = {
    client_id: '11111111-1111-4111-8111-111111111111',
    nombre: 'Ana Cliente',
    email: 'ana@example.test',
    identificacion: '0912345678',
    telefono: '0999999999',
    origenes: ['TIENDA', 'BOOKING'],
    usuario_id: '42',
    creado_en: '2026-11-01T12:00:00.000Z',
  };
  const detail = {
    ...client,
    reservas: [{
      reserva_id: '22222222-2222-4222-8222-222222222222',
      estado: 'CONFIRMADA',
      atraccion: 'Volcán Cotopaxi',
      fecha: '2026-11-20',
      hora: '09:00',
      personas: 2,
      creada_en: '2026-11-01T12:00:00.000Z',
    }],
  };
  const localReservation = {
    reservationId: '33333333-3333-4333-8333-333333333333',
    state: 'CONFIRMED',
    paid: true,
    createdAt: '2026-11-02T12:00:00.000Z',
    payload: { lines: [] },
  };

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const button = (label: string) => {
    const result = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .find(candidate => candidate.textContent?.trim() === label);
    if (!result) throw new Error(`Button not found: ${label}`);
    return result;
  };

  beforeEach(async () => {
    api = {
      createClient: vi.fn().mockReturnValue(of({ cliente: { ...client, usuario_id: null }, reused: false })),
      clients: vi.fn().mockReturnValue(of({ items: [client], total: 21, page: 1, limit: 20, total_pages: 2 })),
      client: vi.fn().mockReturnValue(of(detail)),
      clientLocalReservations: vi.fn().mockReturnValue(of([localReservation])),
      errorMessage: vi.fn(error => error?.message ?? 'Error de consulta'),
    };
    await TestBed.configureTestingModule({
      imports: [AdminClients],
      providers: [{ provide: AdminApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminClients);
    fixture.detectChanges();
  });

  it('loads and renders client identity and channel of origin', () => {
    expect(api.clients).toHaveBeenCalledWith(1, 20, '');
    expect(text()).toContain('Ana Cliente');
    expect(text()).toContain('0912345678');
    expect(text()).toContain('Tienda web');
    expect(text()).toContain('Booking');
  });

  it('creates a client without an account and refreshes the directory', () => {
    button('Crear cliente').click(); fixture.detectChanges();
    fixture.componentInstance.createForm.setValue({ nombre: ' Ana Cliente ', email: ' ANA@EXAMPLE.TEST ', identificacion: '0912345678', telefono: '' });
    fixture.componentInstance.saveClient(); fixture.detectChanges();
    expect(api.createClient).toHaveBeenCalledWith({ nombre: 'Ana Cliente', email: 'ana@example.test', identificacion: '0912345678' });
    expect(api.clients).toHaveBeenLastCalledWith(1, 20, 'ana@example.test');
    expect(text()).toContain('Cliente creado correctamente.');
  });

  it('validates input and retains the form after a server error', () => {
    const component = fixture.componentInstance;
    component.saveClient(); expect(api.createClient).not.toHaveBeenCalled();
    component.createForm.patchValue({ nombre: 'Ana', email: 'ana@example.test' });
    api.createClient.mockReturnValue(throwError(() => new Error('Cliente en conflicto')));
    component.saveClient();
    expect(component.createError()).toBe('Cliente en conflicto');
    expect(component.createForm.controls.nombre.value).toBe('Ana');
    expect(component.saving()).toBe(false);
  });

  it('searches by the entered value and pages through results', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#client-query')!;
    input.value = ' ana@example.test ';
    input.dispatchEvent(new Event('input'));
    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(api.clients).toHaveBeenLastCalledWith(1, 20, ' ana@example.test ');

    button('Siguiente').click();
    fixture.detectChanges();
    expect(api.clients).toHaveBeenLastCalledWith(2, 20, ' ana@example.test ');
    expect(button('Anterior').disabled).toBe(false);
    button('Anterior').click();
    fixture.detectChanges();
    expect(api.clients).toHaveBeenLastCalledWith(1, 20, ' ana@example.test ');
  });

  it('opens and closes Booking and local purchase history', () => {
    button('Historial').click();
    fixture.detectChanges();
    expect(api.client).toHaveBeenCalledWith(client.client_id);
    expect(api.clientLocalReservations).toHaveBeenCalledWith('42');
    expect(text()).toContain('Volcán Cotopaxi');
    expect(text()).toContain(localReservation.reservationId);
    button('Cerrar').click();
    fixture.detectChanges();
    expect(text()).not.toContain('Volcán Cotopaxi');
  });

  it('keeps Booking history visible when local purchase history fails and retries it', () => {
    api.clientLocalReservations
      .mockReturnValueOnce(throwError(() => new Error('Compras web no disponibles')))
      .mockReturnValueOnce(of([]));
    button('Historial').click();
    fixture.detectChanges();
    expect(text()).toContain('Volcán Cotopaxi');
    expect(text()).toContain('Compras web no disponibles');
    button('Reintentar compras web').click();
    fixture.detectChanges();
    expect(api.clientLocalReservations).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Volcán Cotopaxi');
    expect(text()).not.toContain('Compras web no disponibles');
  });

  it('shows a list error and retries the list request', () => {
    api.clients
      .mockReturnValueOnce(throwError(() => new Error('No se pudo cargar')))
      .mockReturnValueOnce(of({ items: [client], total: 1, page: 1, limit: 20, total_pages: 1 }));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(text()).toContain('No se pudo cargar');
    button('Reintentar').click();
    fixture.detectChanges();
    expect(api.clients).toHaveBeenCalledTimes(3);
    expect(text()).toContain('Ana Cliente');
  });
});
