import { describe, it, expect } from 'vitest';
import { computeFare } from '../src/modules/quotes/fare.js';

const baseRule = {
  baseFare: 80000, // ₹800 in paise
  baseKm: 10,
  perKm: 1200, // ₹12/km
  perMin: 100, // ₹1/min
  nightSurcharge: 0.1,
  minFare: 50000,
  tokenPercent: 0.2,
};

// A daytime IST instant: 2025-06-01 10:00 IST = 04:30 UTC
const day = new Date('2025-06-01T04:30:00.000Z');
// A night IST instant: 2025-06-01 23:00 IST = 17:30 UTC
const night = new Date('2025-06-01T17:30:00.000Z');

describe('computeFare', () => {
  it('charges only base fare within base km', () => {
    const f = computeFare({ distanceKm: 8, durationMin: 0, scheduledAt: day, rule: baseRule });
    expect(f.distance).toBe(0);
    expect(f.base).toBe(80000);
  });

  it('adds extra-km charges beyond base km', () => {
    const f = computeFare({ distanceKm: 20, durationMin: 0, scheduledAt: day, rule: baseRule });
    expect(f.distance).toBe(10 * 1200); // 10 extra km
  });

  it('adds per-minute time charges', () => {
    const f = computeFare({ distanceKm: 10, durationMin: 30, scheduledAt: day, rule: baseRule });
    expect(f.time).toBe(30 * 100);
  });

  it('applies no night surcharge during the day', () => {
    const f = computeFare({ distanceKm: 20, durationMin: 30, scheduledAt: day, rule: baseRule });
    expect(f.nightSurcharge).toBe(0);
  });

  it('applies night surcharge at 23:00 IST', () => {
    const f = computeFare({ distanceKm: 20, durationMin: 30, scheduledAt: night, rule: baseRule });
    expect(f.nightSurcharge).toBeGreaterThan(0);
  });

  it('applies night surcharge before 06:00 IST', () => {
    const early = new Date('2025-05-31T23:30:00.000Z'); // 05:00 IST
    const f = computeFare({ distanceKm: 20, durationMin: 30, scheduledAt: early, rule: baseRule });
    expect(f.nightSurcharge).toBeGreaterThan(0);
  });

  it('no surcharge exactly at 06:00 IST', () => {
    const six = new Date('2025-06-01T00:30:00.000Z'); // 06:00 IST
    const f = computeFare({ distanceKm: 20, durationMin: 30, scheduledAt: six, rule: baseRule });
    expect(f.nightSurcharge).toBe(0);
  });

  it('floors the total at minFare', () => {
    const f = computeFare({ distanceKm: 0, durationMin: 0, scheduledAt: day, rule: { ...baseRule, baseFare: 1000, minFare: 50000 } });
    expect(f.total).toBe(50000);
  });

  it('splits token and balance correctly', () => {
    const f = computeFare({ distanceKm: 20, durationMin: 30, scheduledAt: day, rule: baseRule });
    expect(f.tokenAmount + f.balanceAmount).toBe(f.total);
    expect(f.tokenAmount).toBe(Math.round(f.total * 0.2));
  });

  it('subtotal equals base + distance + time + surcharge', () => {
    const f = computeFare({ distanceKm: 20, durationMin: 30, scheduledAt: night, rule: baseRule });
    expect(f.subtotal).toBe(f.base + f.distance + f.time + f.nightSurcharge);
  });

  it('returns integer paise amounts', () => {
    const f = computeFare({ distanceKm: 17.3, durationMin: 41, scheduledAt: day, rule: baseRule });
    for (const v of Object.values(f)) expect(Number.isInteger(v)).toBe(true);
  });

  it('handles zero-distance, zero-time trips', () => {
    const f = computeFare({ distanceKm: 0, durationMin: 0, scheduledAt: day, rule: baseRule });
    expect(f.distance).toBe(0);
    expect(f.time).toBe(0);
  });
});
