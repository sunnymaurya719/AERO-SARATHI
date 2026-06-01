import { describe, it, expect } from 'vitest';
import { encodeToken, decodeToken } from '../src/modules/tracking/track-token.js';

// Pure HMAC token tests (no DB). The persisted-hash path is covered by e2e.

describe('track-token encode/decode', () => {
  const bookingId = '11111111-1111-1111-1111-111111111111';

  it('round-trips a valid token', () => {
    const exp = new Date(Date.now() + 60_000);
    const token = encodeToken(bookingId, exp);
    const decoded = decodeToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.bookingId).toBe(bookingId);
    expect(decoded!.expUnix).toBe(Math.floor(exp.getTime() / 1000));
  });

  it('rejects an expired token', () => {
    const token = encodeToken(bookingId, new Date(Date.now() - 1000));
    expect(decodeToken(token)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = encodeToken(bookingId, new Date(Date.now() + 60_000));
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const tampered = Buffer.from(raw.replace(bookingId, '22222222-2222-2222-2222-222222222222'), 'utf8').toString(
      'base64url',
    );
    expect(decodeToken(tampered)).toBeNull();
  });

  it('rejects a token with a flipped signature byte', () => {
    const token = encodeToken(bookingId, new Date(Date.now() + 60_000));
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parts = raw.split('.');
    parts[2] = parts[2]!.slice(0, -1) + (parts[2]!.endsWith('a') ? 'b' : 'a');
    const bad = Buffer.from(parts.join('.'), 'utf8').toString('base64url');
    expect(decodeToken(bad)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(decodeToken('not-a-token')).toBeNull();
    expect(decodeToken('')).toBeNull();
    expect(decodeToken('a.b')).toBeNull();
  });

  it('rejects a token signed with a different secret shape (structure check)', () => {
    // A 2-part base64url string should never validate.
    const fake = Buffer.from('only.two', 'utf8').toString('base64url');
    expect(decodeToken(fake)).toBeNull();
  });

  it('produces distinct tokens for distinct expiries', () => {
    const t1 = encodeToken(bookingId, new Date(Date.now() + 60_000));
    const t2 = encodeToken(bookingId, new Date(Date.now() + 120_000));
    expect(t1).not.toBe(t2);
  });
});
