import { describe, it, expect } from 'vitest';
import { generateTotpSecret, otpauthUri, verifyTotp, generateTotpCode } from '../src/modules/admin/auth/totp.js';

describe('TOTP', () => {
  it('generates a base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('builds an otpauth URI with issuer and account', () => {
    const secret = generateTotpSecret();
    const uri = otpauthUri('admin@example.com', secret);
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('admin%40example.com');
    expect(uri).toContain(`secret=${secret}`);
  });

  it('verifies a freshly generated code', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it('accepts a code with surrounding whitespace', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(verifyTotp(secret, `  ${code}  `)).toBe(true);
  });

  it('rejects a wrong code', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(verifyTotp(secret, wrong)).toBe(false);
  });

  it('rejects non-6-digit input', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, '12345')).toBe(false);
    expect(verifyTotp(secret, 'abcdef')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
  });
});
