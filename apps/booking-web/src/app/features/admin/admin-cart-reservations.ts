import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CartService, Reservation } from '../../services/cart.service';
import { timer, timeout } from 'rxjs';
import { httpErrorMessage } from '../../core/http-errors';

@Component({
  selector: 'app-admin-cart-reservations',
  imports: [CurrencyPipe, DatePipe],
  template: `
    <section class="mt-5 rounded-2xl border border-stone-200 bg-white p-5" aria-labelledby="cart-reservations-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h3 id="cart-reservations-title" class="text-xl font-bold">Reservas de clientes del sitio</h3>
          <p class="mt-1 text-sm text-slate-600">Últimas 100 reservas del carrito. Actualización cada 5 segundos. Abre Ver saga para consultar pago, inventario y compensaciones.</p></div>
        <button type="button" (click)="load()" [disabled]="loading()" class="rounded-xl border px-4 py-2 disabled:opacity-50">Actualizar reservas del sitio</button>
      </div>
      <div class="mt-4 flex flex-wrap items-end gap-3">
        <label for="site-reservation-code" class="min-w-0 flex-1 text-sm font-semibold">Buscar reserva del sitio por código
          <input id="site-reservation-code" type="search" [value]="query()" (input)="query.set($any($event.target).value)" [disabled]="checkingIn()" maxlength="36" autocomplete="off" placeholder="Código completo o parcial" aria-describedby="site-reservation-search-help" class="mt-1 block w-full rounded-xl border border-stone-300 px-3 py-2 font-normal focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-50">
        </label>
        <button type="button" (click)="query.set('')" [disabled]="!query() || checkingIn()" class="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50">Limpiar búsqueda del sitio</button>
      </div>
      <p id="site-reservation-search-help" class="mt-2 text-xs text-slate-500">Filtra las últimas 100 reservas por código completo o parcial, sin distinguir mayúsculas.</p>
      <p role="status" class="mt-2 text-sm text-slate-600">{{ filteredRows().length }} de {{ rows().length }} reservas del sitio</p>
      @if (error()) { <p role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{{ error() }}</p> }
      @if (loading() && !rows().length) { <p role="status" class="mt-4">Consultando reservas del sitio…</p> }
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-stone-50"><tr><th class="p-3">Código / cliente</th><th class="p-3">Actividad</th><th class="p-3">Total</th><th class="p-3">Estado</th><th class="p-3">Verificación</th></tr></thead>
          <tbody class="divide-y">
            @for (r of filteredRows(); track r.reservationId) {
              <tr><td class="p-3"><p class="font-mono text-xs">{{ r.reservationId }}</p><p class="mt-1 text-slate-600">Usuario {{ r.userId }} · {{ r.createdAt | date:'short' }}</p></td>
                <td class="p-3">@for (line of r.payload.lines; track $index) { <p>{{ line.date }} {{ line.timeSlot }} · {{ line.adults + line.children }} personas</p><p class="text-xs text-slate-500">Atracción {{ line.attractionId }}</p> }</td>
                <td class="p-3">{{ r.payload.amountCents / 100 | currency:r.payload.currency }}</td>
                <td class="p-3"><span class="rounded-full px-3 py-1 text-xs font-bold" [class]="r.state === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-900' : r.state === 'PENDING' ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-700'">{{ r.checkin_en ? 'Asistencia confirmada' : label(r.state) }}</span></td>
                <td class="p-3">Pago {{ r.paid ? 'procesado' : 'sin confirmar' }}<br>Cupo {{ r.stockConfirmed ? 'confirmado' : 'sin confirmar' }}
                  <details class="mt-3">
                    <summary class="cursor-pointer font-semibold text-teal-800">Ver saga</summary>
                    <ol class="mt-2 space-y-2 text-xs">
                      <li>Reserva: {{ r.reservationId }}</li>
                      <li>Estado: {{ label(r.state) }}</li>
                      <li>Pago: {{ r.paid ? 'Procesado' : 'Sin confirmar' }}</li>
                      <li>Inventario: {{ r.stockConfirmed ? 'Confirmado' : 'Sin confirmar' }}</li>
                      @if (r.cancellation; as cancellation) {
                        <li>Cancelación: {{ cancellation.status }}</li>
                        <li>Reembolso: {{ cancellation.refund.status }} · {{ cancellation.monto_reembolsado | currency:r.payload.currency }}</li>
                        <li>Restitución de cupos: {{ cancellation.stock_restoration.status }}</li>
                      }
                    </ol>
                    <p class="mt-2 text-xs text-slate-500">Estado confirmado por los servicios. No es un historial de eventos.</p>
                  </details>
                  @if (r.checkin_en) {
                    <p class="mt-3 font-semibold text-emerald-800">Check-in: {{ r.checkin_en | date:'short' }}</p>
                    <p class="text-xs">{{ r.checkin?.asistentes_reales }} asistentes · Guía {{ r.checkin?.guia_codigo }}</p>
                  } @else if ((r.state === 'CONFIRMED' || (r.state === 'PENDING' && r.paid)) && !r.cancellation) {
                    <button type="button" (click)="selectCheckin(r.reservationId)" class="mt-3 rounded-lg border px-3 py-2 font-semibold text-teal-800">Check-in / Confirmar asistencia</button>
                  }
                </td></tr>
                @if (selected() === r.reservationId && !r.checkin_en) {
                  <tr class="bg-stone-50"><td colspan="5" class="p-4">
                    <form (submit)="$event.preventDefault(); checkin(r)" class="flex flex-wrap items-end gap-3">
                      <label class="text-sm font-semibold">Documento del titular (cédula o RUC)
                        <input [value]="documento()" (input)="setDocument($event)" inputmode="numeric" maxlength="13" required pattern="[0-9]{10}([0-9]{3})?" class="mt-1 block rounded-xl border p-2">
                      </label>
                      <label class="text-sm font-semibold">Guía asignado
                        <input [value]="guia()" (input)="guia.set($any($event.target).value)" required maxlength="100" class="mt-1 block rounded-xl border p-2">
                      </label>
                      <button type="submit" [disabled]="checkingIn() || !guia().trim() || !validDocument()" class="rounded-xl bg-teal-700 px-4 py-2 text-white disabled:opacity-50">{{ checkingIn() ? 'Confirmando...' : 'Confirmar check-in' }}</button>
                      <button type="button" [disabled]="checkingIn()" (click)="selected.set(null)" class="rounded-xl border px-4 py-2">Cerrar</button>
                    </form>
                  </td></tr>
                }
            } @empty { @if (!loading() && !error()) { <tr><td colspan="5" class="p-6 text-center text-slate-500">{{ query().trim() ? 'No hay reservas que coincidan con ese código.' : 'Todavía no hay reservas del sitio.' }}</td></tr> } }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class AdminCartReservations {
  private readonly cart = inject(CartService);
  private readonly destroy = inject(DestroyRef);
  readonly rows = signal<Array<Reservation & { userId: string }>>([]);
  readonly query = signal('');
  readonly filteredRows = computed(() => {
    const code = this.query().trim().toLowerCase();
    return this.rows().filter(row => row.reservationId.toLowerCase().includes(code));
  });
  readonly loading = signal(false);
  readonly error = signal('');
  readonly selected = signal<string | null>(null);
  readonly documento = signal('');
  readonly guia = signal('');
  readonly checkingIn = signal(false);
  private inFlight = false;
  constructor() {
    this.load();
    timer(5000, 5000).pipe(takeUntilDestroyed(this.destroy)).subscribe(() => this.load(true));
  }
  selectCheckin(id: string) {
    if (this.checkingIn()) return;
    this.selected.set(id); this.documento.set(''); this.guia.set('');
  }
  validDocument() { return /^\d{10}(?:\d{3})?$/.test(this.documento()); }
  setDocument(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 13); this.documento.set(input.value);
  }
  checkin(row: Reservation) {
    if (this.checkingIn() || !this.validDocument() || !this.guia().trim()) return;
    this.checkingIn.set(true); this.error.set('');
    this.cart.checkin(row.reservationId, { documento_identidad: this.documento(), guia_codigo: this.guia().trim() })
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: receipt => {
          this.rows.update(rows => rows.map(item => item.reservationId === row.reservationId
            ? { ...item, checkin_en: receipt.hora_checkin, checkin: receipt } : item));
          this.selected.set(null); this.checkingIn.set(false);
        },
        error: err => { this.error.set(httpErrorMessage(err)); this.checkingIn.set(false); },
      });
  }
  label(state: string) { return ({ PENDING: 'Procesando', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada / no completada' } as Record<string, string>)[state] ?? state; }
  load(silent = false) {
    if (this.inFlight || this.checkingIn()) return;
    this.inFlight = true;
    if (!silent) this.loading.set(true);
    this.error.set('');
    this.cart.adminList().pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
      next: rows => { this.rows.set(rows); this.loading.set(false); this.inFlight = false; },
      error: err => { this.error.set(httpErrorMessage(err)); this.loading.set(false); this.inFlight = false; },
    });
  }
}
