import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminRole, AdminUser } from '../../contracts/admin.contracts';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { AdminApiService } from './admin-api.service';

@Component({
  selector: 'app-admin-users',
  imports: [ReactiveFormsModule],
  template: `
    <section aria-labelledby="admin-users-title">
      <h2 id="admin-users-title" class="text-2xl font-bold">Usuarios y permisos</h2>
      <details class="mt-5 rounded-2xl border border-teal-200 bg-white p-5">
        <summary class="cursor-pointer font-bold text-teal-900">Crear administrador</summary>
        <p class="mt-2 text-sm text-slate-600">La cuenta se crea con permisos ADMIN. Comparte la clave inicial por un medio privado.</p>
        <form [formGroup]="createForm" (ngSubmit)="createAdministrator()" class="mt-4 grid gap-4 sm:grid-cols-2" aria-label="Crear administrador">
          <label class="text-sm font-semibold">Nombres<input formControlName="first_name" autocomplete="off" maxlength="120" required class="mt-1 w-full rounded-lg border p-3"></label>
          <label class="text-sm font-semibold">Apellidos<input formControlName="last_name" autocomplete="off" maxlength="120" required class="mt-1 w-full rounded-lg border p-3"></label>
          <label class="text-sm font-semibold">Correo del administrador<input formControlName="email" type="email" autocomplete="off" maxlength="160" required class="mt-1 w-full rounded-lg border p-3"></label>
          <label class="text-sm font-semibold">Clave inicial<input formControlName="password" type="password" autocomplete="new-password" minlength="12" required class="mt-1 w-full rounded-lg border p-3"><span class="text-xs font-normal text-slate-500">Mínimo 12 caracteres, máximo 72 bytes.</span></label>
          <button type="submit" [disabled]="creating() || createForm.invalid" class="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{{ creating() ? 'Creando administrador…' : 'Crear cuenta ADMIN' }}</button>
        </form>
      </details>
      <p class="mt-1 text-sm text-slate-600">Activa o desactiva cuentas y administra sus roles. Los cambios de rol o estado cierran las sesiones afectadas; no puedes modificar tu propia cuenta.</p>
      @if (feedback()) { <p role="status" class="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">{{ feedback() }}</p> }
      @if (error()) { <div role="alert" class="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{{ error() }} <button type="button" (click)="load()" class="ml-2 rounded-lg border px-3 py-1">Reintentar</button></div> }
      @if (loading()) { <p role="status" class="my-8 text-center text-slate-600">Cargando usuarios...</p> }
      @else if (users().length) {
        <div class="mt-4 overflow-x-auto rounded-2xl border border-stone-200 bg-white">
          <table class="min-w-full text-left text-sm">
            <thead class="bg-stone-50 text-xs uppercase tracking-wide text-slate-600"><tr><th class="p-3">Usuario</th><th class="p-3">Roles</th><th class="p-3">Estado</th><th class="p-3"><span class="sr-only">Acciones</span></th></tr></thead>
            <tbody class="divide-y divide-stone-100">
              @for (user of users(); track user.id) {
                <tr>
                  <td class="p-3"><p class="font-semibold">{{ user.first_name }} {{ user.last_name }}@if (isSelf(user)) { <span class="ml-1 text-xs text-slate-500">(tú)</span> }</p><p class="text-slate-600">{{ user.email }}{{ user.verified ? '' : ' · sin verificar' }}</p></td>
                  <td class="p-3">
                    <div class="flex flex-wrap items-center gap-2">
                      @for (role of user.roles; track role) {
                        <span class="inline-flex items-center gap-1 rounded-full bg-teal-100 px-3 py-1 text-xs font-bold text-teal-900">{{ role }}
                          @if (!isSelf(user)) { <button type="button" (click)="removeRole(user, role)" [disabled]="busy() === user.id" [attr.aria-label]="'Quitar rol ' + role + ' a ' + user.email" class="font-bold disabled:opacity-50">×</button> }
                        </span>
                      } @empty { <span class="text-slate-500">Sin roles</span> }
                      @if (!isSelf(user) && availableRoles(user).length) {
                        <select #picker (change)="addRole(user, picker.value); picker.value = ''" [disabled]="busy() === user.id" [attr.aria-label]="'Agregar rol a ' + user.email" class="rounded-lg border border-stone-300 px-2 py-1 text-xs">
                          <option value="">+ Agregar rol</option>
                          @for (role of availableRoles(user); track role.id) { <option [value]="role.id">{{ role.name }}</option> }
                        </select>
                      }
                    </div>
                  </td>
                  <td class="p-3"><span class="rounded-full px-3 py-1 text-xs font-bold" [class]="user.active ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-700'">{{ user.active ? 'Activo' : 'Inactivo' }}</span></td>
                  <td class="p-3 text-right">
                    @if (!isSelf(user)) {
                      @if (pendingStatus()?.id === user.id) {
                        <span class="mr-2 text-xs">¿{{ user.active ? 'Desactivar' : 'Reactivar' }}?</span>
                        <button type="button" (click)="confirmStatus(user)" [disabled]="busy() === user.id" class="rounded-lg bg-teal-700 px-3 py-1 font-semibold text-white disabled:opacity-50">Confirmar</button>
                        <button type="button" (click)="pendingStatus.set(null)" [disabled]="busy() === user.id" class="ml-1 rounded-lg border px-3 py-1">Volver</button>
                      } @else {
                        <button type="button" (click)="pendingStatus.set(user)" class="rounded-lg border px-3 py-1 font-semibold" [class.text-red-700]="user.active">{{ user.active ? 'Desactivar' : 'Reactivar' }}</button>
                      }
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <nav class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 p-4" aria-label="Paginación de usuarios">
          <button type="button" (click)="goTo(page() - 1)" [disabled]="page() <= 1 || loading()" class="rounded-lg border bg-white px-4 py-2 disabled:opacity-50">Anterior</button>
          <p class="text-sm">Página {{ page() }} de {{ lastPage() }} ({{ total() }})</p>
          <button type="button" (click)="goTo(page() + 1)" [disabled]="page() >= lastPage() || loading()" class="rounded-lg border bg-white px-4 py-2 disabled:opacity-50">Siguiente</button>
        </nav>
      }
    </section>
  `,
})
export class AdminUsers {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly destroy = inject(DestroyRef);
  readonly users = signal<AdminUser[]>([]);
  readonly creating = signal(false);
  readonly createForm = new FormGroup({
    first_name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120), Validators.pattern(/^[\s\S]*\S[\s\S]*$/)] }),
    last_name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120), Validators.pattern(/^[\s\S]*\S[\s\S]*$/)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(160)] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(12), control => new TextEncoder().encode(control.value ?? '').length > 72 ? { bytes: true } : null] }),
  });
  readonly roles = signal<AdminRole[]>([]);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly busy = signal<string | null>(null);
  readonly error = signal('');
  readonly feedback = signal('');
  readonly pendingStatus = signal<AdminUser | null>(null);
  readonly lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));
  private readonly limit = 10;

  constructor() {
    this.api.roles().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (roles) => this.roles.set(roles.filter(role => role.active)),
      error: (err) => this.error.set(this.api.errorMessage(err)),
    });
    this.load();
  }

  isSelf(user: AdminUser) { return user.id === this.auth.user()?.id; }

  createAdministrator() {
    if (this.creating() || this.createForm.invalid) { this.createForm.markAllAsTouched(); return; }
    this.creating.set(true);
    this.error.set('');
    const value = this.createForm.getRawValue();
    this.api.createAdministrator({ ...value, first_name: value.first_name.trim(), last_name: value.last_name.trim(), email: value.email.trim().toLowerCase() })
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: user => {
          this.creating.set(false);
          this.createForm.reset();
          this.feedback.set(`Administrador creado: ${user.email}. Ya puede iniciar sesión.`);
          this.load();
        },
        error: err => { this.creating.set(false); this.error.set(this.api.errorMessage(err)); },
      });
  }

  availableRoles(user: AdminUser) { return this.roles().filter(role => !user.roles.includes(role.name)); }

  load() {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.api.users(this.page(), this.limit).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (response) => { this.users.set(response.items); this.total.set(response.total); this.loading.set(false); },
      error: (err) => { this.error.set(this.api.errorMessage(err)); this.loading.set(false); },
    });
  }

  goTo(page: number) {
    if (page < 1 || page > this.lastPage() || page === this.page() || this.loading()) return;
    this.page.set(page);
    this.pendingStatus.set(null);
    this.load();
  }

  confirmStatus(user: AdminUser) {
    this.run(user, this.api.setUserActive(user.id, !user.active), `${user.email}: cuenta ${user.active ? 'desactivada' : 'reactivada'}`);
  }

  addRole(user: AdminUser, value: string) {
    const role = this.roles().find(item => String(item.id) === value);
    if (!role) return;
    this.run(user, this.api.assignRole(user.id, role.id), `${user.email}: rol ${role.name} asignado`);
  }

  removeRole(user: AdminUser, name: string) {
    const role = this.roles().find(item => item.name === name);
    if (!role) { this.error.set(`No se pudo identificar el rol ${name}.`); return; }
    this.run(user, this.api.removeRole(user.id, role.id), `${user.email}: rol ${name} retirado`);
  }

  private run(user: AdminUser, request: ReturnType<AdminApiService['assignRole']>, message: string) {
    if (this.busy()) return;
    this.busy.set(user.id);
    this.error.set('');
    request.pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => {
        this.busy.set(null);
        this.pendingStatus.set(null);
        this.feedback.set(message);
        this.toast.mostrar('exito', message);
        this.load();
      },
      error: (err) => { this.busy.set(null); this.pendingStatus.set(null); this.error.set(this.api.errorMessage(err)); },
    });
  }
}
