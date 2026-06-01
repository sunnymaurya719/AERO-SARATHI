import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  homeScore,
  scoreOne,
  rankCandidates,
  DEFAULT_WEIGHTS,
  type MatchCandidate,
  type MatchBooking,
} from '../src/modules/assignment/matching.js';

// Chandigarh-ish pickup
const booking: MatchBooking = { pickupLat: 30.7333, pickupLng: 76.7794, pickupCity: 'Chandigarh' };

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    driverId: 'd-1',
    rating: 4.5,
    homeCity: 'Chandigarh',
    lastLocation: { lat: 30.7333, lng: 76.7794, ageSec: 10 },
    idleMin: 60,
    acceptanceRate: 0.8,
    offersHistorical: 100,
    recentDeclineMin: null,
    ...overrides,
  };
}

describe('haversineKm', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineKm(30.7, 76.7, 30.7, 76.7)).toBeCloseTo(0, 5);
  });

  it('computes a known distance (Chandigarh→Amritsar ~190km)', () => {
    const km = haversineKm(30.7333, 76.7794, 31.634, 74.8723);
    expect(km).toBeGreaterThan(180);
    expect(km).toBeLessThan(210);
  });
});

describe('homeScore', () => {
  it('is 1.0 for same city', () => {
    expect(homeScore('Chandigarh', 'Chandigarh')).toBe(1);
  });
  it('is 0.5 for adjacent city', () => {
    expect(homeScore('Chandigarh', 'Mohali')).toBe(0.5);
  });
  it('is 0 for unrelated city', () => {
    expect(homeScore('Amritsar', 'Chandigarh')).toBe(0);
  });
});

describe('scoreOne — proximity boundaries', () => {
  it('scores proximity 1.0 at distance 0', () => {
    const { breakdown } = scoreOne(candidate(), booking);
    expect(breakdown.proximity).toBeCloseTo(1, 2);
  });

  it('scores proximity ~0.5 at ~25km', () => {
    // a point ~25km away
    const far = candidate({ lastLocation: { lat: 30.95, lng: 76.78, ageSec: 10 } });
    const { breakdown } = scoreOne(far, booking);
    expect(breakdown.proximity).toBeGreaterThan(0.4);
    expect(breakdown.proximity).toBeLessThan(0.6);
  });

  it('scores proximity 0 beyond 50km', () => {
    const far = candidate({ lastLocation: { lat: 31.634, lng: 74.8723, ageSec: 10 } });
    const { breakdown } = scoreOne(far, booking);
    expect(breakdown.proximity).toBe(0);
  });

  it('treats stale location (age>300s) as neutral-low (50km → proximity 0)', () => {
    const stale = candidate({ lastLocation: { lat: 30.7333, lng: 76.7794, ageSec: 400 } });
    const { breakdown } = scoreOne(stale, booking);
    expect(breakdown.proximity).toBe(0);
  });

  it('treats missing location as neutral-low', () => {
    const none = candidate({ lastLocation: null });
    const { breakdown } = scoreOne(none, booking);
    expect(breakdown.proximity).toBe(0);
  });
});

describe('scoreOne — components', () => {
  it('normalises rating to 0..1', () => {
    const { breakdown } = scoreOne(candidate({ rating: 5 }), booking);
    expect(breakdown.rating).toBe(1);
  });

  it('uses neutral rating when rating is null', () => {
    const { breakdown } = scoreOne(candidate({ rating: null }), booking);
    expect(breakdown.rating).toBe(0.6);
  });

  it('caps idle score at 1.0 (>=120 min)', () => {
    const { breakdown } = scoreOne(candidate({ idleMin: 240 }), booking);
    expect(breakdown.idle).toBe(1);
  });

  it('scores idle 0 when just became idle', () => {
    const { breakdown } = scoreOne(candidate({ idleMin: 0 }), booking);
    expect(breakdown.idle).toBe(0);
  });

  it('gives neutral history (0.5) to drivers with <5 offers', () => {
    const { breakdown } = scoreOne(candidate({ offersHistorical: 3, acceptanceRate: 0.1 }), booking);
    expect(breakdown.history).toBe(0.5);
  });

  it('uses real acceptance rate when >=5 offers', () => {
    const { breakdown } = scoreOne(candidate({ offersHistorical: 50, acceptanceRate: 0.42 }), booking);
    expect(breakdown.history).toBeCloseTo(0.42, 5);
  });
});

