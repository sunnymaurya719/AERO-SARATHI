import { api } from './api';
import type {
  DashboardResponse, Paginated, AdminBookingRow, BookingDetailResponse,
  AdminDriverRow, AdminVehicleRow, FareRuleResponse, AdminRefundRow,
  AdminUserRow, AuditEventRow, AdminSessionInfo, FareBreakdown,
} from '@aero/types';

// ── Dashboard ─────────────────────────────────────────────────────────────
export function getDashboard() {
  return api<DashboardResponse>('/dashboard');
}

// ── Bookings ──────────────────────────────────────────────────────────────
export type BookingFilters = { status?: string; q?: string; driverId?: string; from?: string; to?: string; cursor?: string };
export function listBookings(filters: BookingFilters) {
  return api<Paginated<AdminBookingRow>>('/bookings', { query: filters });
}
export function getBooking(id: string) {
  return api<BookingDetailResponse & Record<string, unknown>>(`/bookings/${id}`);
}
export function transitionBooking(id: string, to: string, reason: string) {
  return api(`/bookings/${id}/transition`, { method: 'POST', body: { to, reason } });
}
export function assignDriver(id: string, driverId: string) {
  return api(`/bookings/${id}/assign-driver`, { method: 'POST', body: { driverId } });
}
export function unassignDriver(id: string) {
  return api(`/bookings/${id}/unassign-driver`, { method: 'POST' });
}
export function cancelBooking(id: string, reason: string, refundOverride?: number) {
  return api(`/bookings/${id}/cancel`, { method: 'POST', body: { reason, refundOverride } });
}
export function addBookingNote(id: string, body: string) {
  return api(`/bookings/${id}/notes`, { method: 'POST', body: { body } });
}
export function resendNotification(id: string, template: string) {
  return api(`/bookings/${id}/resend-notification`, { method: 'POST', body: { template } });
}

// ── Drivers ───────────────────────────────────────────────────────────────
export type DriverFilters = { status?: string; city?: string; q?: string; hasVehicle?: string; cursor?: string };
export function listDrivers(filters: DriverFilters) {
  return api<Paginated<AdminDriverRow>>('/drivers', { query: filters });
}
export function getDriver(id: string) {
  return api<Record<string, unknown>>(`/drivers/${id}`);
}
export function createDriver(body: { phone: string; name: string; licenseNo: string; homeCity: string }) {
  return api('/drivers', { method: 'POST', body });
}
export function updateDriver(id: string, body: Record<string, unknown>) {
  return api(`/drivers/${id}`, { method: 'PATCH', body });
}
export function assignDriverVehicle(id: string, vehicleId: string) {
  return api(`/drivers/${id}/vehicle`, { method: 'POST', body: { vehicleId } });
}
export function unassignDriverVehicle(id: string) {
  return api(`/drivers/${id}/vehicle`, { method: 'DELETE' });
}
export function addDriverNote(id: string, body: string) {
  return api(`/drivers/${id}/notes`, { method: 'POST', body: { body } });
}
export function getDocUrl(driverId: string, docId: string) {
  return api<{ url: string }>(`/drivers/${driverId}/documents/${docId}/url`);
}
export function verifyDoc(driverId: string, docId: string) {
  return api(`/drivers/${driverId}/documents/${docId}/verify`, { method: 'POST' });
}

// ── Vehicles ──────────────────────────────────────────────────────────────
export type VehicleFilters = { category?: string; status?: string; q?: string; cursor?: string };
export function listVehicles(filters: VehicleFilters) {
  return api<Paginated<AdminVehicleRow>>('/vehicles', { query: filters });
}
export function getVehicle(id: string) {
  return api<Record<string, unknown>>(`/vehicles/${id}`);
}
export function createVehicle(body: Record<string, unknown>) {
  return api('/vehicles', { method: 'POST', body });
}
export function updateVehicle(id: string, body: Record<string, unknown>) {
  return api(`/vehicles/${id}`, { method: 'PATCH', body });
}

// ── Fare rules ────────────────────────────────────────────────────────────
export function listFareRules(category?: string) {
  return api<FareRuleResponse[]>('/fare-rules', { query: { category } });
}
export function listActiveFareRules() {
  return api<FareRuleResponse[]>('/fare-rules/active');
}
export function createFareRule(body: Record<string, unknown>) {
  return api('/fare-rules', { method: 'POST', body });
}
export function previewFare(body: Record<string, unknown>) {
  return api<FareBreakdown>('/fare-rules/preview', { method: 'POST', body });
}

// ── Refunds ───────────────────────────────────────────────────────────────
export function listRefunds(filters: { status?: string; bookingId?: string; cursor?: string }) {
  return api<Paginated<AdminRefundRow>>('/refunds', { query: filters });
}
export function getRefundable(bookingId: string) {
  return api<{ capturedTotal: number; refundedTotal: number; refundable: number }>(`/refunds/bookings/${bookingId}/refundable`);
}
export function issueRefund(bookingId: string, amount: number, reason: string) {
  return api(`/refunds/bookings/${bookingId}/refund`, { method: 'POST', body: { amount, reason } });
}
export function reconcileRefund(id: string, note: string) {
  return api(`/refunds/${id}/reconcile`, { method: 'POST', body: { note } });
}

// ── Webhooks ──────────────────────────────────────────────────────────────
export function listWebhooks(filters: { eventType?: string; processed?: string; cursor?: string }) {
  return api<Paginated<Record<string, unknown>>>('/webhooks', { query: filters });
}
export function getWebhook(id: string) {
  return api<Record<string, unknown>>(`/webhooks/${id}`);
}
export function replayWebhook(id: string) {
  return api(`/webhooks/${id}/replay`, { method: 'POST' });
}

// ── Audit ─────────────────────────────────────────────────────────────────
export function listAudit(filters: { entityType?: string; entityId?: string; actorId?: string; action?: string; cursor?: string }) {
  return api<Paginated<AuditEventRow>>('/audit', { query: filters });
}

// ── Users ─────────────────────────────────────────────────────────────────
export function listUsers() {
  return api<AdminUserRow[]>('/users');
}
export function inviteUser(email: string, role: string) {
  return api('/users/invite', { method: 'POST', body: { email, role } });
}
export function disableUser(id: string) {
  return api(`/users/${id}/disable`, { method: 'POST' });
}
export function enableUser(id: string) {
  return api(`/users/${id}/enable`, { method: 'POST' });
}
export function changeUserRole(id: string, role: string) {
  return api(`/users/${id}/role`, { method: 'POST', body: { role } });
}
export function resetUser2fa(id: string) {
  return api(`/users/${id}/reset-2fa`, { method: 'POST' });
}

// ── Sessions ──────────────────────────────────────────────────────────────
export function listSessions() {
  return api<{ items: AdminSessionInfo[] }>('/auth/sessions').then((r) => r.items);
}
