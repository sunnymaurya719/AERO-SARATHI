import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zoneOf, routeBucketOf } from '../src/modules/pricing/zone.js';

const h = vi.hoisted(() => ({
  ruleFindFirst: vi.fn(),
  ruleCreate: vi.fn(),
  ruleUpdate: vi.fn(),
  overrideFindFirst: vi.fn(),
  demandCount: vi.fn(),
  supplyCount: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    surgeRule: { findFirst: h.ruleFindFirst, create: h.ruleCreate, update: h.ruleUpdate },
    surgeOverride: { findFirst: h.overrideFindFirst },
  },
}));
vi.mock('../src/modules/pricing/demand.service.js', () => ({
  demandCount: (...a: unknown[]) => h.demandCount(...a),
  supplyCount: (...a: unknown[]) => h.supplyCount(...a),
}));
vi.mock('../src/env.js', () => ({
  env: { LOG_LEVEL: 'silent', SURGE_ENABLED: true, SURGE_SHADOW_MODE: false, SURGE_GLOBAL_CAP: 1.8, SURGE_FLOOR: 1.0 },
}));
vi.mock('@aero/db', () => ({ Prisma: {} }));

import { createSurgeRule, resolveSurgeForRoute } from '../src/modules/pricing/rules.service.js';

describe('zoneOf / routeBucketOf (pure)', () => {
  it('snaps to grid cells', () => {
    expect(zoneOf(30.733, 76.779)).toBe('30.70:76.75');
  });
  it('is stable within a cell', () => {
    expect(zoneOf(30.71, 76.76)).toBe(zoneOf(30.74, 76.79));
  });
  it('route bucket uses pickup zone', () => {
    expect(routeBucketOf(30.733, 76.779)).toBe('30.70:76.75');
  });
});

describe('createSurgeRule', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));
  it('versions from 1 with no prior rule', async () => {
    h.ruleFindFirst.mockResolvedValue(null);
    h.ruleCreate.mockResolvedValue({ id: 'r1', version: 1 });
    await createSurgeRule({ routeBucket: 'z1', timeFloors: [], createdById: 'a1' });
    const arg = h.ruleCreate.mock.calls[0]![0] as { data: { version: number } };
    expect(arg.data.version).toBe(1);
    expect(h.ruleUpdate).not.toHaveBeenCalled();
  });
  it('supersedes the previous version', async () => {
    h.ruleFindFirst.mockResolvedValue({ id: 'old', version: 3 });
    h.ruleCreate.mockResolvedValue({ id: 'new', version: 4 });
    await createSurgeRule({ routeBucket: 'z1', timeFloors: [], createdById: 'a1' });
    const arg = h.ruleCreate.mock.calls[0]![0] as { data: { version: number } };
    expect(arg.data.version).toBe(4);
    expect(h.ruleUpdate).toHaveBeenCalledWith({ where: { id: 'old' }, data: { supersededById: 'new' } });
  });
});

describe('resolveSurgeForRoute', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));

  it('returns floor with no rule and low demand', async () => {
    h.ruleFindFirst.mockResolvedValue(null);
    h.overrideFindFirst.mockResolvedValue(null);
    h.demandCount.mockResolvedValue(1);
    h.supplyCount.mockResolvedValue(10);
    const r = await resolveSurgeForRoute({ pickupLat: 30.7, pickupLng: 76.7 });
    expect(r.surgeMultiplier).toBe(1.0);
    expect(r.routeBucket).toBe('30.70:76.70');
  });

  it('surges when demand exceeds supply', async () => {
    h.ruleFindFirst.mockResolvedValue({ version: 2, capMultiplier: 1.8, timeFloors: [], blackout: false });
    h.overrideFindFirst.mockResolvedValue(null);
    h.demandCount.mockResolvedValue(30);
    h.supplyCount.mockResolvedValue(10);
    const r = await resolveSurgeForRoute({ pickupLat: 30.7, pickupLng: 76.7 });
    expect(r.surgeMultiplier).toBeGreaterThan(1.0);
    expect(r.ruleVersion).toBe(2);
  });

  it('honours a blackout rule', async () => {
    h.ruleFindFirst.mockResolvedValue({ version: 1, capMultiplier: 1.8, timeFloors: [], blackout: true });
    h.overrideFindFirst.mockResolvedValue(null);
    h.demandCount.mockResolvedValue(100);
    h.supplyCount.mockResolvedValue(1);
    const r = await resolveSurgeForRoute({ pickupLat: 30.7, pickupLng: 76.7 });
    expect(r.surgeMultiplier).toBe(1.0);
  });
});
