import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminDashboard } from './admin-dashboard';
import { AdminApiService } from './admin-api.service';
import { CartService } from '../../services/cart.service';

const counts = { total: 2, confirmadas: 1, canceladas: 1, hoy: 1, proximas: 1, ultimas_24h: 1, personas_proximas: 2 };
describe('Live admin overview', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });
  function setup() {
    const api = { summary: vi.fn(() => of({ reservas: { ...counts }, atracciones: { total: 1, publicadas: 1, borradores: 0, inactivas: 0 },
      top_atracciones: [], recientes: [{ reserva_id: 'booking', atraccion: 'Tour', estado: 'CONFIRMADA', creada_en: '2026-11-01T10:00:00Z' }] })),
      users: vi.fn(() => of({ items: [], total: 4 })), errorMessage: vi.fn(() => 'No disponible') };
    const cart = { adminSummary: vi.fn(() => of({ reservas: { ...counts }, top_atracciones: [] })),
      adminList: vi.fn(() => of([{ reservationId: 'web', userId: '7', state: 'CONFIRMED', createdAt: '2026-11-02T10:00:00Z', payload: { lines: [{ attractionId: '1', date: '2026-11-20', timeSlot: '10:00' }] } }])) };
    TestBed.configureTestingModule({ imports: [AdminDashboard], providers: [provideRouter([]),
      { provide: AdminApiService, useValue: api }, { provide: CartService, useValue: cart }] });
    const fixture = TestBed.createComponent(AdminDashboard); fixture.detectChanges();
    return { fixture, page: fixture.componentInstance, api, cart };
  }
  it('combines complete channel totals and sorts recent reservations from both origins', () => {
    const { page } = setup();
    expect(page.summary()?.reservas.total).toBe(4);
    expect(page.summary()?.reservas.personas_proximas).toBe(4);
    expect(page.summary()?.recientes.map(row => row.reserva_id)).toEqual(['web', 'booking']);
  });
  it('refreshes without manual action and stops on leaving the page', () => {
    vi.useFakeTimers();
    const { fixture, cart } = setup();
    vi.advanceTimersByTime(5000); expect(cart.adminList).toHaveBeenCalledTimes(2);
    fixture.destroy(); vi.advanceTimersByTime(10000); expect(cart.adminList).toHaveBeenCalledTimes(2);
  });
  it('keeps the last successful data and reports partial outages', () => {
    const { page, cart } = setup();
    cart.adminSummary.mockReturnValueOnce(throwError(() => new Error('offline')));
    page.load();
    expect(page.summary()?.reservas.total).toBe(4);
    expect(page.error()).toContain('Resumen web');
  });
});
