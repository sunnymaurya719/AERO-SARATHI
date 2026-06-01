import { describe, it, expect } from 'vitest';
import { evaluateFraud, type FraudPing } from '../src/modules/trips/fraud.js';

// Chandigarh → Ludhiana reference (~95 km road).
const PICKUP = { lat: 30.7333, lng: 76.7794 };
const DROP = { lat: 30.901, lng: 75.8573 };

function ping(over: Partial<FraudPing> & { tsOffsetSec: number }): FraudPing {
  return {
    ts: new Date(1_700_000_000_000 + over.tsOffsetSec * 1000),
    lat: over.lat ?? PICKUP.lat,
    lng: over.lng ?? PICKUP.lng,
    accuracyM: over.accuracyM ?? 10,
    speedKmh: over.speedKmh ?? 40,
  };
}

// Build a dense, clean track that roughly follows the route.
function cleanTrack(): FraudPing[] {
  const out: FraudPing[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    out.push(
      ping({
        tsOffsetSec: i * 30,
        lat: PICKUP.lat + ((DROP.lat - PICKUP.lat) * i) / steps,
        lng: PICKUP.lng + ((DROP.lng - PICKUP.lng) * i) / steps,
        speedKmh: 50,
      }),
    );
  }
  return out;
}

describe('evaluateFraud', () => {
  it('scores a clean trip near zero', () => {
    const r = evaluateFraud({ pings: cleanTrack(), pickup: PICKUP, drop: DROP, arrivedLoc: PICKUP, actualKm: 95, actualMin: 120 });
    expect(r.score).toBeLessThan(0.3);
  });

  it('flags teleport on impossible inter-ping speed', () => {
    const pings = [ping({ tsOffsetSec: 0 }), ping({ tsOffsetSec: 1, lat: 31.6, lng: 74.87 })];
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: null, actualKm: 95, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'teleport')).toBe(true);
  });

  it('caps teleport contribution at 0.6', () => {
    const pings: FraudPing[] = [];
    for (let i = 0; i < 10; i++) {
      pings.push(ping({ tsOffsetSec: i * 2, lat: i % 2 ? 31.6 : 30.7, lng: i % 2 ? 74.8 : 76.8 }));
    }
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: null, actualKm: 95, actualMin: 120 });
    const teleport = r.flags.filter((f) => f.type === 'teleport');
    expect(teleport.length).toBeGreaterThan(0);
  });

  it('flags out_of_country for a ping outside India', () => {
    const pings = [ping({ tsOffsetSec: 0 }), ping({ tsOffsetSec: 30, lat: 48.85, lng: 2.35 })];
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: null, actualKm: 95, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'out_of_country')).toBe(true);
  });

  it('flags arrived_far_from_pickup beyond 500m', () => {
    const far = { lat: PICKUP.lat + 0.02, lng: PICKUP.lng + 0.02 };
    const r = evaluateFraud({ pings: cleanTrack(), pickup: PICKUP, drop: DROP, arrivedLoc: far, actualKm: 95, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'arrived_far_from_pickup')).toBe(true);
  });

  it('flags completed_far_from_drop beyond 1km', () => {
    const pings = cleanTrack();
    pings[pings.length - 1] = ping({ tsOffsetSec: 9999, lat: DROP.lat + 0.05, lng: DROP.lng + 0.05 });
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: PICKUP, actualKm: 95, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'completed_far_from_drop')).toBe(true);
  });

  it('flags gps_gap on >60s gaps and caps at 0.3', () => {
    const pings = [
      ping({ tsOffsetSec: 0 }),
      ping({ tsOffsetSec: 200, lat: 30.74 }),
      ping({ tsOffsetSec: 500, lat: 30.75 }),
      ping({ tsOffsetSec: 900, lat: 30.76 }),
    ];
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: null, actualKm: 95, actualMin: 120 });
    const gap = r.flags.find((f) => f.type === 'gps_gap');
    expect(gap).toBeTruthy();
    expect(gap!.weight).toBeLessThanOrEqual(0.3);
  });

  it('flags straight_line_distance_ratio when actualKm is impossibly short', () => {
    const r = evaluateFraud({ pings: cleanTrack(), pickup: PICKUP, drop: DROP, arrivedLoc: PICKUP, actualKm: 1, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'straight_line_distance_ratio')).toBe(true);
  });

  it('flags high_speed_sustained when median speed >140 in a window', () => {
    const pings: FraudPing[] = [];
    for (let i = 0; i < 5; i++) pings.push(ping({ tsOffsetSec: i * 10, lat: 30.73 + i * 0.001, speedKmh: 160 }));
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: null, actualKm: 95, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'high_speed_sustained')).toBe(true);
  });

  it('flags low_ping_count for sparse tracks', () => {
    const pings = [ping({ tsOffsetSec: 0 }), ping({ tsOffsetSec: 30, lat: 30.74 })];
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: null, actualKm: 95, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'low_ping_count')).toBe(true);
  });

  it('flags accuracy_consistently_bad when median accuracy >100m', () => {
    const pings = cleanTrack().map((p) => ({ ...p, accuracyM: 180 }));
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: PICKUP, actualKm: 95, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'accuracy_consistently_bad')).toBe(true);
  });

  it('clamps the final score to [0,1]', () => {
    const pings: FraudPing[] = [];
    for (let i = 0; i < 6; i++) pings.push(ping({ tsOffsetSec: i, lat: i % 2 ? 48.8 : 30.7, lng: i % 2 ? 2.3 : 76.8, accuracyM: 190, speedKmh: 199 }));
    const r = evaluateFraud({ pings, pickup: PICKUP, drop: DROP, arrivedLoc: { lat: 31.0, lng: 77.0 }, actualKm: 0.5, actualMin: 120 });
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('returns no flags for an empty ping list', () => {
    const r = evaluateFraud({ pings: [], pickup: PICKUP, drop: DROP, arrivedLoc: null, actualKm: 95, actualMin: 0 });
    expect(r.score).toBe(0);
    expect(r.flags).toHaveLength(0);
  });

  it('does not flag teleport for normal driving speeds', () => {
    const r = evaluateFraud({ pings: cleanTrack(), pickup: PICKUP, drop: DROP, arrivedLoc: PICKUP, actualKm: 95, actualMin: 120 });
    expect(r.flags.some((f) => f.type === 'teleport')).toBe(false);
  });

  it('produces a higher score for an obviously fraudulent trip than a clean one', () => {
    const clean = evaluateFraud({ pings: cleanTrack(), pickup: PICKUP, drop: DROP, arrivedLoc: PICKUP, actualKm: 95, actualMin: 120 });
    const dirtyPings = [ping({ tsOffsetSec: 0 }), ping({ tsOffsetSec: 1, lat: 31.6, lng: 74.8 })];
    const dirty = evaluateFraud({ pings: dirtyPings, pickup: PICKUP, drop: DROP, arrivedLoc: null, actualKm: 1, actualMin: 120 });
    expect(dirty.score).toBeGreaterThan(clean.score);
  });
});
