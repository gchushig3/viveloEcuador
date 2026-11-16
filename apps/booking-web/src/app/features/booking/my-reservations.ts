import { CurrencyPipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterRenderEffect, inject, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, exhaustMap, finalize, forkJoin, map, of, take, takeWhile, timeout, timer } from 'rxjs';
import { ReservationQr } from '../../components/reservation-qr/reservation-qr';
import { AtraccionesService } from '../../services/atracciones.service';
import { AuthService } from '../../services/auth.service';
import { CartService, Reservation, CancellationReceipt } from '../../services/cart.service';
import { ReservasService } from '../../services/reservas.service';
import { httpErrorMessage } from '../../core/http-errors';
import { canCancelTurn } from '../../core/cancellation-policy';

const STATE_LABEL: Record<string, string> = {
  PENDING: 'Procesando', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada / no completada', CANCELADO: 'Cancelada', CONFIRMADO_ASISTIDO: 'Check-in realizado', CHECKED_IN: 'Check-in realizado', COMPLETED: 'Completada',
};

@Component({
  selector: 'app-my-reservations',
  standalone: true,
  imports: [RouterLink, CurrencyPipe, ReservationQr],
  template: `
    <main class="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <h1 class="text-3xl font-bold">Mis reservas</h1>
      <p class="mt-2 text-sm text-slate-600">Puedes cancelar y solicitar el reembolso hasta 24 horas antes del turno reservado, siempre que no hayas realizado check-in.</p>
      @if (success(); as receipt) {
        <dialog #cancellationDialog (cancel)="success.set(null)" aria-labelledby="refund-success-title" class="fixed inset-0 z-50 m-auto w-full max-w-lg rounded-2xl border border-emerald-200 bg-white p-6 shadow-2xl backdrop:bg-slate-950/60">
          <span class="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">Procesado</span>
          <h2 id="refund-success-title" class="mt-4 text-xl font-bold">¡Cancelación y Reembolso Exitosos!</h2>
          <p class="mt-3 break-all">Código de Reembolso: {{ receipt.reembolso_id }}</p>
          <p class="mt-2">Monto Reembolsado: 100% ({{ receipt.monto_reembolsado | currency:receipt.refund.currency }})</p>
          <p class="mt-2">Stock Reincorporado: ✓ Cupos liberados ({{ receipt.stock_restoration.restored_spots }})</p>
          <p class="mt-2 text-sm text-slate-600">{{ receipt.refund.message }}</p>
          <button type="button" autofocus (click)="success.set(null)" class="mt-5 rounded-xl bg-teal-700 px-4 py-2 text-white">Cerrar</button>
        </dialog>
      }
      @if (auth.authenticated()) { <button type="button" (click)="load()" [disabled]="loading() || !!busy()" class="mt-3 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50">Actualizar reservas</button> }
      @if (!auth.authenticated()) {
        <p role="alert" class="mt-6 rounded-2xl bg-amber-50 p-5 text-amber-900">Inicia sesión para ver tus reservas.</p>
      } @else if (loading()) {
        <p class="mt-6 text-slate-500" role="status">Cargando reservas…</p>
      } @else {
        @if (message()) { <p role="status" class="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{{ message() }}</p> }
        @if (error()) { <p role="alert" class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ error() }}</p> }
        @for (r of reservations(); track r.reservationId) {
          <article class="mt-5 rounded-3xl bg-white p-6 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-xl font-bold">{{ nameOf(r) }}</h2>
                <p class="text-sm text-slate-600">{{ r.payload.lines[0].date }} · {{ r.payload.lines[0].timeSlot }} · {{ r.payload.lines[0].adults }} adultos, {{ r.payload.lines[0].children }} niños</p>
                <p class="mt-1 font-mono text-xs text-slate-500">Código {{ r.reservationId.slice(0, 8).toUpperCase() }}</p>
              </div>
              <div class="text-right">
                <p class="font-black">{{ r.payload.amountCents / 100 | currency:'USD' }}</p>
                <span class="mt-1 inline-block rounded-full px-3 py-1 text-xs font-semibold"
                  [style.color]="isCancelled(r) ? '#b91c1c' : null" [class]="isCancelled(r) ? 'bg-red-100' : r.state === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-800' : r.state === 'PENDING' ? 'bg-amber-100 text-amber-800' : 'bg-stone-200 text-stone-700'">{{ label(r.state) }}</span>
              </div>
            </div>
            @if (checkedIn(r)) { <p class="mt-4 text-sm font-semibold text-teal-800">Check-in realizado (Servicio iniciado, no cancelable)</p> }
            @if (completedCancellation(r)) {
              <button type="button" (click)="success.set(r.cancellation!)" class="mt-4 rounded-xl border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800">Ver comprobante de reembolso</button>
            }
            @if (r.state === 'CONFIRMED' && !checkedIn(r)) {
              <details class="mt-4 rounded-xl border p-4"><summary class="cursor-pointer font-semibold text-teal-800">Ver entrada y código QR</summary><div class="mt-4"><app-reservation-qr [identifier]="r.reservationId" status="CONFIRMADA" /></div></details>
              @if (!withinCancellationWindow(r)) {
                <p class="mt-2 text-sm text-amber-800">Cancelación no disponible (menos de 24h antes del inicio de la actividad). La política de cancelación gratuita aplica hasta 24h antes.</p>
              } @else if (pendingCancel() === r.reservationId) {
                <dialog #cancellationDialog (cancel)="dismissConfirmation($event)" aria-labelledby="cancel-title" class="fixed inset-0 z-50 m-auto w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl backdrop:bg-slate-950/60">
                <h2 id="cancel-title" class="text-xl font-bold">Cancelar Reserva</h2>
                <p class="mt-4 text-sm">Se anulará la reserva completa, se liberarán todos sus cupos y se solicitará un reembolso simulado del 100%. Esta acción no se puede deshacer.</p>
                @if (error()) { <p role="alert" class="mt-3 text-sm text-red-700">{{ error() }}</p> }
                <button type="button" (click)="cancel(r)" [disabled]="!!busy() || !withinCancellationWindow(r)" class="mt-2 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirmar cancelación</button>
                <button type="button" (click)="pendingCancel.set('')" [disabled]="!!busy()" class="ml-2 rounded-xl border px-4 py-2 text-sm">Volver</button>
                </dialog>
              } @else {
              <button type="button" (click)="openCancellation(r)" [disabled]="!!busy() || !withinCancellationWindow(r)" class="mt-4 rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                {{ busy() === r.reservationId ? 'Cancelando…' : 'Cancelar Reserva' }}
              </button>
              }
            }
          </article>
        } @empty {
          <p class="mt-6 text-slate-600">Aún no tienes reservas.</p>
          <a routerLink="/actividades" class="mt-4 inline-flex rounded-xl bg-teal-700 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-800">Explorar experiencias</a>
        }
      }
    </main>
  `,
})
export class MyReservations {
  protected readonly auth = inject(AuthService);
  private readonly cart = inject(CartService);
  private readonly destroy = inject(DestroyRef);
  private readonly atracciones = inject(AtraccionesService);
  private readonly stock = inject(ReservasService);
  protected readonly success = signal<CancellationReceipt | null>(null);
  private readonly dialogs = viewChildren<ElementRef<HTMLDialogElement>>('cancellationDialog');

