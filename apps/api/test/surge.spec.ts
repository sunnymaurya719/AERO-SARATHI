import { describe, it, expect } from 'vitest';
import {
  demandSurgeStep,
  demandSupplyRatio,
  resolveSurge,
  applySurge,
  roundMultiplier,
  dayTypeOf,
  hourBandOf,
  floorForTimeBucket,
  type TimeFloor,
} from '../src/modules/pricing/surge.js';

describe('demandSurgeStep', () => {
  it('returns 1.0 below 0.8', () => {
    expect(demandSurgeStep(0)).toBe(1.0);
    expect(demandSurgeStep(0.79)).toBe(1.0);
  });
  it('returns 1.1 in [0.8,1.2)', () => {
    expect(demandSurgeStep(0.8)).toBe(1.1);
    expect(demandSurgeStep(1.19)).toBe(1.1);
  });
  it('returns 1.25 in [1.2,1.8)', () => {
    expect(demandSurgeStep(1.2)).toBe(1.25);
    expect(demandSurgeStep(1.79)).toBe(1.25);
  });
  it('returns 1.4 in [1.8,2.5)', () => {
    expect(demandSurgeStep(1.8)).toBe(1.4);
    expect(demandSurgeStep(2.49)).toBe(1.4);
  });
  it('returns 1.6 in [2.5,3.5)', () => {
    expect(demandSurgeStep(2.5)).toBe(1.6);
    expect(demandSurgeStep(3.49)).toBe(1.6);
  });
  it('returns 1.8 at/above 3.5', () => {
    expect(demandSurgeStep(3.5)).toBe(1.8);
    expect(demandSurgeStep(99)).toBe(1.8);
  });
  it('treats NaN as no surge', () => {
    expect(demandSurgeStep(NaN)).toBe(1.0);
  });
});

describe('demandSupplyRatio', () => {
  it('never divides by zero supply', () => {
    expect(demandSupplyRatio(10, 0)).toBe(10);
  });
  it('computes normal ratio', () => {
    expect(demandSupplyRatio(6, 3)).toBe(2);
  });
  it('clamps negative inputs to zero', () => {
    expect(demandSupplyRatio(-5, 3)).toBe(0);
  });
});

describe('resolveSurge', () => {
  it('no surge when supply ample', () => {
    expect(resolveSurge({ demand: 1, supply: 10 }).surgeMultiplier).toBe(1.0);
  });
  it('applies demand surge step', () => {
    expect(resolveSurge({ demand: 6, supply: 3 }).surgeMultiplier).toBe(1.4);
  });
  it('time floor wins over a low demand surge', () => {
    const r = resolveSurge({ demand: 1, supply: 10, timeFloor: 1.1 });
    expect(r.surgeMultiplier).toBe(1.1);
    expect(r.breakdown.demandSurge).toBe(1.0);
  });
  it('demand surge wins over a lower time floor', () => {
    const r = resolveSurge({ demand: 10, supply: 3, timeFloor: 1.1 });
    expect(r.surgeMultiplier).toBe(1.6);
  });
  it('clamps to the global cap', () => {
    const r = resolveSurge({ demand: 100, supply: 1, globalCap: 1.8 });
    expect(r.surgeMultiplier).toBe(1.8);
    expect(r.breakdown.capApplied).toBe(false); // step already maxes at 1.8
  });
  it('clamps to a tighter route cap', () => {
    const r = resolveSurge({ demand: 100, supply: 1, routeCapMultiplier: 1.4 });
    expect(r.surgeMultiplier).toBe(1.4);
    expect(r.breakdown.capApplied).toBe(true);
  });
  it('route cap cannot exceed the global cap', () => {
    const r = resolveSurge({ demand: 100, supply: 1, routeCapMultiplier: 3.0, globalCap: 1.8 });
    expect(r.surgeMultiplier).toBe(1.8);
  });
  it('blackout forces 1.0x', () => {
    const r = resolveSurge({ demand: 100, supply: 1, blackout: true });
    expect(r.surgeMultiplier).toBe(1.0);
    expect(r.breakdown.blackout).toBe(true);
  });
  it('manual override is applied (and capped)', () => {
    const r = resolveSurge({ demand: 1, supply: 10, override: 1.5 });
    expect(r.surgeMultiplier).toBe(1.5);
    expect(r.breakdown.overrideApplied).toBe(true);
  });
  it('override is still clamped to cap', () => {
    const r = resolveSurge({ demand: 1, supply: 10, override: 5, globalCap: 1.8 });
    expect(r.surgeMultiplier).toBe(1.8);
  });
  it('never goes below the floor', () => {
    const r = resolveSurge({ demand: 0, supply: 100, floor: 1.0 });
    expect(r.surgeMultiplier).toBe(1.0);
  });
  it('divide-by-zero supply still resolves', () => {
    const r = resolveSurge({ demand: 5, supply: 0 });
    expect(r.surgeMultiplier).toBe(1.8);
  });
  it('never exceeds 1.8 global cap under any input', () => {
    for (let d = 0; d < 50; d++) {
      const r = resolveSurge({ demand: d, supply: 1 });
      expect(r.surgeMultiplier).toBeLessThanOrEqual(1.8);
      expect(r.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    }
  });
});

describe('applySurge', () => {
  it('rounds surged fare', () => {
    expect(applySurge(100000, 1.4)).toBe(140000);
    expect(applySurge(99950, 1.1)).toBe(109945);
  });
  it('1.0x leaves fare unchanged', () => {
    expect(applySurge(123456, 1.0)).toBe(123456);
  });
});

describe('roundMultiplier', () => {
  it('rounds to two decimals', () => {
    expect(roundMultiplier(1.250000001)).toBe(1.25);
  });
});

describe('time bucketing', () => {
  it('classifies weekend vs weekday', () => {
    expect(dayTypeOf(new Date('2026-05-30T10:00:00Z'))).toBe('WEEKEND'); // Saturday
    expect(dayTypeOf(new Date('2026-06-01T10:00:00Z'))).toBe('WEEKDAY'); // Monday
    expect(dayTypeOf(new Date('2026-06-01T10:00:00Z'), true)).toBe('HOLIDAY');
  });
  it('classifies hour bands', () => {
    expect(hourBandOf(new Date('2026-06-01T03:00:00Z'))).toBe('0-5');
    expect(hourBandOf(new Date('2026-06-01T06:00:00Z'))).toBe('5-8');
    expect(hourBandOf(new Date('2026-06-01T12:00:00Z'))).toBe('8-17');
    expect(hourBandOf(new Date('2026-06-01T18:00:00Z'))).toBe('17-21');
    expect(hourBandOf(new Date('2026-06-01T22:00:00Z'))).toBe('21-24');
  });
  it('resolves configured time floor', () => {
    const floors: TimeFloor[] = [{ dayType: 'WEEKDAY', hourBand: '17-21', floor: 1.1 }];
    expect(floorForTimeBucket(floors, 'WEEKDAY', '17-21')).toBe(1.1);
    expect(floorForTimeBucket(floors, 'WEEKDAY', '8-17')).toBe(1.0);
  });
});
