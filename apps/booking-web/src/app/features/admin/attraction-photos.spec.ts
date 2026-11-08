import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { API_URL, CATALOG_API_URL } from '../../core/api.config';
import { attraction } from '../../testing/booking.fixtures';
import { AttractionPhotos } from './attraction-photos';

describe('Attraction photos', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [AttractionPhotos],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: API_URL, useValue: '/api/v1' },
        { provide: CATALOG_API_URL, useValue: '/api/v2' },
      ],
    });
    const fixture = TestBed.createComponent(AttractionPhotos);
    fixture.componentRef.setInput('attraction', { ...attraction, photos: [] });
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, http: TestBed.inject(HttpTestingController) };
  }

  it('rejects non-http URLs without calling the API', () => {
    const { component, http } = setup();
    component.form.setValue({ url: 'javascript:alert(1)', alt: 'x' });
    component.add();
    expect(component.error()).toContain('URL');
    http.expectNone(() => true);
  });

  it('adds and removes a photo through the photos endpoints', () => {
    const { component, http } = setup();
    component.form.setValue({ url: 'https://img.test/a.jpg', alt: 'Volcán' });
    component.add();
    const post = http.expectOne('/api/v2/atracciones/' + attraction.id + '/fotos');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ url: 'https://img.test/a.jpg', alt: 'Volcán', order: 0 });
    post.flush({ id: 'f1', url: 'https://img.test/a.jpg', alt: 'Volcán', order: 0 });
    expect(component.photos().length).toBe(1);
    component.remove(component.photos()[0]);
    const del = http.expectOne('/api/v2/atracciones/' + attraction.id + '/fotos/f1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    expect(component.photos().length).toBe(0);
  });
});
