import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AdminSummary } from '../../contracts/admin.contracts';
import { AdminApiService } from './admin-api.service';

@Component({
  selector: 'app-admin-dashboard',
  imports: [DatePipe, RouterLink],
  template: `
    <section aria-labelledby="admin-dashboard-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-dashboard-title" class="text-2xl font-bold">Resumen operativo</h2>
        <button type="button" (click)="load()" [disabled]="loading()" class="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50">Actualizar</button>
      </div>
      <div class="mt-5 flex flex-wrap gap-3 rounded-2xl bg-teal-900 p-5 text-white" aria-label="Acciones rápidas">
        <a routerLink="/admin/atracciones" class="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-teal-900">Crear atracción y configurar cupos</a>
        <a routerLink="/admin/usuarios" class="rounded-xl border border-teal-500 px-4 py-3 text-sm font-semibold">Crear administrador</a>
        <a routerLink="/admin/reservas" class="rounded-xl border border-teal-500 px-4 py-3 text-sm font-semibold">Reservas del sitio y Booking</a>
      </div>
      <p class="mt-4 text-sm text-slate-600">Las cifras de reservas de este resumen corresponden al socio Booking. Consulta las reservas del sitio en Reservas.</p>
      @if (loading() && !summary()) { <p role="status" class="my-8 text-center text-slate-600">Cargando resumen...</p> }
      @if (error()) { <p role="alert" class="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{{ error() }}</p> }
      @if (summary(); as s) {
        <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article class="rounded-2xl border border-stone-200 bg-white p-5"><p class="text-sm text-slate-600">Reservas de hoy</p><p class="mt-2 text-3xl font-bold">{{ s.reservas.hoy }}</p></article>
          <article class="rounded-2xl border border-stone-200 bg-white p-5"><p class="text-sm text-slate-600">Reservas próximas</p><p class="mt-2 text-3xl font-bold">{{ s.reservas.proximas }}</p><p class="mt-1 text-xs text-slate-500">{{ s.reservas.personas_proximas }} personas desde hoy</p></article>
          <article class="rounded-2xl border border-stone-200 bg-white p-5"><p class="text-sm text-slate-600">Nuevas en 24 h</p><p class="mt-2 text-3xl font-bold">{{ s.reservas.ultimas_24h }}</p></article>
          <article class="rounded-2xl border border-stone-200 bg-white p-5"><p class="text-sm text-slate-600">Canceladas</p><p class="mt-2 text-3xl font-bold">{{ s.reservas.canceladas }}</p><p class="mt-1 text-xs text-slate-500">de {{ s.reservas.total }} reservas</p></article>
          <article class="rounded-2xl border border-stone-200 bg-white p-5"><p class="text-sm text-slate-600">Atracciones publicadas</p><p class="mt-2 text-3xl font-bold">{{ s.atracciones.publicadas }}</p><p class="mt-1 text-xs text-slate-500">{{ s.atracciones.borradores }} borradores · {{ s.atracciones.inactivas }} inactivas</p></article>
          <article class="rounded-2xl border border-stone-200 bg-white p-5"><p class="text-sm text-slate-600">Usuarios registrados</p><p class="mt-2 text-3xl font-bold">{{ usersTotal() ?? '—' }}</p></article>
        </div>
        <div class="mt-6 grid gap-6 lg:grid-cols-2">
          <section class="rounded-2xl border border-stone-200 bg-white p-5" aria-labelledby="top-title">
            <h3 id="top-title" class="font-bold">Atracciones más reservadas</h3>
            @if (!s.top_atracciones.length) { <p class="mt-3 text-sm text-slate-600">Aún no hay reservas confirmadas.</p> }
            <ol class="mt-3 divide-y divide-stone-100">
              @for (item of s.top_atracciones; track item.atraccion_id) {
                <li class="flex items-center justify-between gap-3 py-2 text-sm"><span class="font-semibold">{{ item.atraccion }}</span><span class="text-slate-600">{{ item.reservas }} reservas · {{ item.personas }} personas</span></li>
              }
            </ol>
          </section>
          <section class="rounded-2xl border border-stone-200 bg-white p-5" aria-labelledby="recent-title">
            <div class="flex items-center justify-between"><h3 id="recent-title" class="font-bold">Reservas recientes</h3><a routerLink="/admin/reservas" class="text-sm font-semibold text-teal-800">Ver todas</a></div>
            @if (!s.recientes.length) { <p class="mt-3 text-sm text-slate-600">Aún no hay reservas.</p> }
            <ul class="mt-3 divide-y divide-stone-100">
              @for (item of s.recientes; track item.reserva_id) {
                <li class="py-2 text-sm"><p class="font-semibold">{{ item.atraccion }} · {{ item.estado }}</p><p class="text-slate-600">{{ item.cliente_nombre }} · {{ item.fecha }} {{ item.hora }} · {{ item.creada_en | date:'short' }}</p></li>
              }
            </ul>
          </section>
        </div>
      }
    </section>
  `,
})
export class AdminDashboard {
  private readonly api = inject(AdminApiService);
  private readonly destroy = inject(DestroyRef);
  readonly summary = signal<AdminSummary | null>(null);
  readonly usersTotal = signal<number | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor() { this.load(); }

  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.api.summary().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (summary) => { this.summary.set(summary); this.loading.set(false); },
      error: (err) => { this.error.set(this.api.errorMessage(err)); this.loading.set(false); },
    });
    this.api.users(1, 1).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (page) => this.usersTotal.set(page.total),
      error: () => this.usersTotal.set(null),
    });
  }
}
