import { generateSecret, generateURI, generateSync, verifySync } from 'otplib';
import { env } from '../../../env.js';

// Allow ±1 time-step (30s) of clock drift, per Phase 3 §11.1.
const PERIOD_SEC = 30;
const EPOCH_TOLERANCE_SEC = 30;

/** Generate a fresh base32 TOTP secret (≥ 80 bits of entropy). */
export function generateTotpSecret(): string {
  return generateSecret({ length: 20 }); // 20 bytes = 160 bits
}

/** otpauth:// enrolment URI to render as a QR / paste into an authenticator. */
export function otpauthUri(accountEmail: string, secret: string): string {
  return generateURI({ issuer: env.ADMIN_TOTP_ISSUER, label: accountEmail, secret, period: PERIOD_SEC });
}

/** Generate the current 6-digit TOTP code for a secret (used in tests/tools). */
export function generateTotpCode(secret: string): string {
  return generateSync({ secret, period: PERIOD_SEC });
}

/** Verify a 6-digit code against the secret within the allowed window. */
export function verifyTotp(secret: string, code: string): boolean {
  const trimmed = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) return false;
  try {
    return verifySync({ secret, token: trimmed, period: PERIOD_SEC, epochTolerance: EPOCH_TOLERANCE_SEC }).valid;
  } catch {
    return false;
  }
}
