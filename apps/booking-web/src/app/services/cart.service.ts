import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, defer, filter, map, of, switchMap, take, tap, timer } from 'rxjs';
import { CART_API_URL } from '../core/api.config';

export type ReservationState = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export interface ReservationLine {
  attractionId: string;
  itemId: string;
  date: string;
  timeSlot: string;
  slotId: string;
  adults: number;
  children: number;
  amountCents: number;
}

export interface Reservation {
  reservationId: string;
  state: ReservationState;
  paid?: boolean;
  stockConfirmed?: boolean;
  createdAt?: string;
  payload: {
    reservationId: string;
    expiresAt: string;
    currency: string;
    amountCents: number;
    lines: ReservationLine[];
  };
}

export interface BookingDraft {
  attractionId: string;
  date: string;
  timeSlot: string;
  slotId: string;
  adults: number;
  children: number;
}

export function slotIdOf(date: string, time: string): string {
  return `slot-${date.replaceAll('-', '')}-${time.replace(':', '').slice(0, 4)}`;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CART_API_URL)}/cart`;
  private readonly preparedAttempts = new Set<string>();

  private key(): string { return crypto.randomUUID(); }

  clear(): Observable<unknown> { return this.http.delete(this.base); }

  add(draft: BookingDraft, key = this.key()): Observable<unknown> {
    return this.http.post(`${this.base}/items`, draft, { headers: { 'Idempotency-Key': key } });
  }

  checkout(key = this.key()): Observable<{ reservationId: string; expiresAt: string; amountCents: number }> {
    return this.http.post<{ reservationId: string; expiresAt: string; amountCents: number }>(
      `${this.base}/checkout`, {}, { headers: { 'Idempotency-Key': key } });
  }

  // Limpia el carrito, agrega la línea y genera la reserva (saga: inventario -> pago).
  reserve(draft: BookingDraft, attemptId = this.key()) {
    return defer(() => this.preparedAttempts.has(attemptId) ? of(null) : this.clear().pipe(
      tap(() => this.preparedAttempts.add(attemptId)),
    )).pipe(
      concatMap(() => this.add(draft, attemptId)),
      concatMap(() => this.checkout(attemptId)),
    );
  }

  get(id: string): Observable<Reservation> {
    return this.http.get<Reservation>(`${this.base}/reservations/${encodeURIComponent(id)}`);
  }

  list(): Observable<Reservation[]> {
    return this.http.get<Reservation[]>(`${this.base}/reservations`);
  }

  adminList(): Observable<Array<Reservation & { userId: string }>> {
    return this.http.get<Array<Reservation & { userId: string }>>(`${this.base}/admin/reservations`);
  }

  cancel(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/reservations/${encodeURIComponent(id)}/cancel`, {});
  }

  // La saga es asíncrona: se consulta hasta que la reserva sale de PENDING.
  waitForResult(id: string, intervalMs = 1500, maxAttempts = 40): Observable<Reservation> {
    return timer(0, intervalMs).pipe(
      take(maxAttempts),
      switchMap(() => this.get(id)),
      filter(reservation => reservation.state !== 'PENDING'),
      take(1),
      map(reservation => reservation),
    );
  }
}
