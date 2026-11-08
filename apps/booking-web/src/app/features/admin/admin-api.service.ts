import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CATALOG_API_URL, IDENTITY_API_URL } from '../../core/api.config';
import { httpErrorMessage } from '../../core/http-errors';
import {
  AdminCheckinResult,
  AdminReservation,
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
  private readonly identity = inject(IDENTITY_API_URL);
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
