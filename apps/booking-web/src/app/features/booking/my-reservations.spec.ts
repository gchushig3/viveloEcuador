import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { MyReservations } from './my-reservations';
import { AuthService } from '../../services/auth.service';
import { AtraccionesService } from '../../services/atracciones.service';
import { CartService, Reservation } from '../../services/cart.service';
import { ReservasService } from '../../services/reservas.service';

const reservation: Reservation = {
  reservationId: 'abc', state: 'CONFIRMED', payload: {
    reservationId: 'abc', expiresAt: '', amountCents: 10000, currency: 'USD',
    lines: [{ attractionId: '1', itemId: 'attraction', date: '2099-01-01', timeSlot: '10:00', slotId: 'slot', adults: 5, children: 0, amountCents: 10000 }],
  },
};
const cancellation = {
  status: 'CANCELLED', cancel_code: 'REF-ATR-abc', reembolso_id: 'REF-ATR-abc', monto_reembolsado: 100,
  refund: { refund_id: 'REF-ATR-abc', status: 'PROCESSED', amount: 100, currency: 'USD', message: 'Reembolso simulado del 100% procesado.' },
  stock_restoration: { status: 'RESTORED', restored_spots: 5, message: 'Cupos liberados' },
};

describe('MyReservations cancellation', () => {
  const updates = new Subject<Reservation>();
  let cart: { list: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let stock: { notificarDisponibilidadCambiada: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-02T15:00:00Z'));
    reservation.payload.lines[0].date = '2099-01-01';
    reservation.payload.lines[0].timeSlot = '10:00';
    reservation.createdAt = new Date(Date.now()).toISOString();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, value: function(this: HTMLDialogElement) { this.open = true; },
    });
    cart = { list: vi.fn(() => of([reservation])), cancel: vi.fn(() => of({ state: 'REFUND_REQUESTED' })), get: vi.fn(() => updates) };
    stock = { notificarDisponibilidadCambiada: vi.fn() };
    TestBed.configureTestingModule({ imports: [MyReservations], providers: [provideRouter([]),
      { provide: AuthService, useValue: { authenticated: signal(true) } },
      { provide: CartService, useValue: cart },
      { provide: AtraccionesService, useValue: { obtenerAtraccion: () => of({ name: 'Tour' }) } },
      { provide: ReservasService, useValue: stock },
    ] });
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.useRealTimers(); });

  function create() { const fixture = TestBed.createComponent(MyReservations); fixture.detectChanges(); return fixture; }
  function click(fixture: ReturnType<typeof create>, text: string) {
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    buttons.find(button => button.textContent?.trim() === text)!.click(); fixture.detectChanges();
  }

  it('polls silently, retains unchanged cards and applies check-in updates', () => {
    const fixture = create();
    const card = fixture.nativeElement.querySelector('article');
    const original = fixture.componentInstance['reservations']()[0];
    cart.list.mockReturnValue(of([JSON.parse(JSON.stringify(reservation))]));
    vi.advanceTimersByTime(4500); fixture.detectChanges();
    expect(cart.list).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['reservations']()[0]).toBe(original);
    expect(fixture.nativeElement.querySelector('article')).toBe(card);
    cart.list.mockReturnValue(of([{ ...reservation, state: 'CONFIRMADO_ASISTIDO' }]));
    vi.advanceTimersByTime(4500); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('article')).toBe(card);
    expect(fixture.nativeElement.textContent).toContain('Check-in realizado');
    expect(fixture.nativeElement.textContent).not.toContain('Cancelar Reserva');
    expect(fixture.componentInstance['loading']()).toBe(false);
    fixture.destroy();
    vi.advanceTimersByTime(9000);
    expect(cart.list).toHaveBeenCalledTimes(3);
  });

  it('keeps cards after a background error and retries with a red cancellation badge', () => {
    const fixture = create();
    cart.list.mockReturnValue(throwError(() => new Error('offline')));
    vi.advanceTimersByTime(4500); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('article')).not.toBeNull();
    expect(fixture.componentInstance['error']()).toBe('');
    cart.list.mockReturnValue(of([{ ...reservation, state: 'CANCELLED' }]));
    vi.advanceTimersByTime(4500); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[style]').style.color).toBe('rgb(185, 28, 28)');
  });

  it('enables cancellation exactly 24 hours before the turn even for an old purchase', () => {
    reservation.createdAt = '2020-01-01T00:00:00Z';
    reservation.payload.lines[0].date = '2030-01-03';
    const fixture = create();
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((b: HTMLButtonElement) => b.textContent?.trim() === 'Cancelar Reserva');
    expect(button.disabled).toBe(false);
  });

  it('removes cancellation and an open modal when less than 24 hours remain', () => {
    reservation.payload.lines[0].date = '2030-01-03';
    const fixture = create(); click(fixture, 'Cancelar Reserva');
    vi.advanceTimersByTime(1000); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Cancelar Reserva');
    expect(cart.cancel).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Cancelación no disponible (menos de 24h antes del inicio de la actividad).');
  });

  it.each([1, 86_400_000, 172_800_000])('hides cancellation %i ms after the cutoff', elapsed => {
    reservation.payload.lines[0].date = '2030-01-03';
    vi.setSystemTime(new Date(Date.now() + elapsed));
    const fixture = create();
    const button = [...fixture.nativeElement.querySelectorAll('button')].find((b: HTMLButtonElement) => b.textContent?.trim() === 'Cancelar Reserva');
    expect(button).toBeUndefined();
    expect(fixture.nativeElement.textContent).toContain('Cancelación no disponible');
  });

  it('asks for confirmation and waits for both refund and stock before showing success', () => {
    const fixture = create();
    click(fixture, 'Cancelar Reserva');
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(true);
    expect(cart.cancel).not.toHaveBeenCalled();
    click(fixture, 'Confirmar cancelación');
    vi.advanceTimersByTime(0);
    updates.next({ ...reservation, state: 'CANCELLED', cancellation: { ...cancellation, stock_restoration: { ...cancellation.stock_restoration, status: 'PENDING' } } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('¡Cancelación y Reembolso Exitosos!');
    updates.next({ ...reservation, state: 'CANCELLED', cancellation });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('¡Cancelación y Reembolso Exitosos!');
    expect(fixture.nativeElement.textContent).toContain('REF-ATR-abc');
    expect(stock.notificarDisponibilidadCambiada).toHaveBeenCalledWith('attraction');
  });

  it.each(['CHECKED_IN', 'CONFIRMADO_ASISTIDO', 'COMPLETED'] as const)('hides cancellation after %s', state => {
    cart.list.mockReturnValue(of([{ ...reservation, state }]));
    const fixture = create();
    expect(fixture.nativeElement.textContent).toContain('Check-in realizado (Servicio iniciado, no cancelable)');
    expect(fixture.nativeElement.textContent).not.toContain('Cancelar Reserva');
  });

  it('hides cancellation when check-in is recorded as a date', () => {
    cart.list.mockReturnValue(of([{ ...reservation, checkin_en: '2026-11-12T10:00:00Z' }]));
    expect(create().nativeElement.textContent).not.toContain('Cancelar Reserva');
  });

  it('shows an error without announcing success if cancellation is rejected', () => {
    cart.cancel.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { detail: 'No se puede cancelar' } })));
    const fixture = create(); click(fixture, 'Cancelar Reserva'); click(fixture, 'Confirmar cancelación');
    expect(fixture.nativeElement.textContent).toContain('No se puede cancelar');
    expect(fixture.nativeElement.textContent).not.toContain('¡Cancelación y Reembolso Exitosos!');
    expect(stock.notificarDisponibilidadCambiada).not.toHaveBeenCalled();
  });
});
