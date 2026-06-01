import { describe, it, expect } from 'vitest';
import { generateBookingCode } from '../src/modules/bookings/code.js';

describe('generateBookingCode', () => {
  it('matches the AS-yyMMdd-XXXX format', () => {
    const code = generateBookingCode(new Date('2025-02-14T10:00:00Z'));
    expect(code).toMatch(/^AS-250214-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  });

  it('omits ambiguous characters (0,O,1,I)', () => {
    for (let i = 0; i < 200; i++) {
      const suffix = generateBookingCode().split('-')[2]!;
      expect(suffix).not.toMatch(/[01OI]/);
    }
  });

  it('produces varied suffixes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateBookingCode()));
    expect(codes.size).toBeGreaterThan(90);
  });
});
