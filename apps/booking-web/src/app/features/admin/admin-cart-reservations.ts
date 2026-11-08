import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CartService, Reservation } from '../../services/cart.service';
import { httpErrorMessage } from '../../core/http-errors';

@Component({
  selector: 'app-admin-cart-reservations',
  imports: [CurrencyPipe, DatePipe],
  template: `
    <section class="mt-5 rounded-2xl border border-stone-200 bg-white p-5" aria-labelledby="cart-reservations-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h3 id="cart-reservations-title" class="text-xl font-bold">Reservas de clientes del sitio</h3>
          <p class="mt-1 text-sm text-slate-600">Últimas 100 reservas del carrito. Una reserva se confirma cuando pago e inventario terminan correctamente.</p></div>
        <button type="button" (click)="load()" [disabled]="loading()" class="rounded-xl border px-4 py-2 disabled:opacity-50">Actualizar reservas del sitio</button>
      </div>
      @if (error()) { <p role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{{ error() }}</p> }
      @if (loading()) { <p role="status" class="mt-4">Consultando reservas del sitio…</p> }
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-stone-50"><tr><th class="p-3">Código / cliente</th><th class="p-3">Actividad</th><th class="p-3">Total</th><th class="p-3">Estado</th><th class="p-3">Verificación</th></tr></thead>
          <tbody class="divide-y">
            @for (r of rows(); track r.reservationId) {
              <tr><td class="p-3"><p class="font-mono text-xs">{{ r.reservationId }}</p><p class="mt-1 text-slate-600">Usuario {{ r.userId }} · {{ r.createdAt | date:'short' }}</p></td>
                <td class="p-3">@for (line of r.payload.lines; track $index) { <p>{{ line.date }} {{ line.timeSlot }} · {{ line.adults + line.children }} personas</p><p class="text-xs text-slate-500">Atracción {{ line.attractionId }}</p> }</td>
                <td class="p-3">{{ r.payload.amountCents / 100 | currency:r.payload.currency }}</td>
                <td class="p-3"><span class="rounded-full px-3 py-1 text-xs font-bold" [class]="r.state === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-900' : r.state === 'PENDING' ? 'bg-amber-100 text-amber-900' : 'bg-stone-100 text-stone-700'">{{ label(r.state) }}</span></td>
                <td class="p-3">Pago {{ r.paid ? 'procesado' : 'sin confirmar' }}<br>Cupo {{ r.stockConfirmed ? 'confirmado' : 'sin confirmar' }}</td></tr>
            } @empty { @if (!loading() && !error()) { <tr><td colspan="5" class="p-6 text-center text-slate-500">Todavía no hay reservas del sitio.</td></tr> } }
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
  readonly loading = signal(false);
  readonly error = signal('');
  constructor() { this.load(); }
  label(state: string) { return ({ PENDING: 'Procesando', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada / no completada' } as Record<string, string>)[state] ?? state; }
  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.cart.adminList().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: rows => { this.rows.set(rows); this.loading.set(false); },
      error: err => { this.error.set(httpErrorMessage(err)); this.loading.set(false); },
    });
  }
}
