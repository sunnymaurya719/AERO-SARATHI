import type { AdminMe, AdminLoginResponse, AdminSessionInfo } from '@aero/types';
import { api } from './api';

export function login(email: string, password: string): Promise<AdminLoginResponse> {
  return api<AdminLoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
}

export function verify2fa(challengeId: string, code: string): Promise<{ ok: true; expiresAt: string }> {
  return api<{ ok: true; expiresAt: string }>('/auth/2fa', { method: 'POST', body: { challengeId, code } });
}

export function me(): Promise<AdminMe> {
  return api<AdminMe>('/auth/me');
}

export function logout(): Promise<void> {
  return api<void>('/auth/logout', { method: 'POST' });
}

export function listSessions(): Promise<AdminSessionInfo[]> {
  return api<{ items: AdminSessionInfo[] }>('/auth/sessions').then((r) => r.items);
}

export function revokeSession(id: string): Promise<void> {
  return api<void>(`/auth/sessions/${id}/revoke`, { method: 'POST' });
}

export function beginTotpEnrol(): Promise<{ secret: string; otpauthUri: string }> {
  return api<{ secret: string; otpauthUri: string }>('/auth/totp/enrol', { method: 'POST' });
}

export function confirmTotpEnrol(code: string): Promise<{ ok: true }> {
  return api<{ ok: true }>('/auth/totp/verify-enrol', { method: 'POST', body: { code } });
}

export function acceptInvite(token: string, password: string): Promise<{ otpauthUri: string; email: string }> {
  return api<{ otpauthUri: string; email: string }>('/auth/accept-invite', { method: 'POST', body: { token, password } });
}
