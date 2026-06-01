import type { MatchingWeights, RankedCandidate, ScoreBreakdown } from '@aero/types';

/**
 * Pure deterministic driver-matching score (Phase 4 §6.2).
 *
 * Implemented in TypeScript inside the API rather than a separate Python `algo`
 * service: it is IO-free, easy to unit-test, and avoids a network hop on the
 * critical assignment path. ML-based scoring is deferred to Phase 8.
 */

export const DEFAULT_WEIGHTS: MatchingWeights = {
  distance: 0.4,
  rating: 0.15,
  idle: 0.15,
  home: 0.15,
  history: 0.15,
};

export const DEFAULT_PENALTY_RECENT_DECLINE = 0.2;

/** Adjacent-city lookup for the home-city score. Extend as coverage grows. */
export const ADJACENT_CITIES: Record<string, ReadonlySet<string>> = {
  Chandigarh: new Set(['Mohali', 'Panchkula', 'Zirakpur']),
  Mohali: new Set(['Chandigarh', 'Zirakpur', 'Panchkula']),
  Panchkula: new Set(['Chandigarh', 'Zirakpur', 'Mohali']),
  Zirakpur: new Set(['Chandigarh', 'Mohali', 'Panchkula']),
  Amritsar: new Set(['Tarn Taran', 'Batala']),
  Ludhiana: new Set(['Khanna', 'Jagraon']),
  Jalandhar: new Set(['Phagwara', 'Kapurthala']),
};

export interface CandidateLocation {
  lat: number;
  lng: number;
  ageSec: number;
}

export interface MatchCandidate {
  driverId: string;
  rating: number | null; // 1..5
  homeCity: string;
  lastLocation: CandidateLocation | null;
  idleMin: number;
  acceptanceRate: number; // 0..1
  offersHistorical: number;
  recentDeclineMin: number | null; // minutes since last decline, null = none
}

export interface MatchBooking {
  pickupLat: number;
  pickupLng: number;
  pickupCity: string;
}

const EARTH_RADIUS_KM = 6371.0;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export function homeScore(driverHome: string, pickupCity: string): number {
  if (driverHome === pickupCity) return 1.0;
  if (ADJACENT_CITIES[driverHome]?.has(pickupCity)) return 0.5;
  return 0.0;
}

/** Score one candidate. Returns score (0..100) and the component breakdown. */
export function scoreOne(
  c: MatchCandidate,
  booking: MatchBooking,
  weights: MatchingWeights = DEFAULT_WEIGHTS,
  penalty: number = DEFAULT_PENALTY_RECENT_DECLINE,
): { score: number; breakdown: ScoreBreakdown } {
  // Normalise weights so callers may pass weights that don't sum to 1.
  const wSum = weights.distance + weights.rating + weights.idle + weights.home + weights.history;
  const norm = wSum > 0 ? wSum : 1;
  const w = {
    distance: weights.distance / norm,
    rating: weights.rating / norm,
    idle: weights.idle / norm,
    home: weights.home / norm,
    history: weights.history / norm,
  };

  const distKm =
    c.lastLocation && c.lastLocation.ageSec <= 300
      ? haversineKm(c.lastLocation.lat, c.lastLocation.lng, booking.pickupLat, booking.pickupLng)
      : 50.0; // unknown/stale location → neutral-low

  const proximity = Math.max(0, 1 - distKm / 50);
  const rating = c.rating == null ? 0.6 : clamp01(c.rating / 5);
  const idle = clamp01(Math.max(0, c.idleMin) / 120);
  const home = homeScore(c.homeCity, booking.pickupCity);
  const history = c.offersHistorical < 5 ? 0.5 : clamp01(c.acceptanceRate);

  let raw =
    w.distance * proximity + w.rating * rating + w.idle * idle + w.home * home + w.history * history;

  const penaltyApplied = c.recentDeclineMin != null && c.recentDeclineMin <= 60 ? penalty : 0;
  raw -= penaltyApplied;

  const score = clamp01(raw) * 100;
  return {
    score,
    breakdown: { proximity, rating, idle, home, history, penaltyRecentDecline: penaltyApplied },
  };
}

/**
 * Rank candidates by score (desc). Ties broken by lower driverId for
 * determinism (Phase 4 §6.2).
 */
export function rankCandidates(
  candidates: MatchCandidate[],
  booking: MatchBooking,
  weights: MatchingWeights = DEFAULT_WEIGHTS,
  penalty: number = DEFAULT_PENALTY_RECENT_DECLINE,
): RankedCandidate[] {
  return candidates
    .map((c) => {
      const { score, breakdown } = scoreOne(c, booking, weights, penalty);
      return { driverId: c.driverId, score, breakdown };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.driverId < b.driverId ? -1 : a.driverId > b.driverId ? 1 : 0;
    });
}
