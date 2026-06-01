import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/modules/admin/auth/password.js';

describe('password hashing', () => {
  it('produces an argon2id hash distinct from the plaintext', async () => {
    const hash = await hashPassword('CorrectHorseBatteryStaple1!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('CorrectHorseBatteryStaple1!');
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('S3cur3-Pass!');
    expect(await verifyPassword(hash, 'S3cur3-Pass!')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('S3cur3-Pass!');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-real-hash', 'whatever')).toBe(false);
  });
});
