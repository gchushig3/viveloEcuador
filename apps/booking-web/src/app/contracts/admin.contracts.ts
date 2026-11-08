export type {
  CreateAttractionRequest,
  UpdateAttractionRequest,
} from './atracciones.contracts';

export type AdminReservationStatus = 'CONFIRMADA' | 'CANCELADA' | 'PENDIENTE' | 'CANCELANDO';

export interface AdminReservation {
  reserva_id: string;
  estado: AdminReservationStatus;
  atraccion_id: string;
  atraccion: string;
  fecha: string;
  hora: string;
  personas: number;
  cliente_nombre: string;
  cliente_email: string;
  creada_en: string;
  checkin_en?: string | null;
  asistentes_reales?: number | null;
  booking_notificado?: boolean;
}

export interface AdminCheckinResult {
  reserva_id: string;
  estado: string;
  client_id: string | null;
  hora_checkin: string;
  asistentes_reales: number | null;
  pase_abordar_qr: string;
  booking_notificado: boolean;
  booking_error?: string;
}

export interface AdminReservationsPage {
  items: AdminReservation[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface AdminReservationFilters {
  estado?: AdminReservationStatus | '';
  q?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
  page: number;
  limit: number;
}

export interface AdminSummary {
  reservas: {
    total: number;
    confirmadas: number;
    canceladas: number;
    hoy: number;
    proximas: number;
    ultimas_24h: number;
    personas_proximas: number;
  };
  atracciones: { total: number; publicadas: number; borradores: number; inactivas: number };
  top_atracciones: Array<{ atraccion_id: string; atraccion: string; reservas: number; personas: number }>;
  recientes: AdminReservation[];
}

export interface AdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  verified: boolean;
  active: boolean;
  roles: string[];
}

export interface AdminUsersPage {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminRole {
  id: number;
  name: string;
  description: string;
  active: boolean;
}

export interface AdminCity {
  id: number;
  name: string;
  province_id: number;
  province: string | null;
}

export interface AdminOperator {
  id: string;
  name: string;
  ruc: string | null;
  active: boolean;
}

export interface AdminSlot {
  slotId: string;
  date: string;
  timeSlot: string;
  total: number;
  reserved: number;
  available: number;
  closed: boolean;
  status: 'DISPONIBLE' | 'ULTIMOS_CUPOS' | 'AGOTADO';
}

export interface AdminAvailability {
  attraction: { id: string; name: string };
  from: string;
  to: string;
  schedule_times: string[];
  slots: AdminSlot[];
}

export interface AdminSlotBatch {
  from: string;
  to: string;
  weekdays: number[];
  times: string[];
  capacity: number;
}
