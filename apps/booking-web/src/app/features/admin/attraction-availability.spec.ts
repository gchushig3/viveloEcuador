import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_URL, CATALOG_API_URL, IDENTITY_API_URL } from '../../core/api.config';
import { AttractionAvailability } from './attraction-availability';

describe('AttractionAvailability', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<AttractionAvailability>;
  let component: AttractionAvailability;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [AttractionAvailability],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: API_URL, useValue: '/api/v1' },
        { provide: CATALOG_API_URL, useValue: '/api/v2' },
        { provide: IDENTITY_API_URL, useValue: '/identity' },
      ],
    });
    fixture = TestBed.createComponent(AttractionAvailability);
    fixture.componentRef.setInput('attraction', { id: 'abc', name: 'Tour' });
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    component = fixture.componentInstance;
    http.expectOne(req => req.url === '/api/v2/atracciones/admin/abc/cupos' && req.method === 'GET').flush({
      attraction: { id: 'abc', name: 'Tour' }, from: '2030-01-01', to: '2030-01-30', schedule_times: ['10:00'],
      slots: [{ slotId: 'slot-20300101-1000', date: '2030-01-01', timeSlot: '10:00', total: 10, reserved: 2, available: 8, closed: false, status: 'DISPONIBLE' }],
    });
    fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); http.verify(); vi.useRealTimers(); });

  it('updates stock automatically after an external purchase and stops on destruction', () => {
    vi.advanceTimersByTime(3000);
    http.expectOne(req => req.method === 'GET').flush({ schedule_times: ['10:00'], slots: [
      { ...component.slots()[0], reserved: 5, available: 5 },
    ] });
    fixture.detectChanges();
    expect(component.totals()).toEqual({ available: 5, reserved: 5, soldOut: 0 });
    expect(fixture.nativeElement.textContent).toContain('Última consulta de stock:');
    fixture.destroy();
    vi.advanceTimersByTime(6000);
    http.expectNone(req => req.method === 'GET');
  });

  it('keeps the last stock on failure and recovers on the next refresh', () => {
    vi.advanceTimersByTime(3000);
    http.expectOne(req => req.method === 'GET').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(component.totals().available).toBe(8);
    expect(component.syncError()).toContain('desactualizados');
    vi.advanceTimersByTime(3000);
    http.expectOne(req => req.method === 'GET').flush({ schedule_times: [], slots: [] });
    expect(component.syncError()).toBe('');
    expect(component.slots()).toEqual([]);
  });

  it('avoids overlapping refreshes and retries after a request times out', () => {
    vi.advanceTimersByTime(3000);
    const stuck = http.expectOne(req => req.method === 'GET');
    vi.advanceTimersByTime(9000);
    http.expectNone(req => req.method === 'GET');
    vi.advanceTimersByTime(1000);
    expect(stuck.cancelled).toBe(true);
    expect(component.loading()).toBe(false);
    vi.advanceTimersByTime(2000);
    http.expectOne(req => req.method === 'GET').flush({ schedule_times: [], slots: [] });
  });

  it('lists registered slots', () => {
    expect(component.slots().length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('2030-01-01');
  });

  it('requires an explicit capacity instead of creating slots with a default', () => {
    expect(component.create.controls.capacity.value).toBeNull();
    component.submit();
    expect(component.error()).toContain('capacidad');
    http.expectNone(req => req.method === 'POST');
  });

  it('creates slots with the real capacity of five', () => {
    component.create.setValue({ from: '2999-01-01', to: '2999-01-01', times: '09:00\n13:00\n16:00', capacity: 5 });
    component.submit();
    const request = http.expectOne(req => req.method === 'POST');
    expect(request.request.body.capacity).toBe(5);
    expect(request.request.body.times).toEqual(['09:00', '13:00', '16:00']);
    request.flush({ created: 3, skipped: 0 });
    http.expectOne(req => req.method === 'GET').flush({ schedule_times: [], slots: [] });
  });

  it('creates slots for a range, times and weekdays', () => {
    component.create.setValue({ from: '2999-01-01', to: '2999-01-07', times: '09:00\n14:30', capacity: 15 });
    component.toggleDay(0);
    component.submit();
    const request = http.expectOne('/api/v2/atracciones/admin/abc/cupos');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ from: '2999-01-01', to: '2999-01-07', weekdays: [1, 2, 3, 4, 5, 6], times: ['09:00', '14:30'], capacity: 15 });
    request.flush({ created: 12, skipped: 0, dates: 6, times: 2 });
    http.expectOne(req => req.method === 'GET').flush({ attraction: { id: 'abc', name: 'Tour' }, from: '', to: '', schedule_times: [], slots: [] });
    expect(component.message()).toContain('12');
  });

  it('rejects invalid times without calling the API', () => {
    component.create.controls.capacity.setValue(5);
    component.create.controls.times.setValue('25:99');
    component.submit();
    expect(component.error()).toContain('HH:MM');
    http.expectNone(req => req.method === 'POST');
  });

  it('closes a slot keeping its capacity', () => {
    component.save(component.slots()[0], '10', true);
    const request = http.expectOne(req => req.method === 'PATCH');
    expect(request.request.body).toEqual({ date: '2030-01-01', time: '10:00', capacity: 10, closed: true });
    request.flush({ slotId: 'slot-20300101-1000', date: '2030-01-01', timeSlot: '10:00', total: 10, reserved: 2, available: 0, closed: true, status: 'AGOTADO' });
    expect(component.slots()[0].closed).toBe(true);
  });
});
