import { haversineKm, haversineM, insideIndia, type LatLng } from '../tracking/geo.js';
import type { FraudFlag } from '@aero/types';

/**
 * Anti-fraud heuristics (Phase 5 §9). Pure functions over a trip's pings + the
 * pickup/drop reference points. Each flag carries a weight; the weighted sum is
 * clamped to [0,1] to form `fraudScore`. Score > review threshold → PENDING_REVIEW.
 */

export interface FraudPing {
  ts: Date;
  lat: number;
  lng: number;
  accuracyM: number;
  speedKmh: number | null;
}

export interface FraudInput {
  pings: FraudPing[];
  pickup: LatLng;
  drop: LatLng;
  arrivedLoc: LatLng | null;
  actualKm: number;
  actualMin: number;
}

export interface FraudResult {
  score: number; // 0..1
  flags: FraudFlag[];
}

const MAX_SPEED_KMH = 200;

export function evaluateFraud(input: FraudInput): FraudResult {
  const flags: FraudFlag[] = [];
  const { pings } = input;

  // teleport — impossible inter-ping speeds (cap contribution at 0.6).
  let teleportContribution = 0;
  for (let i = 1; i < pings.length; i++) {
    const prev = pings[i - 1]!;
    const cur = pings[i]!;
    const dtSec = (cur.ts.getTime() - prev.ts.getTime()) / 1000;
    if (dtSec <= 0) continue;
    const km = haversineKm(prev, cur);
    const kmh = (km / dtSec) * 3600;
    if (kmh > MAX_SPEED_KMH) {
      teleportContribution = Math.min(0.6, teleportContribution + 0.4);
      flags.push({ type: 'teleport', detail: `${kmh.toFixed(0)} km/h between pings`, weight: 0.4 });
    }
  }

  // out_of_country
  if (pings.some((p) => !insideIndia(p))) {
    flags.push({ type: 'out_of_country', detail: 'ping outside India bbox', weight: 0.5 });
  }

  // arrived_far_from_pickup
  if (input.arrivedLoc) {
    const m = haversineM(input.arrivedLoc, input.pickup);
    if (m > 500) {
      flags.push({ type: 'arrived_far_from_pickup', detail: `${m.toFixed(0)}m from pickup`, weight: 0.2 });
    }
  }

  // completed_far_from_drop
  const last = pings[pings.length - 1];
  if (last) {
    const m = haversineM(last, input.drop);
    if (m > 1000) {
      flags.push({ type: 'completed_far_from_drop', detail: `${m.toFixed(0)}m from drop`, weight: 0.2 });
    }
  }

  // gps_gap — inter-ping gaps > 60s during the trip (cap 0.3)
  let gapContribution = 0;
  let gaps = 0;
  for (let i = 1; i < pings.length; i++) {
    const dtSec = (pings[i]!.ts.getTime() - pings[i - 1]!.ts.getTime()) / 1000;
    if (dtSec > 60) {
      gaps += 1;
      gapContribution = Math.min(0.3, gapContribution + 0.05);
    }
  }
  if (gaps > 0) {
    flags.push({ type: 'gps_gap', detail: `${gaps} gaps > 60s`, weight: gapContribution });
  }

  // straight_line_distance_ratio — actualKm impossibly short vs straight line
  const straightKm = haversineKm(input.pickup, input.drop);
  if (straightKm > 0 && input.actualKm < straightKm * 0.9) {
    flags.push({
      type: 'straight_line_distance_ratio',
      detail: `actual ${input.actualKm.toFixed(1)}km < straight ${straightKm.toFixed(1)}km`,
      weight: 0.2,
    });
  }

  // high_speed_sustained — median speed in any 60s window > 140 km/h
  if (hasSustainedHighSpeed(pings, 140, 60)) {
    flags.push({ type: 'high_speed_sustained', detail: 'median > 140 km/h in a 60s window', weight: 0.3 });
  }

  // low_ping_count — fewer than 30% of expected pings (12/min ideal)
  const expected = input.actualMin * 12 * 0.3;
  if (expected > 1 && pings.length < expected) {
    flags.push({
      type: 'low_ping_count',
      detail: `${pings.length} pings < expected ${expected.toFixed(0)}`,
      weight: 0.2,
    });
  }

  // accuracy_consistently_bad — median accuracy > 100m
  const acc = pings.map((p) => p.accuracyM).filter((n) => Number.isFinite(n));
  if (acc.length > 0 && median(acc) > 100) {
    flags.push({ type: 'accuracy_consistently_bad', detail: 'median accuracy > 100m', weight: 0.1 });
  }

  const score = Math.min(1, flags.reduce((sum, f) => sum + f.weight, 0));
  return { score, flags };
}

function hasSustainedHighSpeed(pings: FraudPing[], thresholdKmh: number, windowSec: number): boolean {
  const speeds = pings
    .filter((p) => p.speedKmh != null)
    .map((p) => ({ ts: p.ts.getTime(), v: p.speedKmh as number }));
  for (let i = 0; i < speeds.length; i++) {
    const windowVals: number[] = [];
    for (let j = i; j < speeds.length; j++) {
      if ((speeds[j]!.ts - speeds[i]!.ts) / 1000 > windowSec) break;
      windowVals.push(speeds[j]!.v);
    }
    if (windowVals.length >= 3 && median(windowVals) > thresholdKmh) return true;
  }
  return false;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
