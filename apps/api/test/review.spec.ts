import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  reviewFindUnique: vi.fn(),
  reviewCreate: vi.fn(),
  reviewAggregate: vi.fn(),
  driverFindUnique: vi.fn(),
  driverUpdate: vi.fn(),
  alertCreate: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    booking: { findUnique: h.bookingFindUnique },
    review: { findUnique: h.reviewFindUnique, create: h.reviewCreate, aggregate: h.reviewAggregate },
    driver: { findUnique: h.driverFindUnique, update: h.driverUpdate },
    systemAlert: { create: h.alertCreate },
  },
}));
vi.mock('../src/env.js', () => ({
  env: {
    LOG_LEVEL: 'silent',
    REVIEWS_ENABLED: true,
    RATING_SMOOTHING_C: 20,
    RATING_GLOBAL_MEAN: 4.6,
    RATING_LOW_THRESHOLD: 3.5,
    REVIEW_WINDOW_DAYS: 7,
  },
}));
vi.mock('@aero/db', () => ({ Prisma: {} }));

import {
  bayesianRating,
  roundRating,
  containsProfanity,
  withinReviewWindow,
  submitReview,
  recomputeDriverRating,
} from '../src/modules/review/review.service.js';

describe('bayesianRating (pure)', () => {
  it('returns the prior mean with no reviews', () => {
    expect(bayesianRating(0, 0, 20, 4.6)).toBe(4.6);
  });
  it('pulls toward the prior with few reviews', () => {
    const r = bayesianRating(5, 1, 20, 4.6); // (92+5)/21 ≈ 4.619
    expect(r).toBeCloseTo(4.619, 2);
  });
  it('approaches the sample mean with many reviews', () => {
    const r = bayesianRating(300, 100, 20, 4.6); // (92+300)/120 ≈ 3.27
    expect(r).toBeCloseTo(3.27, 2);
  });
});

describe('pure helpers', () => {
  it('rounds to 2 decimals', () => {
    expect(roundRating(4.61904)).toBe(4.62);
  });
  it('flags profanity', () => {
    expect(containsProfanity('this is shit')).toBe(true);
    expect(containsProfanity('great ride')).toBe(false);
    expect(containsProfanity(null)).toBe(false);
  });
  it('checks the window', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    expect(withinReviewWindow(new Date('2026-01-08T00:00:00Z'), now, 7)).toBe(true);
    expect(withinReviewWindow(new Date('2026-01-01T00:00:00Z'), now, 7)).toBe(false);
  });
});

describe('submitReview', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));

  it('rejects out-of-range stars', async () => {
    await expect(
      submitReview({ bookingId: 'b1', direction: 'DRIVER_TO_CUSTOMER', raterId: 'd', rateeId: 'c', stars: 6 }),
    ).rejects.toThrow();
  });

  it('rejects when booking not completed', async () => {
    h.bookingFindUnique.mockResolvedValue({ status: 'CONFIRMED', completedAt: null });
    await expect(
      submitReview({ bookingId: 'b1', direction: 'DRIVER_TO_CUSTOMER', raterId: 'd', rateeId: 'c', stars: 5 }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate review', async () => {
    h.bookingFindUnique.mockResolvedValue({ status: 'COMPLETED', completedAt: new Date() });
    h.reviewFindUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      submitReview({ bookingId: 'b1', direction: 'DRIVER_TO_CUSTOMER', raterId: 'd', rateeId: 'c', stars: 5 }),
    ).rejects.toThrow();
  });

  it('creates the review and hides profane text', async () => {
    h.bookingFindUnique.mockResolvedValue({ status: 'COMPLETED', completedAt: new Date() });
    h.reviewFindUnique.mockResolvedValue(null);
    h.reviewCreate.mockResolvedValue({ id: 'rev-1' });
    const r = await submitReview({
      bookingId: 'b1',
      direction: 'DRIVER_TO_CUSTOMER',
      raterId: 'd',
      rateeId: 'c',
      stars: 5,
      text: 'what a bitch',
    });
    expect(r.id).toBe('rev-1');
    const arg = h.reviewCreate.mock.calls[0]![0] as { data: { hidden: boolean } };
    expect(arg.data.hidden).toBe(true);
  });
});

describe('recomputeDriverRating', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));

  it('writes the smoothed rating and no alert when healthy', async () => {
    h.driverFindUnique.mockResolvedValue({ id: 'd1' });
    h.reviewAggregate
      .mockResolvedValueOnce({ _sum: { stars: 92 }, _count: 20 })
      .mockResolvedValueOnce({ _sum: { stars: 46 }, _count: 10 });
    await recomputeDriverRating('d1');
    const arg = h.driverUpdate.mock.calls[0]![0] as { data: { ratingCount: number } };
    expect(arg.data.ratingCount).toBe(20);
    expect(h.alertCreate).not.toHaveBeenCalled();
  });

  it('raises a LOW_RATING alert when persistently low', async () => {
    h.driverFindUnique.mockResolvedValue({ id: 'd1' });
    h.reviewAggregate
      .mockResolvedValueOnce({ _sum: { stars: 40 }, _count: 25 }) // (92+40)/45 ≈ 2.93
      .mockResolvedValueOnce({ _sum: { stars: 10 }, _count: 5 });
    await recomputeDriverRating('d1');
    expect(h.alertCreate).toHaveBeenCalledOnce();
    const arg = h.alertCreate.mock.calls[0]![0] as { data: { type: string } };
    expect(arg.data.type).toBe('LOW_RATING');
  });
});