  protected readonly reservations = signal<Reservation[]>([]);
  protected readonly names = signal<Record<string, string>>({});
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly busy = signal('');
  protected readonly pendingCancel = signal('');
  private readonly now = signal(Date.now());

  constructor() {
    timer(0, 1000).pipe(takeUntilDestroyed(this.destroy)).subscribe(() => this.now.set(Date.now()));
    afterRenderEffect(() => {
      for (const dialog of this.dialogs()) {
        if (!dialog.nativeElement.open) dialog.nativeElement.showModal();
      }
    });
  }

  protected dismissConfirmation(event: Event) {
    if (this.busy()) event.preventDefault();
    else this.pendingCancel.set('');
  }

  ngOnInit(): void {
    if (!this.auth.authenticated()) { this.loading.set(false); return; }
    this.load();
    timer(4500, 4500).pipe(takeUntilDestroyed(this.destroy)).subscribe(() => {
      if (this.auth.authenticated() && !this.busy()) this.load(true);
    });
  }
  protected isCancelled(r: Reservation): boolean { return ['CANCELLED', 'CANCELADO'].includes(r.state); }
  private fetching = false;

  protected label(state: string): string { return STATE_LABEL[state] ?? state; }
  protected nameOf(r: Reservation): string { return this.names()[r.payload.lines[0].itemId] ?? 'Experiencia'; }
  protected checkedIn(r: Reservation): boolean {
    return !!r.checkin_en || ['CHECKED_IN', 'CONFIRMADO_ASISTIDO', 'COMPLETED'].includes(r.state);
  }

