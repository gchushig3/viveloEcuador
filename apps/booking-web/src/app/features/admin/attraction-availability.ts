import { Component, DestroyRef, computed, inject, input, signal, untracked, effect } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminSlot } from '../../contracts/admin.contracts';
import { Atraccion } from '../../contracts/atracciones.contracts';
import { AdminApiService } from './admin-api.service';

const DAY_MS = 86_400_000;

function localDate(offsetDays = 0): string {
  const now = new Date();
  const base = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(base + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

@Component({
  selector: 'app-attraction-availability',
  imports: [ReactiveFormsModule],
  templateUrl: './attraction-availability.html',
})
export class AttractionAvailability {
  readonly attraction = input.required<Atraccion>();
  private readonly admin = inject(AdminApiService);
  private readonly destroy = inject(DestroyRef);
  readonly today = localDate();
  readonly weekdayOptions = [
    { value: 1, label: 'Lun' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mié' },
    { value: 4, label: 'Jue' }, { value: 5, label: 'Vie' }, { value: 6, label: 'Sáb' }, { value: 0, label: 'Dom' },
  ];
  readonly slots = signal<AdminSlot[]>([]);
  readonly totals = computed(() => this.slots().reduce((sum, slot) => ({
    available: sum.available + slot.available, reserved: sum.reserved + slot.reserved,
    soldOut: sum.soldOut + Number(slot.available === 0),
  }), { available: 0, reserved: 0, soldOut: 0 }));
  readonly scheduleTimes = signal<string[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly weekdays = signal<number[]>([0, 1, 2, 3, 4, 5, 6]);
  readonly filter = new FormGroup({
    from: new FormControl(localDate(), { nonNullable: true }),
    to: new FormControl(localDate(29), { nonNullable: true }),
  });
  readonly create = new FormGroup({
    from: new FormControl(localDate(), { nonNullable: true, validators: [Validators.required] }),
    to: new FormControl(localDate(29), { nonNullable: true, validators: [Validators.required] }),
    times: new FormControl('09:00', { nonNullable: true, validators: [Validators.required] }),
    capacity: new FormControl(20, { nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(100000)] }),
  });

  constructor() {
    effect(() => {
      this.attraction();
      untracked(() => this.load());
    });
  }

  load() {
    const { from, to } = this.filter.getRawValue();
    if (!from || !to || to < from) { this.error.set('Indica un rango de fechas válido.'); return; }
    this.loading.set(true);
    this.error.set('');
    this.admin.availability(this.attraction().id, from, to).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (response) => {
        this.slots.set(response.slots);
        this.scheduleTimes.set(response.schedule_times);
        if (response.schedule_times.length && this.create.controls.times.value === '09:00' && !this.slots().length)
          this.create.controls.times.setValue(response.schedule_times.join('\n'));
        this.loading.set(false);
      },
      error: (err) => { this.error.set(this.admin.errorMessage(err)); this.loading.set(false); },
    });
  }

  private cap(from: string, to: string): string {
    const limit = new Date(Date.parse(`${from}T00:00:00Z`) + 90 * DAY_MS).toISOString().slice(0, 10);
    return to > limit ? limit : to;
  }

  toggleDay(day: number) {
    this.weekdays.update(days => days.includes(day) ? days.filter(d => d !== day) : [...days, day]);
  }

  submit() {
    if (this.busy()) return;
    this.message.set('');
    this.error.set('');
    const value = this.create.getRawValue();
    const times = [...new Set(value.times.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean))];
    if (this.create.invalid || value.to < value.from) { this.create.markAllAsTouched(); this.error.set('Revisa las fechas y la capacidad.'); return; }
    if (value.from < this.today) { this.error.set('No se pueden crear cupos en fechas pasadas.'); return; }
    if (!times.length || times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) { this.error.set('Los horarios deben usar formato HH:MM, uno por línea.'); return; }
    if (!this.weekdays().length) { this.error.set('Selecciona al menos un día de la semana.'); return; }
    this.busy.set(true);
    this.admin.createSlots(this.attraction().id, { from: value.from, to: value.to, weekdays: this.weekdays(), times, capacity: value.capacity }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.message.set(`Cupos creados: ${result.created}${result.skipped ? ` · ya existían: ${result.skipped}` : ''}.`);
        this.filter.setValue({ from: value.from, to: this.cap(value.from, value.to) });
        this.load();
      },
      error: (err) => { this.busy.set(false); this.error.set(this.admin.errorMessage(err)); },
    });
  }

  save(slot: AdminSlot, capacityText: string, closed: boolean) {
    if (this.busy()) return;
    const capacity = Number(capacityText);
    if (!Number.isInteger(capacity) || capacity < Math.max(1, slot.reserved) || capacity > 100000) { this.error.set(`La capacidad debe ser un entero entre ${Math.max(1, slot.reserved)} y 100000; debe respetar los cupos reservados.`); return; }
    this.message.set('');
    this.error.set('');
    this.busy.set(true);
    this.admin.updateSlot(this.attraction().id, { date: slot.date, time: slot.timeSlot, capacity, closed }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.slots.update(list => list.map(item => item.slotId === updated.slotId && item.date === updated.date ? updated : item));
        this.message.set(`Cupo actualizado: ${updated.date} ${updated.timeSlot}.`);
      },
      error: (err) => { this.busy.set(false); this.error.set(this.admin.errorMessage(err)); },
    });
  }

  statusLabel(slot: AdminSlot): string {
    if (slot.closed) return 'Cerrado';
    return slot.status === 'AGOTADO' ? 'Agotado' : slot.status === 'ULTIMOS_CUPOS' ? 'Últimos cupos' : 'Disponible';
  }
}
