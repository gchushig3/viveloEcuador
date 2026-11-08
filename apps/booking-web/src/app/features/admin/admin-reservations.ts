import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminReservation, AdminReservationStatus } from '../../contracts/admin.contracts';
import { ToastService } from '../../services/toast.service';
import { AdminApiService } from './admin-api.service';
import { AdminCartReservations } from './admin-cart-reservations';

@Component({
  selector: 'app-admin-reservations',
  imports: [DatePipe, AdminCartReservations],
  template: `
    <section aria-labelledby="admin-reservations-title">
      <h2 id="admin-reservations-title" class="text-2xl font-bold">Reservas</h2>
      <app-admin-cart-reservations />
      <h3 class="mt-8 text-xl font-bold">Reservas del socio Booking</h3>
      <form (submit)="$event.preventDefault(); search()" class="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4">
        <label class="min-w-48 flex-1"><span class="text-sm font-semibold">Buscar</span><input type="search" [value]="q()" (input)="q.set($any($event.target).value)" placeholder="Código, cédula, correo o cliente" class="mt-2 block w-full rounded-xl border border-stone-300 p-3"></label>
        <label><span class="text-sm font-semibold">Estado</span>
          <select [value]="estado()" (change)="estado.set($any($event.target).value)" class="mt-2 block rounded-xl border border-stone-300 p-3">
            <option value="">Todos</option><option value="CONFIRMADA">Confirmada</option><option value="CANCELADA">Cancelada</option><option value="PENDIENTE">Pendiente de confirmación</option><option value="CANCELANDO">Cancelación en proceso</option>
          </select></label>
        <label><span class="text-sm font-semibold">Desde</span><input type="date" [value]="desde()" (input)="desde.set($any($event.target).value)" class="mt-2 block rounded-xl border border-stone-300 p-3"></label>
        <label><span class="text-sm font-semibold">Hasta</span><input type="date" [value]="hasta()" (input)="hasta.set($any($event.target).value)" class="mt-2 block rounded-xl border border-stone-300 p-3"></label>
        <button type="submit" [disabled]="loading()" class="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50">Filtrar</button>
        <button type="button" (click)="clear()" [disabled]="loading()" class="rounded-xl border px-4 py-3">Limpiar</button>
      </form>
      @if (feedback()) { <p role="status" class="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">{{ feedback() }}</p> }
      @if (error()) { <div role="alert" class="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{{ error() }} <button type="button" (click)="load()" class="ml-2 rounded-lg border px-3 py-1">Reintentar</button></div> }
      @if (loading()) { <p role="status" class="my-8 text-center text-slate-600">Cargando reservas...</p> }
      @else if (!rows().length && !error()) { <p class="my-8 rounded-2xl border border-dashed border-stone-300 p-8 text-center text-slate-600">No hay reservas que coincidan con los filtros.</p> }
      @else if (rows().length) {
        <div class="mt-4 overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-stone-50 text-xs uppercase tracking-wide text-slate-600"><tr><th class="p-3">Cliente</th><th class="p-3">Atracción</th><th class="p-3">Fecha</th><th class="p-3">Personas</th><th class="p-3">Estado</th><th class="p-3">Creada</th><th class="p-3"><span class="sr-only">Acciones</span></th></tr></thead>
            <tbody class="divide-y divide-stone-100">
              @for (item of rows(); track item.reserva_id) {
                <tr>
                  <td class="p-3"><p class="font-semibold">{{ item.cliente_nombre }}</p><p class="text-slate-600">{{ item.cliente_email }}</p></td>
                  <td class="p-3">{{ item.atraccion }}</td>
                  <td class="p-3">{{ item.fecha }} {{ item.hora }}</td>
                  <td class="p-3">{{ item.personas }}</td>
                  <td class="p-3"><span class="rounded-full px-3 py-1 text-xs font-bold" [class]="item.estado === 'CONFIRMADA' ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-700'">{{ item.estado === 'CONFIRMADA' ? (item.checkin_en ? 'CONFIRMADO_ASISTIDO' : 'PENDIENTE_ASISTENCIA') : item.estado }}</span></td>
                  <td class="p-3">{{ item.creada_en | date:'short' }}</td>
                  <td class="p-3 text-right"><button type="button" (click)="toggleDetail(item)" class="rounded-lg border px-3 py-1 font-semibold">{{ selected()?.reserva_id === item.reserva_id ? 'Cerrar' : 'Detalle' }}</button></td>
                </tr>
                @if (selected()?.reserva_id === item.reserva_id) {
                  <tr class="bg-stone-50"><td colspan="7" class="p-4">
                    <p class="text-xs text-slate-600">Código: <span class="font-mono">{{ item.reserva_id }}</span></p>
                    @if (item.estado === 'CONFIRMADA') {
                      @if (item.checkin_en) {
                        <p class="mt-3 text-sm font-semibold text-emerald-800">Asistencia confirmada ({{ item.asistentes_reales }} persona(s)) · {{ item.checkin_en | date:'short' }} ·
                          {{ item.booking_notificado ? 'Booking notificado' : 'Booking pendiente de notificar' }}</p>
                      }
                      @if (!item.checkin_en || !item.booking_notificado) {
                        <div class="mt-3 flex flex-wrap items-end gap-3">
                          <label class="text-sm font-semibold">Documento de identidad
                            <input type="text" maxlength="30" [value]="documento()" (input)="documento.set($any($event.target).value)" class="mt-1 block rounded-xl border p-2" />
                          </label>
                          @if (!item.checkin_en) {
                            <label class="text-sm font-semibold">Guía asignado
                              <input type="text" maxlength="100" [value]="guia()" (input)="guia.set($any($event.target).value)" class="mt-1 block rounded-xl border p-2" />
                            </label>
                          }
                          <button type="button" (click)="checkin(item)" [disabled]="checkingIn() || !documento().trim() || (!item.checkin_en && !guia().trim())" class="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{{ checkingIn() ? 'Confirmando...' : (item.checkin_en ? 'Reintentar notificación a Booking' : 'Check-in / Confirmar asistencia') }}</button>
                        </div>
                      }
                    }
                    @if (item.estado !== 'CANCELADA') {
                      @if (confirmingCancel()) {
                        <p class="mt-3 text-sm">¿Cancelar la reserva de <span class="font-semibold">{{ item.cliente_nombre }}</span>? Esta acción no se puede deshacer.</p>
                        <div class="mt-3 flex gap-2">
                          <button type="button" (click)="cancel(item)" [disabled]="cancelling()" class="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{{ cancelling() ? 'Cancelando...' : 'Sí, cancelar' }}</button>
                          <button type="button" (click)="confirmingCancel.set(false)" [disabled]="cancelling()" class="rounded-xl border px-4 py-2 text-sm">Volver</button>
                        </div>
                      } @else {
                        <button type="button" (click)="confirmingCancel.set(true)" class="mt-3 rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700">Cancelar reserva</button>
                      }
                    } @else { <p class="mt-2 text-sm text-slate-600">Esta reserva ya fue cancelada.</p> }
                  </td></tr>
                }
              }
            </tbody>
          </table>
        </div>
        <nav class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 p-4" aria-label="Paginación de reservas">
          <button type="button" (click)="goTo(page() - 1)" [disabled]="page() <= 1 || loading()" class="rounded-lg border bg-white px-4 py-2 disabled:opacity-50">Anterior</button>
          <p class="text-sm">Página {{ page() }} de {{ lastPage() }} ({{ total() }})</p>
          <button type="button" (click)="goTo(page() + 1)" [disabled]="page() >= lastPage() || loading()" class="rounded-lg border bg-white px-4 py-2 disabled:opacity-50">Siguiente</button>
        </nav>
      }
    </section>
  `,
})
export class AdminReservations {
  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);
  private readonly destroy = inject(DestroyRef);
  readonly q = signal('');
  readonly estado = signal<AdminReservationStatus | ''>('');
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly rows = signal<AdminReservation[]>([]);
  readonly page = signal(1);
  readonly lastPage = signal(1);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly feedback = signal('');
  readonly selected = signal<AdminReservation | null>(null);
  readonly confirmingCancel = signal(false);
  readonly cancelling = signal(false);
  readonly checkingIn = signal(false);
  readonly documento = signal('');
  readonly guia = signal('');
  private readonly limit = 10;

  constructor() { this.load(); }

  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.api.reservations({
      page: this.page(), limit: this.limit, estado: this.estado(), q: this.q(),
      fecha_desde: this.desde(), fecha_hasta: this.hasta(),
    }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (response) => {
        this.rows.set(response.items);
        this.total.set(response.total);
        this.lastPage.set(response.total_pages);
        this.loading.set(false);
      },
      error: (err) => { this.error.set(this.api.errorMessage(err)); this.loading.set(false); },
    });
  }

  search() { this.page.set(1); this.selected.set(null); this.load(); }

  clear() {
    this.q.set(''); this.estado.set(''); this.desde.set(''); this.hasta.set('');
    this.search();
  }

  goTo(page: number) {
    if (page < 1 || page > this.lastPage() || page === this.page() || this.loading()) return;
    this.page.set(page);
    this.selected.set(null);
    this.load();
  }

  toggleDetail(item: AdminReservation) {
    this.confirmingCancel.set(false);
    this.documento.set('');
    this.guia.set('');
    this.selected.set(this.selected()?.reserva_id === item.reserva_id ? null : item);
  }

  checkin(item: AdminReservation) {
    if (this.checkingIn()) return;
    this.checkingIn.set(true);
    this.error.set('');
    this.api.checkinReservation(item.reserva_id, { documento_identidad: this.documento().trim(), guia_codigo: this.guia().trim() || undefined }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (result) => {
        this.checkingIn.set(false);
        const updated: AdminReservation = {
          ...item,
          checkin_en: result.hora_checkin,
          asistentes_reales: result.asistentes_reales,
          booking_notificado: result.booking_notificado,
        };
        this.rows.update(rows => rows.map(row => row.reserva_id === updated.reserva_id ? updated : row));
        this.selected.set(updated);
        this.feedback.set(result.booking_notificado
          ? `Check-in confirmado y Booking notificado: ${item.cliente_nombre}`
          : `Check-in guardado, pero Booking no confirmó (${result.booking_error ?? 'sin detalle'}). Reintente.`);
        this.toast.mostrar(result.booking_notificado ? 'exito' : 'error', this.feedback());
      },
      error: (err) => { this.checkingIn.set(false); this.error.set(this.api.errorMessage(err)); },
    });
  }

  cancel(item: AdminReservation) {
    if (this.cancelling()) return;
    this.cancelling.set(true);
    this.api.cancelReservation(item.reserva_id).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (updated) => {
        this.cancelling.set(false);
        this.confirmingCancel.set(false);
        this.rows.update(rows => rows.map(row => row.reserva_id === updated.reserva_id ? updated : row));
        this.selected.set(updated);
        this.feedback.set(`Reserva cancelada: ${updated.cliente_nombre}`);
        this.toast.mostrar('exito', this.feedback());
      },
      error: (err) => { this.cancelling.set(false); this.error.set(this.api.errorMessage(err)); },
    });
  }
}