  protected withinCancellationWindow(r: Reservation): boolean {
    return r.payload.lines.length > 0 && r.payload.lines.every(line => canCancelTurn(line.date, line.timeSlot, this.now()));
  }

  protected openCancellation(r: Reservation): void {
    this.now.set(Date.now());
    if (this.withinCancellationWindow(r) && !this.checkedIn(r) && r.state === 'CONFIRMED')
      this.pendingCancel.set(r.reservationId);
  }

  protected load(isSilent = false): void {
    if (this.fetching || this.busy()) return;
    this.fetching = true;
    if (!isSilent) this.error.set('');
    this.cart.list().pipe(timeout(10000), finalize(() => this.fetching = false), takeUntilDestroyed(this.destroy)).subscribe({
      next: list => {
        if (this.busy()) return;
        const previous = this.reservations();
        const next = list.filter(r => r.payload?.lines?.length).map(r => {
          const old = previous.find(item => item.reservationId === r.reservationId);
          return old && JSON.stringify(old) === JSON.stringify(r) ? old : r;
        });
        if (next.length !== previous.length || next.some((r, i) => r !== previous[i])) this.reservations.set(next);
        this.loading.set(false);
        const ids = [...new Set(this.reservations().map(r => r.payload.lines[0].itemId))].filter(id => !this.names()[id]);
        if (!ids.length) return;
        forkJoin(ids.map(id => this.atracciones.obtenerAtraccion(id).pipe(
          map(item => [id, item.name] as const), catchError(() => of([id, 'Experiencia'] as const)),
        ))).pipe(takeUntilDestroyed(this.destroy)).subscribe(pairs => this.names.update(names => ({ ...names, ...Object.fromEntries(pairs) })));
      },
      error: err => { this.loading.set(false); if (!isSilent) this.error.set(httpErrorMessage(err)); },
    });
  }

  protected cancel(r: Reservation): void {
    this.now.set(Date.now());
    if (this.busy() || this.checkedIn(r) || r.state !== 'CONFIRMED' || !this.withinCancellationWindow(r)) return;
    this.busy.set(r.reservationId);
    this.error.set('');
    this.message.set('');
    this.cart.cancel(r.reservationId).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => {
        this.message.set('Reembolso solicitado. Tu reserva se actualizará en unos segundos y el cupo se liberará.');
        // El reembolso circula por la saga: se refresca hasta ver la reserva cancelada.
        this.pendingCancel.set('');
        timer(0, 1500).pipe(
          take(20), exhaustMap(() => this.cart.get(r.reservationId)),
          takeWhile(updated => !this.completedCancellation(updated), true),
          takeUntilDestroyed(this.destroy), finalize(() => this.busy.set('')),
        ).subscribe({
          next: updated => {
            this.reservations.update(rows => rows.map(row => row.reservationId === updated.reservationId ? { ...row, ...updated } : row));
            if (this.completedCancellation(updated)) {
              this.success.set(updated.cancellation!);
              this.message.set('Reserva cancelada, reembolso simulado procesado y cupos restituidos.');
              for (const line of updated.payload.lines) this.stock.notificarDisponibilidadCambiada(line.itemId);
            }
          },
          error: err => this.error.set(httpErrorMessage(err)),
          complete: () => {
            const current = this.reservations().find(row => row.reservationId === r.reservationId);
            if (current && !this.completedCancellation(current))
              this.message.set('La cancelación sigue en proceso. Actualiza las reservas para consultar el resultado y el comprobante.');
          },
        });
      },
      error: err => { this.busy.set(''); this.error.set(httpErrorMessage(err)); },
    });
  }

  protected completedCancellation(r: Reservation): boolean {
    return r.cancellation?.refund.status === 'PROCESSED' && r.cancellation?.stock_restoration.status === 'RESTORED';
  }
}
