import { Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Atraccion } from '../../contracts/atracciones.contracts';
import { AtraccionFoto, AtraccionesService } from '../../services/atracciones.service';
import { AdminApiService } from './admin-api.service';

const HTTP_URL = /^https?:\/\/\S+$/i;

@Component({
  selector: 'app-attraction-photos',
  imports: [ReactiveFormsModule],
  template: `
    <section class="my-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm" aria-label="Fotos de la atracción">
      <h3 class="text-xl font-bold">Fotos</h3>
      <p class="mt-1 text-sm text-slate-600">Pega la URL pública de cada imagen (https://...). La primera foto es la portada.</p>
      @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{{ error() }}</p> }
      <form [formGroup]="form" (ngSubmit)="add()" class="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
        <label><span class="mb-1 block text-sm font-semibold">URL de la imagen *</span><input type="url" formControlName="url" maxlength="500" placeholder="https://..." class="w-full rounded-xl border border-stone-300 p-3"></label>
        <label><span class="mb-1 block text-sm font-semibold">Descripción (alt) *</span><input formControlName="alt" maxlength="200" placeholder="Ej. Vista del volcán" class="w-full rounded-xl border border-stone-300 p-3"></label>
        <button type="submit" [disabled]="busy()" class="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{{ busy() ? 'Agregando...' : 'Agregar foto' }}</button>
      </form>
      @if (photos().length) {
        <ul class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          @for (photo of photos(); track photo.id) {
            <li class="overflow-hidden rounded-xl border border-stone-200">
              <img [src]="photo.url" [alt]="photo.alt || 'Foto de la atracción'" class="h-32 w-full object-cover" loading="lazy">
              <div class="flex items-center justify-between gap-2 p-2 text-xs"><span class="truncate">{{ photo.alt }}</span><button type="button" (click)="remove(photo)" [disabled]="busy()" class="text-red-700">Quitar</button></div>
            </li>
          }
        </ul>
      } @else {
        <p class="mt-4 text-sm text-slate-500">Aún no hay fotos. Agrega al menos una para que la atracción luzca bien al publicarla.</p>
      }
    </section>
  `,
})
export class AttractionPhotos {
  readonly attraction = input.required<Atraccion>();
  readonly countChange = output<number>();
  private readonly api = inject(AtraccionesService);
  private readonly admin = inject(AdminApiService);
  private readonly destroy = inject(DestroyRef);
  readonly photos = signal<AtraccionFoto[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(500), Validators.pattern(HTTP_URL)] }),
    alt: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
  });

  constructor() {
    effect(() => {
      const list = (this.attraction().photos as Partial<AtraccionFoto>[]).filter(photo => photo.id && photo.url) as AtraccionFoto[];
      this.photos.set(list);
      this.countChange.emit(list.length);
    });
  }

  add(): void {
    this.form.markAllAsTouched();
    if (this.busy()) return;
    if (this.form.invalid) {
      this.error.set('Ingresa una URL http/https válida (máx. 500 caracteres) y una descripción.');
      return;
    }
    const value = this.form.getRawValue();
    this.busy.set(true);
    this.error.set('');
    this.api.agregarFoto(this.attraction().id, { url: value.url.trim(), alt: value.alt.trim(), order: this.photos().length }).pipe(
      takeUntilDestroyed(this.destroy),
    ).subscribe({
      next: photo => {
        this.busy.set(false);
        this.photos.update(list => [...list, photo]);
        this.countChange.emit(this.photos().length);
        this.form.reset({ url: '', alt: '' });
      },
      error: error => { this.busy.set(false); this.error.set(this.admin.errorMessage(error)); },
    });
  }

  remove(photo: AtraccionFoto): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.eliminarFoto(this.attraction().id, photo.id).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => {
        this.busy.set(false);
        this.photos.update(list => list.filter(item => item.id !== photo.id));
        this.countChange.emit(this.photos().length);
      },
      error: error => { this.busy.set(false); this.error.set(this.admin.errorMessage(error)); },
    });
  }
}
