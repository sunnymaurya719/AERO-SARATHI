import type { Response } from 'express';
import { ADMIN_SID_COOKIE } from '../../../middleware/admin-session.js';
import { CSRF_COOKIE } from './csrf.js';

const CHALLENGE_COOKIE = '__Host-admin_challenge';

/**
 * Cookie helpers. We use the `__Host-` prefix which requires Secure + Path=/
 * and forbids Domain — the browser binds them to the exact host, which is the
 * isolation we want for the admin panel.
 */
const baseCookie = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
};

export function setSessionCookies(res: Response, sessionToken: string, csrfToken: string, ttlSec: number): void {
  res.cookie(ADMIN_SID_COOKIE, sessionToken, { ...baseCookie, maxAge: ttlSec * 1000 });
  // CSRF cookie is readable by JS (double-submit) so it must NOT be httpOnly.
  res.cookie(CSRF_COOKIE, csrfToken, { secure: true, sameSite: 'strict', path: '/', maxAge: ttlSec * 1000 });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ADMIN_SID_COOKIE, { ...baseCookie });
  res.clearCookie(CSRF_COOKIE, { secure: true, sameSite: 'strict', path: '/' });
}

export function setChallengeCookie(res: Response, challengeId: string): void {
  res.cookie(CHALLENGE_COOKIE, challengeId, { ...baseCookie, maxAge: 5 * 60 * 1000 });
}

export function clearChallengeCookie(res: Response): void {
  res.clearCookie(CHALLENGE_COOKIE, { ...baseCookie });
}
