import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { CheckoutPage } from './checkout-page';
import { AtraccionesService } from '../../services/atracciones.service';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { API_URL } from '../../core/api.config';

describe('Checkout error prevention', () => {
  let catalog: { obtenerAtraccion: ReturnType<typeof vi.fn>; disponibilidad: ReturnType<typeof vi.fn> };
  let cart: { reserve: ReturnType<typeof vi.fn>; waitForResult: ReturnType<typeof vi.fn> };
  const params = { fecha: '2099-01-01', hora: '10:00', adultos: '2', ninos: '0' };
  beforeEach(() => {
    catalog = { obtenerAtraccion: vi.fn(() => of({ id: 'public-id', numericId: '1', name: 'Tour', bookingPrice: { adult: 10, child: 5 } })),
      disponibilidad: vi.fn(() => of({ horarios: [{ hora: '10:00', available_spots: 4 }] })) };
    cart = { reserve: vi.fn(() => of({ reservationId: 'r' })), waitForResult: vi.fn(() => new Subject()) };
    TestBed.configureTestingModule({ imports: [CheckoutPage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: API_URL, useValue: '/api' },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params), paramMap: convertToParamMap({ id: 'public-id' }) } } },
      { provide: AtraccionesService, useValue: catalog }, { provide: CartService, useValue: cart },
      { provide: AuthService, useValue: { authenticated: signal(true), user: signal({ id: 'u', name: 'Ana', email: 'ana@example.com' }) } },
    ] });
  });
  afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
  function setup() {
    const fixture = TestBed.createComponent(CheckoutPage); fixture.detectChanges();
    return { fixture, page: fixture.componentInstance };
  }
  function valid(page: CheckoutPage) {
    page['form'].setValue({ identificacion: '1710034065', telefono: '0991234567', holder: 'Ana Perez', number: '4242424242424242', expiry: '12/99', cvv: '123' });
  }
  it('accepts a simulated card and enforces document input limits', () => {
    const { fixture, page } = setup();
    valid(page);
    page['form'].controls.number.setValue('4522 1223 9166 9024');
    expect(page['form'].valid).toBe(true);
    const input = fixture.nativeElement.querySelector('[formControlName="identificacion"]') as HTMLInputElement;
    input.value = '12345678901abc'; input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('1234567890');
    expect(page['form'].controls.identificacion.value).toBe('1234567890');
    page['changeDocumentType']('ruc');
    page['form'].controls.identificacion.setValue('1234567890');
    expect(page['form'].controls.identificacion.invalid).toBe(true);
    page['form'].controls.identificacion.setValue('1234567890001');
    expect(page['form'].controls.identificacion.valid).toBe(true);
  });
  it('requires a valid phone number before checkout', () => {
    const { page } = setup();
    valid(page);
    page['form'].controls.telefono.setValue('');
    page['review']();
    expect(page['form'].controls.telefono.invalid).toBe(true);
    expect(page['reviewing']()).toBe(false);
  });
  it('shows field errors, focuses the first invalid input and never sends invalid data', () => {
    const { fixture, page } = setup(); page['review'](); fixture.detectChanges();
    expect(page['reviewing']()).toBe(false);
    expect(page['form'].controls.holder.touched).toBe(true);
    expect(fixture.nativeElement.querySelector('[aria-invalid=true]')).not.toBeNull();
    expect(cart.reserve).not.toHaveBeenCalled();
    expect(catalog.disponibilidad).not.toHaveBeenCalled();
  });
  it('requires review before payment and blocks requests if live stock is insufficient', () => {
    const { fixture, page } = setup(); valid(page); page['pay']();
    expect(catalog.disponibilidad).not.toHaveBeenCalled();
    page['review'](); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Revisa antes de confirmar');
    catalog.disponibilidad.mockReturnValue(of({ horarios: [{ hora: '10:00', available_spots: 1 }] }));
    page['pay']();
    expect(page['error']()).toContain('cupos suficientes');
    expect(cart.reserve).not.toHaveBeenCalled();
    TestBed.inject(HttpTestingController).expectNone('/api/clients/web/register');
  });
  it('prevents duplicate submissions and disables retries after an uncertain result', () => {
    const { page } = setup(); valid(page); page['review'](); page['pay'](); page['pay']();
    expect(catalog.disponibilidad).toHaveBeenCalledTimes(1);
    cart.waitForResult.mockReturnValue(throwError(() => new Error('offline')));
    const registration = TestBed.inject(HttpTestingController).expectOne('/api/clients/web/register');
    expect(registration.request.body).toMatchObject({ identificacion: '1710034065', telefono: '0991234567' });
    registration.flush({});
    expect(page['uncertain']()).toBe(true);
    page['pay']();
    expect(cart.reserve).toHaveBeenCalledTimes(1);
  });
  it('rejects a past turn even when accessed through a manually edited URL', () => {
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { queryParamMap: convertToParamMap({ ...params, fecha: '2000-01-01' }), paramMap: convertToParamMap({ id: 'public-id' }) } } });
    const { page } = setup();
    expect(page['loadError']()).toBeTruthy();
    expect(catalog.obtenerAtraccion).not.toHaveBeenCalled();
  });
  it('rejects a whitespace-only cardholder', () => {
    const { page } = setup(); valid(page); page['form'].controls.holder.setValue('   ');
    page['review'](); expect(page['reviewing']()).toBe(false);
  });
});
