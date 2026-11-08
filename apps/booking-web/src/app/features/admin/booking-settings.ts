import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Atraccion, BookingProfile } from '../../contracts/atracciones.contracts';
import { httpErrorMessage } from '../../core/http-errors';
import { AtraccionesService } from '../../services/atracciones.service';
import { ToastService } from '../../services/toast.service';
import { AdminApiService } from './admin-api.service';

const DEFAULT_RATINGS: Record<string, number> = { limpieza: 0, servicio: 0, calidad_precio: 0, puntualidad: 0 };

interface ItineraryStop { time: string; title: string; duration_minutes: number; }

@Component({
  selector: 'app-booking-settings',
  imports: [ReactiveFormsModule],
  templateUrl: './booking-settings.html',
})
export class BookingSettings {
  readonly attraction = input.required<Atraccion>();
  private readonly api = inject(AtraccionesService);
  private readonly admin = inject(AdminApiService);
  private readonly destroy = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly isPublished = signal(false);
  readonly profileSaved = signal(false);
  readonly allowProfileSave = signal(true);
  readonly stops = signal<ItineraryStop[]>([]);
  readonly profileSavedEvent = output<void>();
  readonly publishedEvent = output<void>();
  private ratings: Record<string, number> = { ...DEFAULT_RATINGS };
  readonly form = new FormGroup({
    city: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    currency: new FormControl('USD', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^[A-Z]{3}$/)] }),
    adult: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    child: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    senior: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    infant: new FormControl(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    student: new FormControl<number | null>(null, [Validators.min(0)]),
    includes_food: new FormControl(false, { nonNullable: true }),
    includes_transport: new FormControl(false, { nonNullable: true }),
    includes_guide: new FormControl(false, { nonNullable: true }),
    wheelchair_accessible: new FormControl(false, { nonNullable: true }),
    service_animals_allowed: new FormControl(false, { nonNullable: true }),
    permite_paquete: new FormControl(false, { nonNullable: true }),
    schedule_times: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    effect(() => this.load(this.attraction()));
  }

  private load(attraction: Atraccion): void {
    this.error.set('');
    this.message.set('');
    this.isPublished.set(attraction.status === 'PUBLICADA');
    this.profileSaved.set(!!(attraction.bookingProfile || attraction.bookingPrice));
    this.allowProfileSave.set(attraction.status !== 'PUBLICADA');
    this.patchFromAttraction(attraction);
    if (!this.form.controls.city.value && attraction.city_id !== undefined) {
      this.admin.cities().pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: cities => {
          const city = cities.find(item => item.id === Number(attraction.city_id));
          if (city && !this.form.controls.city.value) this.form.controls.city.setValue(city.name);
        },
        error: () => undefined,
      });
    }
    this.loading.set(true);
    this.api.obtenerAtraccion(attraction.id).pipe(
      takeUntilDestroyed(this.destroy),
    ).subscribe({
      next: detail => {
        this.patchFromAttraction(detail);
        this.isPublished.set(true);
        this.allowProfileSave.set(detail.bookingProfile?.schedule_times !== undefined);
        this.loading.set(false);
      },
      error: error => {
        this.loading.set(false);
        if (error instanceof HttpErrorResponse && error.status === 404) return;
        this.error.set(this.admin.errorMessage(error));
      },
    });
  }

  private patchFromAttraction(attraction: Atraccion): void {
    const profile = attraction.bookingProfile;
    this.form.patchValue({
      city: profile?.city ?? attraction.city ?? '',
      currency: profile?.price.currency ?? attraction.bookingPrice?.currency ?? 'USD',
      adult: profile?.price.adult ?? attraction.bookingPrice?.adult ?? 0,
      child: profile?.price.child ?? attraction.bookingPrice?.child ?? 0,
      senior: profile?.price.senior ?? attraction.bookingPrice?.senior ?? 0,
      infant: profile?.price.infant ?? attraction.bookingPrice?.infant ?? 0,
      student: profile?.price.student ?? attraction.bookingPrice?.student ?? null,
      includes_food: profile?.inclusions.includes_food ?? attraction.bookingInclusions?.includes_food ?? false,
      includes_transport: profile?.inclusions.includes_transport ?? attraction.bookingInclusions?.includes_transport ?? false,
      includes_guide: profile?.inclusions.includes_guide ?? attraction.bookingInclusions?.includes_guide ?? false,
      wheelchair_accessible: profile?.accessibility?.wheelchair_accessible ?? attraction.accessibility?.wheelchair_accessible ?? false,
      service_animals_allowed: profile?.accessibility?.service_animals_allowed ?? attraction.accessibility?.service_animals_allowed ?? false,
      permite_paquete: profile?.permite_paquete ?? attraction.bookingEnabled ?? false,
      schedule_times: (profile?.schedule_times ?? []).map(time => time.slice(0, 5)).join('\n'),
    });
    this.ratings = { ...DEFAULT_RATINGS, ...(profile?.ratings_breakdown ?? attraction.ratingsBreakdown ?? {}) };
    this.stops.set((profile?.itinerary ?? attraction.itinerary ?? []).map(stop => ({
      time: stop.time.slice(0, 5), title: stop.title, duration_minutes: stop.duration_minutes,
    })));
  }

  addStop(): void {
    const last = this.stops().at(-1);
    this.stops.update(list => [...list, { time: last?.time ?? '09:00', title: '', duration_minutes: 30 }]);
  }

  updateStop(index: number, field: keyof ItineraryStop, value: string): void {
    this.stops.update(list => list.map((stop, i) => i === index
      ? { ...stop, [field]: field === 'duration_minutes' ? Number(value) : value }
      : stop));
  }

  removeStop(index: number): void {
    this.stops.update(list => list.filter((_, i) => i !== index));
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.busy() || this.loading() || !this.allowProfileSave()) return;
    if (this.form.invalid) {
      this.error.set('Revisa ciudad, moneda y tarifas; los valores numéricos no pueden ser negativos.');
      this.toast.mostrar('error', this.error());
      return;
    }

    const value = this.form.getRawValue();
    const itinerary: BookingProfile['itinerary'] = this.stops().map((stop, index) => ({
      stop_number: index + 1,
      time: stop.time.slice(0, 5),
      title: stop.title.trim(),
      duration_minutes: Number(stop.duration_minutes),
    }));
    if (itinerary.some(stop =>
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(stop.time) || !stop.title
      || !Number.isInteger(stop.duration_minutes) || stop.duration_minutes < 1,
    )) {
      this.error.set('Cada parada del itinerario requiere hora, título y duración en minutos (entero mayor a 0).');
      return;
    }
    const ratingsBreakdown = this.ratings;
    const times = value.schedule_times.split(/\r?\n/).map(time => time.trim()).filter(Boolean);
    if (times.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
      this.error.set('Los horarios deben usar formato HH:MM, uno por línea.');
      return;
    }

    const profile: BookingProfile = {
      city: value.city.trim(),
      price: {
        currency: value.currency,
        adult: value.adult,
        child: value.child,
        senior: value.senior,
        infant: value.infant,
        ...(value.student === null ? {} : { student: value.student }),
      },
      inclusions: {
        includes_food: value.includes_food,
        includes_transport: value.includes_transport,
        includes_guide: value.includes_guide,
      },
      itinerary,
      ratings_breakdown: ratingsBreakdown,
      accessibility: {
        wheelchair_accessible: value.wheelchair_accessible,
        service_animals_allowed: value.service_animals_allowed,
      },
      permite_paquete: value.permite_paquete,
      schedule_times: times.map(time => `${time}:00`),
    };

    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    this.api.guardarPerfilBooking(this.attraction().id, profile).pipe(
      takeUntilDestroyed(this.destroy),
    ).subscribe({
      next: () => {
        this.busy.set(false);
        this.profileSaved.set(true);
        this.profileSavedEvent.emit();
        this.message.set('Perfil Booking guardado. La búsqueda por fecha usa estos horarios junto con el aforo recibido desde Inventory.');
      },
      error: error => {
        this.busy.set(false);
        this.error.set(this.admin.errorMessage(error));
        this.toast.mostrar('error', this.error());
      },
    });
  }

  publish(): void {
    if (this.busy() || !this.profileSaved() || this.isPublished()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.actualizarEstado(this.attraction().id, 'PUBLICADA').pipe(
      takeUntilDestroyed(this.destroy),
    ).subscribe({
      next: () => {
        this.busy.set(false);
        this.isPublished.set(true);
        this.publishedEvent.emit();
        this.message.set('Atracción publicada. Ya puede aparecer en las búsquedas públicas cuando tenga aforo disponible.');
        this.toast.mostrar('exito', 'Atracción publicada.');
      },
      error: error => {
        this.busy.set(false);
        this.error.set(this.admin.errorMessage(error));
        this.toast.mostrar('error', this.error());
      },
    });
  }
}

