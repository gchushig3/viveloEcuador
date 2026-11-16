import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { EMPTY, Observable, expand, forkJoin, map, of, reduce } from 'rxjs';
import { CART_API_URL, CATALOG_API_URL, IDENTITY_ADMIN_API_URL } from '../../core/api.config';
import { httpErrorMessage } from '../../core/http-errors';
import {
  AdminCheckinResult,
  AdminClient,
  AdminReservation,
  AdminClientDetail,
  AdminClientsPage,
  AdminReservationFilters,
  AdminCity,
  AdminOperator,
  AdminAvailability,
  AdminSlot,
  AdminSlotBatch,
  AdminReservationsPage,
  AdminRole,
  AdminSummary,
  AdminUser,
  AdminUsersPage,
} from '../../contracts/admin.contracts';
import { AuthService } from '../../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly catalog = `${inject(CATALOG_API_URL)}/atracciones/admin`;
  private readonly identity = inject(IDENTITY_ADMIN_API_URL);
  private readonly cart = inject(CART_API_URL);
  private readonly catalogRoot = inject(CATALOG_API_URL);

  cities(): Observable<AdminCity[]> {
    return this.http.get<AdminCity[]>(`${this.catalog}/ciudades`);
  }

  activeOperators(): Observable<{ items: AdminOperator[] }> {
    return this.http.get<{ items: AdminOperator[] }>(`${this.catalogRoot}/operadores`, { params: { active: 'true', limit: 100 } });
  }

  summary(): Observable<AdminSummary> {
    return this.http.get<AdminSummary>(`${this.catalog}/resumen`);
  }

  availability(attractionId: string, from: string, to: string): Observable<AdminAvailability> {
    return this.http.get<AdminAvailability>(`${this.catalog}/${encodeURIComponent(attractionId)}/cupos`, { params: { from, to } });
  }

  createSlots(attractionId: string, body: AdminSlotBatch): Observable<{ created: number; skipped: number; dates: number; times: number }> {
    return this.http.post<{ created: number; skipped: number; dates: number; times: number }>(`${this.catalog}/${encodeURIComponent(attractionId)}/cupos`, body);
  }

  updateSlot(attractionId: string, body: { date: string; time: string; capacity: number; closed: boolean }): Observable<AdminSlot> {
    return this.http.patch<AdminSlot>(`${this.catalog}/${encodeURIComponent(attractionId)}/cupos`, body);
  }

  reservations(filters: AdminReservationFilters): Observable<AdminReservationsPage> {
    let params = new HttpParams().set('page', filters.page).set('limit', filters.limit);
    for (const key of ['estado', 'q', 'fecha_desde', 'fecha_hasta'] as const) {
      const value = filters[key]?.trim();
      if (value) params = params.set(key, value);
    }
    return this.http.get<AdminReservationsPage>(`${this.catalog}/reservas`, { params });
  }

  private readonly clientSnapshots = new Map<string, AdminClient>();

  createClient(body: { nombre: string; email: string; identificacion?: string; telefono?: string }) {
    return this.http.post<{ cliente: AdminClient; reused: boolean }>(`${this.catalog}/clientes`, body);
  }

  private allPages<T>(request: (page: number) => Observable<{ items: T[]; total: number }>): Observable<T[]> {
    return request(1).pipe(
      map(result => ({ ...result, page: 1 })),
      expand(result => result.items.length && result.page * 100 < result.total
        ? request(result.page + 1).pipe(map(next => ({ ...next, page: result.page + 1 }))) : EMPTY),
      reduce((items, result) => [...items, ...result.items], [] as T[]),
    );
  }

  clients(page: number, limit: number, q = ''): Observable<AdminClientsPage> {
    return forkJoin({
      profiles: this.allPages<AdminClient>(p => this.http.get<AdminClientsPage>(`${this.catalog}/clientes`, { params: { page: p, limit: 100 } })),
      users: this.allPages<AdminUser>(p => this.users(p, 100)),
      paidUserIds: this.http.get<Array<{ userId: string }>>(`${this.cart}/cart/admin/customers`),
      bookingReservations: this.allPages<AdminReservation>(p => this.http.get<AdminReservationsPage>(
        `${this.catalog}/reservas`, { params: { page: p, limit: 100 } },
      )),
    }).pipe(map(({ profiles, users, paidUserIds, bookingReservations }) => {
      const paidUsers = new Set(paidUserIds.map(customer => customer.userId));
      const paidUserEmails = new Set(users
        .filter(user => paidUsers.has(user.id))
        .map(user => user.email.trim().toLowerCase()));
      const paidBookingReservations = bookingReservations
        .filter(reservation => ['CONFIRMADA', 'CANCELADA', 'CANCELANDO'].includes(reservation.estado));
      const purchasedBookingClients = new Set(paidBookingReservations
        .map(reservation => reservation.client_id)
        .filter((clientId): clientId is string => Boolean(clientId)));
      const purchasedBookingEmails = new Set(paidBookingReservations
        .map(reservation => reservation.cliente_email.trim().toLowerCase())
        .filter(Boolean));
      const eligibleProfiles = profiles.filter(client =>
        !client.usuario_id || purchasedBookingClients.has(client.client_id)
        || purchasedBookingEmails.has(client.email.trim().toLowerCase())
        || Boolean(client.usuario_id && paidUsers.has(client.usuario_id))
        || paidUserEmails.has(client.email.trim().toLowerCase()));
      const merged = new Map(eligibleProfiles.map(client => [client.email.trim().toLowerCase(), { ...client }]));
      for (const user of users.filter(user => user.roles.includes('CLIENTE'))) {
        const email = user.email.trim().toLowerCase();
        const existing = merged.get(email);
        if (existing) {
          merged.set(email, {
            ...existing, usuario_id: user.id, origenes: [...new Set([...existing.origenes, 'TIENDA'])],
          });
        } else if (paidUsers.has(user.id)) {
          merged.set(email, {
            client_id: `identity:${user.id}`, usuario_id: user.id,
            nombre: `${user.first_name} ${user.last_name}`.trim(), email: user.email,
            identificacion: null, telefono: user.phone, origenes: ['TIENDA'], creado_en: null,
          });
        }
      }
      this.clientSnapshots.clear();
      for (const client of merged.values()) this.clientSnapshots.set(client.client_id, client);
      const query = q.trim().toLocaleLowerCase();
      const items = [...merged.values()].filter(client => !query ||
        [client.nombre, client.email, client.identificacion ?? ''].some(value => value.toLocaleLowerCase().includes(query)))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      return { items: items.slice((page - 1) * limit, page * limit), total: items.length,
        page, limit, total_pages: Math.max(1, Math.ceil(items.length / limit)) };
    }));
  }

  client(id: string): Observable<AdminClientDetail> {
    const snapshot = this.clientSnapshots.get(id);
    if (id.startsWith('identity:') && snapshot) return of({ ...snapshot, reservas: [] });
    return this.http.get<AdminClientDetail>(`${this.catalog}/clientes/${encodeURIComponent(id)}`).pipe(
      map(detail => ({ ...detail, usuario_id: detail.usuario_id ?? snapshot?.usuario_id,
        origenes: snapshot?.origenes ?? detail.origenes })),
    );
  }

  clientLocalReservations(userId: string) {
    return this.http.get<import('../../contracts/admin.contracts').AdminLocalReservation[]>(
      `${this.cart}/cart/admin/users/${encodeURIComponent(userId)}/reservations`,
    );
  }

  reservation(id: string): Observable<AdminReservation> {
    return this.http.get<AdminReservation>(`${this.catalog}/reservas/${encodeURIComponent(id)}`);
  }

  cancelReservation(id: string): Observable<AdminReservation> {
    return this.http.post<AdminReservation>(`${this.catalog}/reservas/${encodeURIComponent(id)}/cancel`, {});
  }

  checkinReservation(id: string, body: { documento_identidad?: string; guia_codigo?: string; asistentes_reales?: number }): Observable<AdminCheckinResult> {
    return this.http.post<AdminCheckinResult>(`${this.catalogRoot}/atracciones/reservas/${encodeURIComponent(id)}/checkin`, body);
  }

  users(page: number, limit: number): Observable<AdminUsersPage> {
    return this.http.get<AdminUsersPage>(`${this.identity}/users`, { params: { page, limit } });
  }

  createAdministrator(body: { first_name: string; last_name: string; email: string; password: string }): Observable<AdminUser> {
    return this.http.post<AdminUser>(`${this.identity}/users/administrators`, body);
  }

  roles(): Observable<AdminRole[]> {
    return this.http.get<AdminRole[]>(`${this.identity}/roles`);
  }

  setUserActive(id: string, active: boolean): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.identity}/users/${encodeURIComponent(id)}/status`, { active });
  }

  assignRole(userId: string, roleId: number): Observable<unknown> {
    return this.http.post(`${this.identity}/users/${encodeURIComponent(userId)}/roles`, { role_id: roleId });
  }

  removeRole(userId: string, roleId: number): Observable<void> {
    return this.http.delete<void>(`${this.identity}/users/${encodeURIComponent(userId)}/roles/${roleId}`);
  }

  errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) {
        this.auth.logoutLocally();
        return 'Sesión no válida. Inicia sesión nuevamente desde la cabecera.';
      }
      if (error.status === 403) {
        return 'Acceso denegado: tu cuenta no tiene permisos ADMIN para esta operación.';
      }
    }
    return httpErrorMessage(error);
  }
}
