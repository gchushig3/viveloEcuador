import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, timer, timeout } from 'rxjs';
import { AdminApiService } from './admin-api.service';
import { AdminClient, AdminClientDetail, AdminLocalReservation } from '../../contracts/admin.contracts';

@Component({
  selector: 'app-admin-clients',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule],
  template: `
    <section aria-labelledby="clients-title" class="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div><h2 id="clients-title" class="text-2xl font-black">Clientes</h2><p class="mt-1 text-sm text-slate-600">Consulta y trazabilidad de clientes de la tienda y Booking.</p></div>
        <form (submit)="$event.preventDefault(); search()" class="flex gap-2">
          <label class="sr-only" for="client-query">Buscar cliente</label>
          <input id="client-query" [value]="query()" (input)="query.set($any($event.target).value)" placeholder="Nombre, cédula o correo" class="min-w-52 rounded-xl border border-stone-300 px-3 py-2 text-sm" />
          <button type="submit" [disabled]="loading()" class="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Buscar</button>
        </form>
      </div>
      @if (error()) { <p role="alert" class="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{{ error() }} <button type="button" (click)="load()" class="ml-2 underline">Reintentar</button></p> }
      <div class="mt-5">
        <button type="button" (click)="showCreate.set(!showCreate())" [disabled]="saving()" class="rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white">{{ showCreate() ? 'Cancelar' : 'Crear cliente' }}</button>
        @if (createMessage()) { <p role="status" class="mt-3 text-teal-800">{{ createMessage() }}</p> }
        @if (showCreate()) {
          <form [formGroup]="createForm" (ngSubmit)="saveClient()" class="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4" novalidate>
            <h3 class="font-bold">Nuevo cliente</h3>
            <p class="mt-1 text-sm text-slate-600">Registra sus datos sin crear una cuenta ni contraseña.</p>
            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              <label>Nombre completo *<input formControlName="nombre" autocomplete="name" maxlength="200" class="mt-1 w-full rounded-xl border p-3" /></label>
              <label>Correo electrónico *<input type="email" formControlName="email" autocomplete="email" maxlength="200" class="mt-1 w-full rounded-xl border p-3" /></label>
              <label>Identificación<input formControlName="identificacion" maxlength="30" class="mt-1 w-full rounded-xl border p-3" /></label>
              <label>Teléfono<input type="tel" formControlName="telefono" autocomplete="tel" maxlength="30" class="mt-1 w-full rounded-xl border p-3" /></label>
            </div>
            @if (createError()) { <p role="alert" class="mt-3 text-red-800">{{ createError() }}</p> }
            <button type="submit" [disabled]="saving()" class="mt-4 rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{{ saving() ? 'Guardando...' : 'Guardar cliente' }}</button>
          </form>
        }
      </div>
      @if (loading()) { <p role="status" class="my-8 text-center text-slate-600">Cargando clientes...</p> }
      @else if (!items().length && !error()) { <p class="my-8 rounded-2xl border border-dashed border-stone-300 p-8 text-center text-slate-600">No hay clientes para mostrar.</p> }
      @else {
        <div class="mt-5 overflow-x-auto rounded-2xl border border-stone-200">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-stone-50 text-xs uppercase tracking-wide text-slate-600"><tr><th class="p-3">Identificación</th><th class="p-3">Cliente</th><th class="p-3">Correo</th><th class="p-3">Teléfono</th><th class="p-3">Origen</th><th class="p-3">Registro</th><th class="p-3"><span class="sr-only">Historial</span></th></tr></thead>
            <tbody class="divide-y divide-stone-100">
              @for (client of items(); track client.client_id) {
                <tr><td class="p-3 font-mono">{{ client.identificacion || '—' }}</td><td class="p-3 font-semibold">{{ client.nombre }}</td><td class="p-3">{{ client.email }}</td><td class="p-3">{{ client.telefono || '—' }}</td><td class="p-3"><div class="flex flex-wrap gap-1">@for (origin of client.origenes; track origin) { <span class="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-900">{{ origin === 'TIENDA' ? 'Tienda web' : 'Booking' }}</span> }</div></td><td class="p-3">{{ client.creado_en ? (client.creado_en | date:'short') : '—' }}</td><td class="p-3 text-right"><button type="button" (click)="toggle(client)" class="rounded-lg border px-3 py-1 font-semibold">{{ selected()?.client_id === client.client_id ? 'Cerrar' : 'Historial' }}</button></td></tr>
                @if (selected()?.client_id === client.client_id) {
                  <tr class="bg-stone-50"><td colspan="7" class="p-4">
                    @if (detailLoading()) { <p role="status">Cargando historial...</p> }
                    @else if (detailError()) { <p role="alert" class="text-red-800">{{ detailError() }}</p> }
                      @else if (detail(); as selectedClient) {
                      <h3 class="font-bold">Reservas de {{ selectedClient.nombre }}</h3>
                      @if (localReservations().length) {
                        <h4 class="mt-4 text-sm font-bold">Compras en la tienda web</h4>
                        <div class="mt-2 overflow-x-auto"><table class="min-w-full text-left text-sm"><thead><tr class="text-xs uppercase text-slate-500"><th class="p-2">Código</th><th class="p-2">Fecha de compra</th><th class="p-2">Estado</th><th class="p-2">Pago</th></tr></thead><tbody class="divide-y divide-stone-200">@for (reservation of localReservations(); track reservation.reservationId) { <tr><td class="p-2 font-mono">{{ reservation.reservationId }}</td><td class="p-2">{{ reservation.createdAt | date:'short' }}</td><td class="p-2">{{ reservation.state }}</td><td class="p-2">{{ reservation.paid ? 'Pagado' : 'Pendiente' }}</td></tr> }</tbody></table></div>
                      }
                      @if (localReservationsError()) { <p role="alert" class="mt-3 text-sm text-amber-800">{{ localReservationsError() }} <button type="button" (click)="retryLocalReservations()" class="underline">Reintentar compras web</button></p> }
                      <h4 class="mt-4 text-sm font-bold">Reservas de Booking</h4>
                      @if (!selectedClient.reservas.length) { <p class="mt-2 text-sm text-slate-600">Todavía no hay reservas asociadas a este cliente.</p> }
                      @else { <div class="mt-3 overflow-x-auto"><table class="min-w-full text-left text-sm"><thead><tr class="text-xs uppercase text-slate-500"><th class="p-2">Atracción</th><th class="p-2">Fecha</th><th class="p-2">Personas</th><th class="p-2">Estado</th><th class="p-2">Código</th></tr></thead><tbody class="divide-y divide-stone-200">@for (reservation of selectedClient.reservas; track reservation.reserva_id) { <tr><td class="p-2">{{ reservation.atraccion }}</td><td class="p-2">{{ reservation.fecha }} · {{ reservation.hora }}</td><td class="p-2">{{ reservation.personas }}</td><td class="p-2">{{ reservation.estado }}</td><td class="p-2 font-mono">{{ reservation.reserva_id }}</td></tr> }</tbody></table></div> }
                    }
                  </td></tr>
                }
              }
            </tbody>
          </table>
        </div>
        <div class="mt-4 flex items-center justify-between rounded-xl bg-stone-50 p-3 text-sm"><button type="button" (click)="goTo(page() - 1)" [disabled]="page() <= 1 || loading()" class="rounded-lg border bg-white px-3 py-2 disabled:opacity-50">Anterior</button><p>Página {{ page() }} de {{ totalPages() }} · {{ total() }} clientes</p><button type="button" (click)="goTo(page() + 1)" [disabled]="page() >= totalPages() || loading()" class="rounded-lg border bg-white px-3 py-2 disabled:opacity-50">Siguiente</button></div>
      }
    </section>
  `,
})
export class AdminClients {
  private readonly api = inject(AdminApiService);
  private readonly destroy = inject(DestroyRef);
  readonly showCreate = signal(false);
  readonly saving = signal(false);
  readonly createError = signal('');
  readonly createMessage = signal('');
  readonly createForm = new FormGroup({
    nombre: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(200)] }),
    identificacion: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^[\p{L}\p{N}.-]{3,30}$/u)] }),
    telefono: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^\+?[0-9 ()-]{7,30}$/)] }),
  });

  saveClient() {
    if (this.saving()) return;
    const values = this.createForm.getRawValue();
    this.createForm.setValue({ nombre: values.nombre.trim(), email: values.email.trim().toLowerCase(), identificacion: values.identificacion.trim(), telefono: values.telefono.trim() });
    this.createError.set(''); this.createMessage.set('');
    if (this.createForm.invalid) { this.createForm.markAllAsTouched(); this.createError.set('Revisa el nombre, correo y los datos de contacto.'); return; }
    const input = this.createForm.getRawValue();
    this.saving.set(true);
    this.api.createClient({ nombre: input.nombre, email: input.email,
      ...(input.identificacion ? { identificacion: input.identificacion } : {}),
      ...(input.telefono ? { telefono: input.telefono } : {}),
    }).pipe(timeout(15000), takeUntilDestroyed(this.destroy)).subscribe({
      next: result => {
        this.saving.set(false); this.showCreate.set(false); this.createForm.reset();
        this.createMessage.set(result.reused ? 'El cliente ya estaba registrado. Se conservó su registro.' : 'Cliente creado correctamente.');
        this.query.set(result.cliente.email); this.search();
      },
      error: error => { this.saving.set(false); this.createError.set(this.api.errorMessage(error)); },
    });
  }
  readonly items = signal<AdminClient[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly query = signal('');
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPages = signal(1);
  readonly selected = signal<AdminClient | null>(null);
  readonly detail = signal<AdminClientDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');
  readonly localReservationsError = signal('');
  readonly localReservations = signal<AdminLocalReservation[]>([]);
  private detailRequest?: Subscription;
  private localReservationsRequest?: Subscription;

  constructor() {
    this.load();
    timer(10000, 10000).pipe(takeUntilDestroyed(this.destroy)).subscribe(() => this.load(true));
  }

  private listRequest?: Subscription;
  private refreshing = false;
  load(silent = false) {
    if (silent && this.refreshing) return;
    this.listRequest?.unsubscribe();
    this.refreshing = true;
    if (!silent) this.loading.set(true);
    this.error.set('');
    this.listRequest = this.api.clients(this.page(), 20, this.query()).pipe(timeout(15000), takeUntilDestroyed(this.destroy)).subscribe({
      next: result => { this.items.set(result.items); this.total.set(result.total); this.totalPages.set(result.total_pages); this.loading.set(false); this.refreshing = false; },
      error: error => { this.error.set(this.api.errorMessage(error)); this.loading.set(false); this.refreshing = false; },
    });
  }
  search() { this.resetDetail(); this.page.set(1); this.load(); }
  goTo(page: number) { if (page < 1 || page > this.totalPages()) return; this.resetDetail(); this.page.set(page); this.load(); }
  toggle(client: AdminClient) {
    if (this.selected()?.client_id === client.client_id) {
      this.resetDetail(); return;
    }
    this.detailRequest?.unsubscribe(); this.localReservationsRequest?.unsubscribe();
    this.selected.set(client); this.detail.set(null); this.detailLoading.set(true); this.detailError.set('');
    this.localReservationsError.set('');
    this.localReservations.set([]);
    this.detailRequest = this.api.client(client.client_id).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: result => {
        this.detail.set(result);
        if (!result.usuario_id) { this.detailLoading.set(false); return; }
        this.loadLocalReservations(result.usuario_id);
      },
      error: error => { this.detailError.set(this.api.errorMessage(error)); this.detailLoading.set(false); },
    });
  }
  retryLocalReservations() {
    const userId = this.detail()?.usuario_id;
    if (userId) this.loadLocalReservations(userId);
  }
  private loadLocalReservations(userId: string) {
    this.localReservationsError.set(''); this.detailLoading.set(true);
    this.localReservationsRequest?.unsubscribe();
    this.localReservationsRequest = this.api.clientLocalReservations(userId).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: reservations => { this.localReservations.set(reservations); this.detailLoading.set(false); },
      error: error => {
        this.localReservationsError.set(this.api.errorMessage(error));
        this.detailLoading.set(false);
      },
    });
  }
  private resetDetail() {
    this.detailRequest?.unsubscribe(); this.localReservationsRequest?.unsubscribe();
    this.selected.set(null); this.detail.set(null); this.detailLoading.set(false);
    this.detailError.set(''); this.localReservationsError.set(''); this.localReservations.set([]);
  }
}
