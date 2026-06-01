'use client';

const ACCESS_KEY = 'aero_driver_at';
const REFRESH_KEY = 'aero_driver_rt';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export function saveTokens(t: StoredTokens): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCESS_KEY, t.accessToken);
  localStorage.setItem(REFRESH_KEY, t.refreshToken);
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isAuthed(): boolean {
  return getAccessToken() != null;
}