describe('scoreOne — recent-decline penalty', () => {
  it('applies penalty within 60 min', () => {
    const withPenalty = scoreOne(candidate({ recentDeclineMin: 30 }), booking);
    const without = scoreOne(candidate({ recentDeclineMin: null }), booking);
    expect(withPenalty.breakdown.penaltyRecentDecline).toBe(0.2);
    expect(withPenalty.score).toBeLessThan(without.score);
  });

  it('does not apply penalty after 60 min', () => {
    const { breakdown } = scoreOne(candidate({ recentDeclineMin: 90 }), booking);
    expect(breakdown.penaltyRecentDecline).toBe(0);
  });

  it('clamps final score to >= 0 even with penalty', () => {
    const bad = scoreOne(
      candidate({
        rating: 1,
        idleMin: 0,
        homeCity: 'Amritsar',
        offersHistorical: 50,
        acceptanceRate: 0,
        lastLocation: null,
        recentDeclineMin: 1,
      }),
      booking,
    );
    expect(bad.score).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreOne — weight normalisation', () => {
  it('normalises weights that do not sum to 1', () => {
    const doubled = scoreOne(candidate(), booking, {
      distance: 0.8,
      rating: 0.3,
      idle: 0.3,
      home: 0.3,
      history: 0.3,
    });
    const normal = scoreOne(candidate(), booking, DEFAULT_WEIGHTS);
    // distance weight is proportionally the same (0.8/2.0 == 0.40/1.0)
    expect(doubled.score).toBeCloseTo(normal.score, 5);
  });

  it('produces a score within 0..100', () => {
    const { score } = scoreOne(candidate(), booking);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('rankCandidates', () => {
  it('returns empty for empty pool', () => {
    expect(rankCandidates([], booking)).toEqual([]);
  });

  it('handles a single candidate', () => {
    const ranked = rankCandidates([candidate()], booking);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.driverId).toBe('d-1');
  });

  it('orders by score descending', () => {
    const near = candidate({ driverId: 'near', lastLocation: { lat: 30.7333, lng: 76.7794, ageSec: 5 } });
    const far = candidate({ driverId: 'far', lastLocation: { lat: 31.2, lng: 76.7794, ageSec: 5 } });
    const ranked = rankCandidates([far, near], booking);
    expect(ranked[0]!.driverId).toBe('near');
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
  });

  it('breaks ties by lower driverId (deterministic)', () => {
    const a = candidate({ driverId: 'aaa' });
    const b = candidate({ driverId: 'bbb' });
    const ranked = rankCandidates([b, a], booking);
    expect(ranked[0]!.driverId).toBe('aaa');
    expect(ranked[1]!.driverId).toBe('bbb');
  });

  it('orders 50 candidates deterministically across runs', () => {
    const pool: MatchCandidate[] = Array.from({ length: 50 }, (_, i) =>
      candidate({ driverId: `d-${String(i).padStart(2, '0')}`, idleMin: i }),
    );
    const r1 = rankCandidates([...pool], booking).map((r) => r.driverId);
    const r2 = rankCandidates([...pool].reverse(), booking).map((r) => r.driverId);
    expect(r1).toEqual(r2);
  });

  it('ranks a closer + home-city + high-acceptance driver first', () => {
    const best = candidate({ driverId: 'best' });
    const worst = candidate({
      driverId: 'worst',
      homeCity: 'Ludhiana',
      rating: 2,
      acceptanceRate: 0.1,
      lastLocation: { lat: 31.0, lng: 76.7794, ageSec: 5 },
    });
    const ranked = rankCandidates([worst, best], booking);
    expect(ranked[0]!.driverId).toBe('best');
  });
});
