/**
 * Dynamic pricing v1 — pure, deterministic surge math (Phase 6 §5).
 *
 * The repo has no `apps/algo` service; like Phase 4's matching, surge lives as a
 * pure TypeScript module inside the API. The service layer reads demand/supply
 * from Redis and the route cap / time floors from `SurgeRule`, then calls
 * `resolveSurge`. Nothing here touches I/O, so it is fully unit-tested.
 */

export type DayType = 'WEEKDAY' | 'WEEKEND' | 'HOLIDAY';
export type HourBand = '0-5' | '5-8' | '8-17' | '17-21' | '21-24';

export interface TimeFloor {
  dayType: DayType;
  hourBand: HourBand;
  floor: number;
}

export interface SurgeInput {
  demand: number;
  supply: number;
  /** Floor forced by the time bucket (e.g. evening peak ≥ 1.1x). Default 1.0. */
  timeFloor?: number;
  /** Per-route cap. Clamped to the global cap. Default = globalCap. */
  routeCapMultiplier?: number;
  /** Festival/goodwill: force exactly 1.0x. */
  blackout?: boolean;
  /** Manual admin override — still transparent, still capped. */
  override?: number | null;
  globalCap?: number;
  floor?: number;
}

export interface SurgeBreakdown {
  ratio: number;
  demandSurge: number;
  timeFloor: number;
  capApplied: boolean;
  blackout: boolean;
  overrideApplied: boolean;
}

export interface SurgeResult {
  surgeMultiplier: number;
  breakdown: SurgeBreakdown;
}

export const DEFAULT_GLOBAL_CAP = 1.8;
export const DEFAULT_FLOOR = 1.0;

/** Round a multiplier to 2 decimals (avoids float noise like 1.2500000001). */
export function roundMultiplier(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Demand/supply ratio → surge step (Phase 6 §5.2 table). */
export function demandSurgeStep(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio < 0.8) return 1.0;
  if (ratio < 1.2) return 1.1;
  if (ratio < 1.8) return 1.25;
  if (ratio < 2.5) return 1.4;
  if (ratio < 3.5) return 1.6;
  return 1.8;
}

/** demand / max(supply, 1) — never divides by zero. */
export function demandSupplyRatio(demand: number, supply: number): number {
  const d = Number.isFinite(demand) && demand > 0 ? demand : 0;
  const s = Number.isFinite(supply) && supply > 0 ? supply : 0;
  return d / Math.max(s, 1);
}

export function dayTypeOf(date: Date, holiday = false): DayType {
  if (holiday) return 'HOLIDAY';
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  return day === 0 || day === 6 ? 'WEEKEND' : 'WEEKDAY';
}

export function hourBandOf(date: Date): HourBand {
  const h = date.getUTCHours();
  if (h < 5) return '0-5';
  if (h < 8) return '5-8';
  if (h < 17) return '8-17';
  if (h < 21) return '17-21';
  return '21-24';
}

/** Look up the configured floor for a given day/hour bucket. Default 1.0. */
export function floorForTimeBucket(floors: TimeFloor[], dayType: DayType, hourBand: HourBand): number {
  const match = floors.find((f) => f.dayType === dayType && f.hourBand === hourBand);
  return match ? match.floor : 1.0;
}

/**
 * Resolve the final surge multiplier. Order of precedence:
 *   blackout → 1.0
 *   else max(demandSurge, timeFloor), or override if set
 *   → clamp to min(routeCap, globalCap)
 *   → clamp to floor below.
 */
export function resolveSurge(input: SurgeInput): SurgeResult {
  const globalCap = input.globalCap ?? DEFAULT_GLOBAL_CAP;
  const floor = input.floor ?? DEFAULT_FLOOR;
  const timeFloor = input.timeFloor ?? 1.0;
  const ratio = demandSupplyRatio(input.demand, input.supply);
  const demandSurge = demandSurgeStep(ratio);

  if (input.blackout) {
    return {
      surgeMultiplier: roundMultiplier(floor),
      breakdown: { ratio, demandSurge, timeFloor, capApplied: false, blackout: true, overrideApplied: false },
    };
  }

  const overrideApplied = input.override != null && Number.isFinite(input.override);
  let target = overrideApplied ? (input.override as number) : Math.max(demandSurge, timeFloor);

  const cap = Math.min(input.routeCapMultiplier ?? globalCap, globalCap);
  const capApplied = target > cap;
  target = Math.min(target, cap);
  target = Math.max(target, floor);

  return {
    surgeMultiplier: roundMultiplier(target),
    breakdown: { ratio, demandSurge, timeFloor, capApplied, blackout: false, overrideApplied },
  };
}

/** Apply a multiplier to a base fare (paise or rupees-int), rounded to nearest unit. */
export function applySurge(baseFare: number, multiplier: number): number {
  return Math.round(baseFare * multiplier);
}
