import { CurrencyPipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReservationQr } from '../../components/reservation-qr/reservation-qr';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Atraccion, AtraccionesService } from '../../services/atracciones.service';
import { AuthService } from '../../services/auth.service';
import { API_URL } from '../../core/api.config';
import { HttpClient } from '@angular/common/http';
import { CartService, Reservation, slotIdOf } from '../../services/cart.service';
import { httpErrorMessage } from '../../core/http-errors';
import { switchMap, throwError, timeout } from 'rxjs';

export function luhn(control: AbstractControl): ValidationErrors | null {
  const digits = String(control.value ?? '').replace(/\s+/g, '');
  if (!/^\d{13,19}$/.test(digits)) return { card: true };
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0 ? null : { card: true };
}

// The simulated payment service does not authorize real card numbers.
export function simulatedCardNumber(control: AbstractControl): ValidationErrors | null {
  return /^\d{13,19}$/.test(String(control.value ?? '').replace(/\s+/g, '')) ? null : { card: true };
}

export function expiry(control: AbstractControl): ValidationErrors | null {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(String(control.value ?? ''));
  if (!match) return { expiry: true };
  const end = new Date(2000 + Number(match[2]), Number(match[1]), 1);
  return end > new Date() ? null : { expiry: true };
}

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, CurrencyPipe, ReservationQr],
  template: `
    <main class="min-h-screen bg-stone-50 px-4 py-8 sm:px-8">
      <div class="mx-auto max-w-4xl">
        <h1 class="text-3xl font-black">Confirmar y pagar</h1>
        @if (!auth.authenticated()) {
          <p role="alert" class="mt-6 rounded-2xl bg-amber-50 p-5 text-amber-900">Inicia sesión desde la cabecera para completar tu reserva.</p>
        } @else if (loadError()) {
          <p role="alert" class="mt-6 rounded-2xl bg-red-50 p-5 text-red-800">{{ loadError() }}</p>
          <a routerLink="/actividades" class="mt-4 inline-block font-semibold text-teal-800 underline">Volver a elegir una experiencia</a>
        } @else if (attraction(); as item) {
          @if (result(); as r) {
            <section class="mt-6 rounded-3xl bg-white p-8 shadow-sm" aria-live="polite">
              <p class="text-sm font-bold uppercase tracking-widest text-emerald-700">¡Reserva confirmada!</p>
              <h2 class="mt-2 text-2xl font-black">{{ item.name }}</h2>
              <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt class="font-semibold">Código</dt><dd class="font-mono">{{ r.reservationId.slice(0, 8).toUpperCase() }}</dd></div>
                <div><dt class="font-semibold">Fecha y hora</dt><dd>{{ fecha() }} · {{ hora() }}</dd></div>
                <div><dt class="font-semibold">Personas</dt><dd>{{ adultos() }} adultos, {{ ninos() }} niños</dd></div>
                <div><dt class="font-semibold">Total pagado</dt><dd>{{ r.payload.amountCents / 100 | currency:'USD' }}</dd></div>
              </dl>
              <div class="mt-6"><app-reservation-qr [identifier]="r.reservationId" status="CONFIRMADA" /></div>
              <a routerLink="/reservas" class="mt-6 inline-block rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white hover:bg-teal-800">Ver mis reservas</a>
            </section>
          } @else {
            <div class="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
              <form [formGroup]="form" (ngSubmit)="review()" class="space-y-4 rounded-3xl bg-white p-6 shadow-sm" aria-label="Pago">
                <p class="text-sm text-slate-600">Paso 1 de 2 · Completa tus datos. Podrás revisar la reserva antes de confirmar el pago simulado.</p>
                <fieldset [disabled]="processing() || reviewing() || uncertain()" class="space-y-4">
                <h2 class="text-xl font-bold">Datos del cliente</h2>
                <label class="block text-sm font-semibold">Tipo de documento
                  <select [value]="documentType()" (change)="changeDocumentType($any($event.target).value)" class="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2">
                    <option value="cedula">Cédula</option><option value="ruc">RUC</option>
                  </select>
                </label>
                <label class="block text-sm font-semibold">{{ documentType() === 'cedula' ? 'Cédula' : 'RUC' }}
                  <input formControlName="identificacion" (input)="formatInput($event, 'identificacion')" [attr.aria-invalid]="form.controls.identificacion.touched && form.controls.identificacion.invalid" inputmode="numeric" autocomplete="off" [maxlength]="documentType() === 'cedula' ? 10 : 13" [placeholder]="documentType() === 'cedula' ? '10 dígitos' : '13 dígitos'" class="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2">
                  @if (form.controls.identificacion.touched && form.controls.identificacion.invalid) { <span role="alert" class="text-xs text-red-700">Ingresa {{ documentType() === 'cedula' ? 'una cédula de 10' : 'un RUC de 13' }} dígitos.</span> }
                </label>
                <label class="block text-sm font-semibold">Teléfono
                  <input formControlName="telefono" type="tel" autocomplete="tel" inputmode="tel" maxlength="30" placeholder="099 123 4567" [attr.aria-invalid]="form.controls.telefono.touched && form.controls.telefono.invalid" class="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2">
                  @if (form.controls.telefono.touched && form.controls.telefono.invalid) { <span role="alert" class="text-xs text-red-700">Ingresa un teléfono válido (mínimo 7 dígitos).</span> }
                </label>
                <h2 class="text-xl font-bold">Datos de la tarjeta</h2>
                <label class="block text-sm font-semibold">Titular
                  <input formControlName="holder" [attr.aria-invalid]="form.controls.holder.touched && form.controls.holder.invalid" maxlength="120" autocomplete="cc-name" class="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2">
                </label>
                @if (form.controls.holder.touched && form.controls.holder.invalid) { <p role="alert" class="text-sm text-red-700">Escribe el nombre del titular (de 3 a 120 caracteres).</p> }
                <label class="block text-sm font-semibold">Número de tarjeta
                  <input formControlName="number" (input)="formatInput($event, 'number')" [attr.aria-invalid]="form.controls.number.touched && form.controls.number.invalid" maxlength="23" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" class="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2">
                  @if (form.controls.number.touched && form.controls.number.invalid) { <span role="alert" class="text-xs text-red-700">Ingresa entre 13 y 19 dígitos para el pago simulado.</span> }
                </label>
                <div class="grid grid-cols-2 gap-4">
                  <label class="block text-sm font-semibold">Vence (MM/AA)
                    <input formControlName="expiry" (input)="formatInput($event, 'expiry')" [attr.aria-invalid]="form.controls.expiry.touched && form.controls.expiry.invalid" inputmode="numeric" maxlength="5" autocomplete="cc-exp" placeholder="12/30" class="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2">
                    @if (form.controls.expiry.touched && form.controls.expiry.invalid) { <span role="alert" class="text-xs text-red-700">Fecha inválida</span> }
                  </label>
                  <label class="block text-sm font-semibold">CVV
                    <input type="password" formControlName="cvv" (input)="formatInput($event, 'cvv')" [attr.aria-invalid]="form.controls.cvv.touched && form.controls.cvv.invalid" inputmode="numeric" autocomplete="cc-csc" maxlength="4" class="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2">
                  </label>
                </div>
                @if (form.controls.cvv.touched && form.controls.cvv.invalid) { <p role="alert" class="text-sm text-red-700">El CVV debe tener 3 o 4 dígitos.</p> }
                </fieldset>
                <p class="text-xs text-slate-500">Entorno de simulación: los datos de la tarjeta se validan en tu navegador y no se envían ni se almacenan. El resultado del cobro lo decide el servicio de pagos simulado.</p>
                @if (error()) { <p role="alert" class="rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ error() }}</p> }
                @if (uncertain()) {
                  <p role="alert" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Estamos verificando el resultado. Revisa Mis reservas antes de hacer otra compra para evitar duplicados.</p>
                  <a routerLink="/reservas" class="inline-block rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white">Consultar Mis reservas</a>
                } @else if (reviewing()) {
                  <section aria-labelledby="review-title" class="rounded-2xl border border-teal-200 bg-teal-50 p-4">
                    <h2 id="review-title" class="font-bold">Paso 2 de 2 · Revisa antes de confirmar</h2>
                    <p class="mt-2">{{ item.name }} · {{ fecha() }} a las {{ hora() }} (hora de Ecuador)</p>
                    <p>{{ adultos() }} adultos y {{ ninos() }} niños · Total: {{ total() | currency:'USD' }}</p>
                    <p class="mt-2 text-sm">La cancelación con reembolso requiere al menos 24 horas antes del turno y no haber realizado check-in. No hay reembolsos parciales.</p>
                    <button type="button" (click)="reviewing.set(false)" [disabled]="processing()" class="mt-4 rounded-xl border border-teal-700 px-4 py-2 disabled:opacity-50">Corregir datos</button>
                    <button type="button" (click)="pay()" [disabled]="processing()" class="mt-3 w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{{ processing() ? status() : 'Confirmar pago simulado de ' + (total() | currency:'USD') }}</button>
                  </section>
                } @else {
                  <button type="submit" class="w-full rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800">Revisar reserva</button>
                }
              </form>
              <aside class="rounded-3xl bg-white p-6 shadow-sm">
                <a [attr.aria-disabled]="processing()" (click)="processing() && $event.preventDefault()" [routerLink]="['/actividades', item.id]" class="mb-4 inline-block text-sm font-semibold text-teal-800 underline">Cambiar fecha, horario o personas</a>
                <h2 class="text-xl font-bold">{{ item.name }}</h2>
                <p class="mt-1 text-sm text-slate-600">{{ item.city }}</p>
                <dl class="mt-4 space-y-2 text-sm">
                  <div class="flex justify-between"><dt>Fecha</dt><dd>{{ fecha() }}</dd></div>
                  <div class="flex justify-between"><dt>Hora</dt><dd>{{ hora() }}</dd></div>
                  <div class="flex justify-between"><dt>Adultos</dt><dd>{{ adultos() }}</dd></div>
                  <div class="flex justify-between"><dt>Niños</dt><dd>{{ ninos() }}</dd></div>
                  <div class="flex justify-between border-t pt-2 text-lg font-black"><dt>Total</dt><dd>{{ total() | currency:'USD' }}</dd></div>
                </dl>
              </aside>
            </div>
          }
        } @else {
          <p class="mt-6 text-slate-500" role="status">Cargando…</p>
        }
      </div>
    </main>
  `,
})
export class CheckoutPage {
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  protected readonly reviewing = signal(false);
  protected readonly uncertain = signal(false);
  private bookingSent = false;
  private attemptId = crypto.randomUUID();
  private readonly destroy = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly atracciones = inject(AtraccionesService);
  private readonly cart = inject(CartService);
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);
  protected readonly auth = inject(AuthService);

  protected readonly attraction = signal<Atraccion | null>(null);
  protected readonly loadError = signal('');
  protected readonly processing = signal(false);
  protected readonly status = signal('');
  protected readonly error = signal('');
  protected readonly result = signal<Reservation | null>(null);

  private readonly query = this.route.snapshot.queryParamMap;
  protected readonly fecha = signal(this.query.get('fecha') ?? '');
  protected readonly hora = signal(this.query.get('hora') ?? '');
  protected readonly adultos = signal(Number(this.query.get('adultos') ?? 1));
  protected readonly ninos = signal(Number(this.query.get('ninos') ?? 0));
  protected readonly total = computed(() => {
    const price = this.attraction()?.bookingPrice;
    return price ? price.adult * this.adultos() + price.child * this.ninos() : 0;
  });

  protected readonly documentType = signal<'cedula' | 'ruc'>('cedula');

  protected changeDocumentType(type: 'cedula' | 'ruc'): void {
    this.documentType.set(type);
    const control = this.form.controls.identificacion;
    control.setValidators([Validators.required, Validators.pattern(type === 'cedula' ? /^\d{10}$/ : /^\d{13}$/)]);
    control.reset();
  }

  protected formatInput(event: Event, field: 'identificacion' | 'number' | 'expiry' | 'cvv'): void {
    const input = event.target as HTMLInputElement;
    const limit = field === 'identificacion' ? (this.documentType() === 'cedula' ? 10 : 13) : field === 'number' ? 19 : 4;
    const digits = input.value.replace(/\D/g, '').slice(0, limit);
    const value = field === 'number' ? digits.replace(/(.{4})(?=.)/g, '$1 ')
      : field === 'expiry' && digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
    input.value = value;
    this.form.controls[field].setValue(value);
  }

  protected readonly form = new FormGroup({
    identificacion: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{10}$/)] }),
    telefono: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^(?=(?:\D*\d){7})\+?[0-9 ()-]{7,30}$/)] }),
    holder: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S(?:.*\S){2,}/), Validators.maxLength(120)] }),
    number: new FormControl('', { nonNullable: true, validators: [simulatedCardNumber] }),
    expiry: new FormControl('', { nonNullable: true, validators: [expiry] }),
    cvv: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{3,4}$/)] }),
  });

  ngOnInit(): void {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(this.fecha()) && /^\d{2}:\d{2}$/.test(this.hora())
      && Number.isInteger(this.adultos()) && Number.isInteger(this.ninos())
      && this.adultos() >= 1 && this.ninos() >= 0 && this.adultos() + this.ninos() <= 100
      && Number.isFinite(Date.parse(this.fecha())) && new Date(this.fecha()).toISOString().slice(0, 10) === this.fecha()
      && Date.parse(`${this.fecha()}T${this.hora()}:00-05:00`) > Date.now()
      && /^([01]\d|2[0-3]):[0-5]\d$/.test(this.hora());
    if (!valid) { this.loadError.set('Faltan datos de la reserva. Vuelve a la ficha y elige fecha, horario y personas.'); return; }
    this.atracciones.obtenerAtraccion(this.route.snapshot.paramMap.get('id') ?? '').pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: item => item.numericId
        ? this.attraction.set(item)
        : this.loadError.set('La atracción no admite reservas todavía.'),
      error: err => this.loadError.set(httpErrorMessage(err)),
    });
  }

  protected review(): void {
    if (this.processing() || this.uncertain()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.element.nativeElement.querySelector<HTMLElement>('input.ng-invalid')?.focus();
      return;
    }
    this.reviewing.set(true);
    this.error.set('');
  }

  protected pay(): void {
    const item = this.attraction();
    if (!item?.numericId || this.form.invalid || this.processing() || !this.reviewing() || this.uncertain()) return;
    if (Date.parse(`${this.fecha()}T${this.hora()}:00-05:00`) <= Date.now()) {
      this.error.set('Este horario ya comenzó. Vuelve a la ficha y selecciona otro turno.'); return;
    }
    const user = this.auth.user();
    if (!user?.id || !user.email || !user.name) {
      this.error.set('No se pudo cargar tu perfil para registrar la compra. Vuelve a iniciar sesión.');
      return;
    }
    this.form.disable({ emitEvent: false });
    this.processing.set(true);
    this.error.set('');
    this.status.set('Reservando cupo…');
    const draft = {
      attractionId: item.numericId,
      date: this.fecha(),
      timeSlot: this.hora(),
      slotId: slotIdOf(this.fecha(), this.hora()),
      adults: this.adultos(),
      children: this.ninos(),
    };
    this.atracciones.disponibilidad(item.id, this.fecha()).pipe(
      timeout(10000),
      switchMap(availability => {
        const slot = availability.horarios.find(s => s.hora.slice(0, 5) === this.hora());
        if (!slot || slot.available_spots < this.adultos() + this.ninos())
          return throwError(() => new Error('El turno ya no tiene cupos suficientes. Cambia el horario antes de pagar.'));
        return this.http.post(`${this.apiUrl}/clients/web/register`, {
      nombre: user.name,
      email: user.email,
      identificacion: this.form.controls.identificacion.value.trim(),
      telefono: this.form.controls.telefono.value.trim(),
    });
      }),
      switchMap(() => { this.bookingSent = true; return this.cart.reserve(draft, this.attemptId); }),
      takeUntilDestroyed(this.destroy),
    ).subscribe({
      next: created => {
        this.status.set('Procesando pago…');
        let settled = false;
        this.cart.waitForResult(created.reservationId).pipe(takeUntilDestroyed(this.destroy)).subscribe({
          next: reservation => {
            settled = true;
            this.processing.set(false); this.form.enable({ emitEvent: false });
            if (reservation.state === 'CONFIRMED') { this.result.set(reservation); this.form.reset(); }
            else {
              this.bookingSent = false;
              this.attemptId = crypto.randomUUID();
              this.error.set('No se pudo completar la reserva: el pago fue rechazado o el cupo ya no está disponible. Revisa Mis reservas antes de intentarlo de nuevo.');
            }
          },
          error: err => { this.uncertain.set(true); this.processing.set(false); this.form.enable({ emitEvent: false }); this.error.set(httpErrorMessage(err)); },
          complete: () => {
            if (!settled) {
              this.uncertain.set(true);
              this.processing.set(false); this.form.enable({ emitEvent: false });
              this.error.set('El pago sigue en proceso. Revisa "Mis reservas" en unos instantes.');
            }
          },
        });
      },
      error: err => { this.uncertain.set(this.bookingSent); this.processing.set(false); this.form.enable({ emitEvent: false }); this.error.set(httpErrorMessage(err)); },
    });
  }
}
