import { describe, it, expect } from 'vitest';
import { avgOrderValue, dayWindow } from '../src/analytics/rollup.js';

describe('avgOrderValue', () => {
  it('returns 0 when there are no trips', () => {
    expect(avgOrderValue(100000n, 0)).toBe(0n);
  });

  it('divides GMV by trip count (integer paise)', () => {
    expect(avgOrderValue(100000n, 4)).toBe(25000n);
  });

  it('floors the division', () => {
    expect(avgOrderValue(10n, 3)).toBe(3n);
  });
});

describe('dayWindow', () => {
  it('produces a UTC midnight-to-midnight window', () => {
    const { start, end, key } = dayWindow(new Date('2026-06-03T14:32:10.000Z'));
    expect(start.toISOString()).toBe('2026-06-03T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-04T00:00:00.000Z');
    expect(key.getTime()).toBe(start.getTime());
  });

  it('end is exactly 24h after start', () => {
    const { start, end } = dayWindow(new Date('2026-01-01T00:00:00.000Z'));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
