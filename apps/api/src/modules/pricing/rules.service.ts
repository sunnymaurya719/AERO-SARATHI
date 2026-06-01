/**
 * Surge rules & overrides (Phase 6 §6). Rules are append-only versioned per
 * route bucket (each edit supersedes the previous version). Overrides are
 * time-boxed manual multipliers. `resolveSurgeForRoute` ties demand/supply,
 * the active rule, and any override into the pure `resolveSurge` calculator.
 */
import { Prisma } from '@aero/db';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import {
  resolveSurge,
  dayTypeOf,
  hourBandOf,
  floorForTimeBucket,
  DEFAULT_FLOOR,
  type TimeFloor,
  type SurgeResult,
} from './surge.js';
import { routeBucketOf } from './zone.js';
import { demandCount, supplyCount } from './demand.service.js';

export interface ResolvedRouteSurge extends SurgeResult {
  routeBucket: string;
  ruleVersion: number | null;
  shadow: boolean;
}

/** Latest (active) rule for a route bucket, or null. */
export async function getActiveSurgeRule(routeBucket: string) {
  return prisma.surgeRule.findFirst({
    where: { routeBucket, supersededById: null },
    orderBy: { version: 'desc' },
  });
}

/** Create a new rule version, superseding the previous active one. */
export async function createSurgeRule(input: {
  routeBucket: string;
  capMultiplier?: number;
  timeFloors: TimeFloor[];
  blackout?: boolean;
  createdById: string;
}) {
  const prev = await getActiveSurgeRule(input.routeBucket);
  const rule = await prisma.surgeRule.create({
    data: {
      routeBucket: input.routeBucket,
      capMultiplier: input.capMultiplier ?? env.SURGE_GLOBAL_CAP,
      timeFloors: input.timeFloors as unknown as Prisma.InputJsonValue,
      blackout: input.blackout ?? false,
      version: (prev?.version ?? 0) + 1,
      createdById: input.createdById,
    },
  });
  if (prev) {
    await prisma.surgeRule.update({ where: { id: prev.id }, data: { supersededById: rule.id } });
  }
  return rule;
}

/** Active manual override for a route bucket at a given instant, or null. */
export async function activeOverride(routeBucket: string, at: Date) {
  return prisma.surgeOverride.findFirst({
    where: { routeBucket, startsAt: { lte: at }, endsAt: { gte: at } },
    orderBy: { startsAt: 'desc' },
  });
}

/** Create a time-boxed override. */
export async function createOverride(input: {
  routeBucket: string;
  multiplier: number;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdById: string;
}) {
  return prisma.surgeOverride.create({ data: input });
}

/**
 * Resolve the surge multiplier for a pickup at an instant. Honours the global
 * feature flag and shadow mode (shadow → multiplier forced to floor but the
 * computed breakdown is preserved for analysis).
 */
export async function resolveSurgeForRoute(input: {
  pickupLat: number;
  pickupLng: number;
  at?: Date;
}): Promise<ResolvedRouteSurge> {
  const at = input.at ?? new Date();
  const routeBucket = routeBucketOf(input.pickupLat, input.pickupLng);

  if (!env.SURGE_ENABLED) {
    return {
      surgeMultiplier: DEFAULT_FLOOR,
      breakdown: { ratio: 0, demandSurge: DEFAULT_FLOOR, timeFloor: DEFAULT_FLOOR, capApplied: false, blackout: false, overrideApplied: false },
      routeBucket,
      ruleVersion: null,
      shadow: false,
    };
  }

  const [rule, override, demand, supply] = await Promise.all([
    getActiveSurgeRule(routeBucket),
    activeOverride(routeBucket, at),
    demandCount(routeBucket),
    supplyCount(routeBucket),
  ]);

  const timeFloors = (rule?.timeFloors as unknown as TimeFloor[] | undefined) ?? [];
  const timeFloor = floorForTimeBucket(timeFloors, dayTypeOf(at), hourBandOf(at));

  const result = resolveSurge({
    demand,
    supply,
    timeFloor,
    routeCapMultiplier: rule?.capMultiplier,
    blackout: rule?.blackout ?? false,
    override: override?.multiplier,
    globalCap: env.SURGE_GLOBAL_CAP,
    floor: env.SURGE_FLOOR,
  });

  if (env.SURGE_SHADOW_MODE) {
    return { surgeMultiplier: env.SURGE_FLOOR, breakdown: result.breakdown, routeBucket, ruleVersion: rule?.version ?? null, shadow: true };
  }
  return { ...result, routeBucket, ruleVersion: rule?.version ?? null, shadow: false };
}
