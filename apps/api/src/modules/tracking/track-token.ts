import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';

/**
 * Shareable tracking link tokens (Phase 5 §10.1).
 *
 * token = base64url( bookingId || expUnix || HMAC_SHA256(bookingId||expUnix) )
 *
 * The raw token travels in the SMS/URL; only its sha256 hash is persisted in
 * the `TrackToken` table so a DB leak cannot reconstruct live links. Validation
 * is constant-time and additionally checks the row is not revoked/expired.
 */

const SEP = '.';

function sign(payload: string): string {
  return createHmac('sha256', env.TRACK_LINK_SECRET).update(payload).digest('base64url');
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface DecodedToken {
  bookingId: string;
  expUnix: number;
}

/** Build a signed token string from a bookingId + expiry. */
export function encodeToken(bookingId: string, expiresAt: Date): string {
  const expUnix = Math.floor(expiresAt.getTime() / 1000);
  const payload = `${bookingId}${SEP}${expUnix}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}${SEP}${sig}`, 'utf8').toString('base64url');
}

/** Parse + verify HMAC + expiry of a token string. Returns null on any failure. */
export function decodeToken(token: string): DecodedToken | null {
  let raw: string;
  try {
    raw = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = raw.split(SEP);
  if (parts.length !== 3) return null;
  const [bookingId, expStr, sig] = parts as [string, string, string];
  const expUnix = Number(expStr);
  if (!bookingId || !Number.isFinite(expUnix)) return null;

  const expected = sign(`${bookingId}${SEP}${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (expUnix * 1000 <= Date.now()) return null;
  return { bookingId, expUnix };
}

/**
 * Issue a fresh track token for a booking: persist the hash and return the raw
 * token plus the full shareable URL. Generated on DRIVER_ASSIGNED.
 */
export async function issueTrackToken(
  bookingId: string,
  code: string,
  expiresAt: Date,
): Promise<{ token: string; url: string }> {
  // A tiny salt keeps two tokens for the same booking/expiry distinct.
  const expWithJitter = new Date(expiresAt.getTime() + (randomBytes(1)[0]! % 1000));
  const token = encodeToken(bookingId, expWithJitter);
  await prisma.trackToken.create({
    data: { bookingId, tokenHash: sha256(token), expiresAt: expWithJitter },
  });
  const base = env.PUBLIC_TRACK_URL.replace(/\/$/, '');
  const url = `${base}/track/${code}?t=${token}`;
  return { token, url };
}

/**
 * Full validation used by every public /track request: HMAC + expiry + the
 * token row must exist and not be revoked. Returns the bookingId or null.
 */
export async function verifyTrackToken(token: string): Promise<string | null> {
  const decoded = decodeToken(token);
  if (!decoded) return null;
  const row = await prisma.trackToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.revokedAt) return null;
  if (row.bookingId !== decoded.bookingId) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return decoded.bookingId;
}

/** Revoke all active tokens for a booking ("Stop sharing"). */
export async function revokeTrackTokens(bookingId: string): Promise<number> {
  const res = await prisma.trackToken.updateMany({
    where: { bookingId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}
