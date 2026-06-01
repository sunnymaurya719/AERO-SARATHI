import { randomInt } from 'node:crypto';

// Base32-ish alphabet with ambiguous chars (0,O,1,I) removed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSuffix(len = 4): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

/** Booking code: AS-yyMMdd-XXXX (e.g. AS-250214-7KQ9). */
export function generateBookingCode(now = new Date()): string {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `AS-${yy}${mm}${dd}-${randomSuffix()}`;
}
