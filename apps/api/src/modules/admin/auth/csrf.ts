import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Errors } from '../../../errors.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';

export const CSRF_COOKIE = '__Host-admin_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Generate a random 32-byte CSRF token (hex). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Double-submit CSRF check for state-changing admin requests.
 * Compares the X-CSRF-Token header against the value bound to the session.
 * Must run AFTER adminSession so req.admin.csrfToken is populated.
 */
export function csrfDoubleSubmit(req: Request, _res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const expected = (req as AdminRequest).admin?.csrfToken;
  const header = req.header(CSRF_HEADER);
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;

  if (!expected || !header || !cookie) return next(Errors.forbidden('CSRF token missing'));
  if (!safeEqual(header, expected) || !safeEqual(cookie, expected)) {
    return next(Errors.forbidden('CSRF token invalid'));
  }
  next();
}
