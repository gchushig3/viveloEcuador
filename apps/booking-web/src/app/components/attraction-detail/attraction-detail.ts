import { photosOf } from '../../contracts/attraction-view';
import { httpErrorMessage } from '../../core/http-errors';
import { CurrencyPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, exhaustMap, map, of, switchMap, tap, timeout, timer } from 'rxjs';
import { Atraccion, AtraccionesService } from '../../services/atracciones.service';
import { ObservabilityService } from '../../services/observability.service';

@Component({
  selector: 'app-attraction-detail',
  standalone: true,
  imports: [RouterLink, CurrencyPipe],
  templateUrl: './attraction-detail.html',
})
export class AttractionDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(AtraccionesService);
  private readonly observability = inject(ObservabilityService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly attraction = signal<Atraccion | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly error = signal('');
  protected readonly images = computed(() => this.attraction()
    ? photosOf(this.attraction()!).map(photo => photo.url) : []);
  private readonly router = inject(Router);
  private readonly now = signal(Date.now());
  protected readonly dateError = computed(() => !this.date() || this.date() < this.minDate || this.date() > this.maxDate
    ? 'Elige una fecha entre hoy y los próximos 60 días.' : '');
  protected readonly slots = signal<{ hora: string; available_spots: number; status: string }[]>([]);
  private readonly verifiedDate = signal('');
  protected readonly stockError = signal('');
  protected readonly canReserve = computed(() => this.verifiedDate() === this.date() && !this.dateError() && !this.stockError() && this.slots().some(slot =>
    slot.hora === this.time() && this.futureTurn(slot.hora) && slot.available_spots >= this.adults() + this.children()));
  protected readonly minDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
  protected readonly maxDate = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  protected readonly date = signal(this.minDate);
  protected readonly time = signal('10:00');
  protected readonly adults = signal(2);
  protected readonly children = signal(0);
  private readonly stockChanges = combineLatest([toObservable(this.attraction), toObservable(this.date)]);

  protected readonly total = computed(() => {
    const price = this.attraction()?.bookingPrice;
    return price ? price.adult * this.adults() + price.child * this.children() : 0;
  });

  protected futureTurn(time: string): boolean {
    return Date.parse(`${this.date()}T${time.slice(0, 5)}:00-05:00`) > this.now();
  }

  protected change(kind: 'adults' | 'children', delta: number): void {
    const target = kind === 'adults' ? this.adults : this.children;
    const min = kind === 'adults' ? 1 : 0;
    target.set(Math.min(20, Math.max(min, target() + delta)));
  }

  protected reserve(item: Atraccion): void {
    const date = this.date();
    if (!this.canReserve() || !date || date < this.minDate || date > this.maxDate) return;
    this.router.navigate(['/reservar', item.id], {
      queryParams: { fecha: date, hora: this.time(), adultos: this.adults(), ninos: this.children() },
    });
  }

  ngOnInit(): void {
    timer(0, 1000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.now.set(Date.now()));
    this.stockChanges.pipe(
      switchMap(([item, date]) => {
        this.slots.set([]);
        if (!item || !date || date < this.minDate || date > this.maxDate) return of(null);
        return timer(0, 3500).pipe(exhaustMap(() => this.service.disponibilidad(item.id, date).pipe(
          timeout(10000), catchError(() => of(null)),
        )));
      }), takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      this.stockError.set(result ? '' : 'No se pudo verificar la disponibilidad. Reintentando automáticamente.');
      if (result) this.verifiedDate.set(this.date());
      if (result && JSON.stringify(this.slots()) !== JSON.stringify(result.horarios)) this.slots.set(result.horarios);
    });
    this.route.paramMap.pipe(
      tap(() => {
        this.loading.set(true);
        this.error.set('');
        this.notFound.set(false);
        this.attraction.set(null);
      }),
      switchMap(params => this.service.obtenerAtraccion(params.get('id') ?? '').pipe(
        map(attraction => ({ attraction, error: '' })),
        catchError(error => of({
          attraction: null,
          error: httpErrorMessage(error),
          notFound: error instanceof HttpErrorResponse && error.status === 404,
        })),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(response => {
      this.loading.set(false);
      this.attraction.set(response.attraction);
      this.error.set(response.error);
      this.notFound.set('notFound' in response ? response.notFound ?? false : false);
      if (response.attraction) {
        this.observability.trackEvent('VIEW_ATTRACTION', {
          attractionId: response.attraction.id,
          attractionName: response.attraction.name,
        });
      }
    });
  }

  protected nameOf(item: Atraccion): string { return item.name; }
  protected cityOf(item: Atraccion): string { return item.city ?? item.provincia ?? 'Ecuador'; }
  protected categoryOf(item: Atraccion): string { return item.type ?? item.categoria; }
  protected includesOf(item: Atraccion): string[] { return item.includes; }
  protected imageOf(item: Atraccion, index: number): string {
    return this.images()[index] ?? '';
  }
}
