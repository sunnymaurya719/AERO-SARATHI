import { describe, it, expect } from 'vitest';
import { computeCancellation } from '../src/modules/cancellations/policy.js';

const TOKEN = 100_000; // ₹1000 in paise

// Fixed "now" so tests are deterministic.
const now = new Date('2025-06-01T12:00:00.000Z');

function createdMinAgo(min: number): Date {
  return new Date(now.getTime() - min * 60_000);
}
function tripInHours(h: number): Date {
  return new Date(now.getTime() + h * 3_600_000);
}

describe('computeCancellation', () => {
  it('GRACE_30_MIN: free full refund within 30 min of booking', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(10), tripInHours(48), now);
    expect(q.bucket).toBe('GRACE_30_MIN');
    expect(q.feeAmount).toBe(0);
    expect(q.refundAmount).toBe(TOKEN);
  });

  it('GRACE_30_MIN: exactly 30 min still grace', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(30), tripInHours(48), now);
    expect(q.bucket).toBe('GRACE_30_MIN');
  });

  it('FLAT_200: >24h before trip, flat ₹200 fee', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(120), tripInHours(48), now);
    expect(q.bucket).toBe('FLAT_200');
    expect(q.feeAmount).toBe(20_000);
    expect(q.refundAmount).toBe(TOKEN - 20_000);
  });

  it('FLAT_200: fee capped at token paid when token < ₹200', () => {
    const q = computeCancellation(15_000, createdMinAgo(120), tripInHours(48), now);
    expect(q.bucket).toBe('FLAT_200');
    expect(q.feeAmount).toBe(15_000);
    expect(q.refundAmount).toBe(0);
  });

  it('FLAT_200: exactly 24h to trip', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(120), tripInHours(24), now);
    expect(q.bucket).toBe('FLAT_200');
  });

  it('PCT_25: between 6 and 24h, 25% fee', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(120), tripInHours(12), now);
    expect(q.bucket).toBe('PCT_25');
    expect(q.feeAmount).toBe(25_000);
    expect(q.refundAmount).toBe(75_000);
  });

  it('PCT_25: exactly 6h to trip', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(120), tripInHours(6), now);
    expect(q.bucket).toBe('PCT_25');
  });

  it('PCT_100: under 6h to trip, no refund', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(120), tripInHours(3), now);
    expect(q.bucket).toBe('PCT_100');
    expect(q.feeAmount).toBe(TOKEN);
    expect(q.refundAmount).toBe(0);
  });

  it('NO_SHOW: trip time has passed', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(120), tripInHours(-1), now);
    expect(q.bucket).toBe('NO_SHOW');
    expect(q.feeAmount).toBe(TOKEN);
    expect(q.refundAmount).toBe(0);
  });

  it('NO_SHOW: exactly T=0 counts as no-show', () => {
    const q = computeCancellation(TOKEN, createdMinAgo(120), tripInHours(0), now);
    expect(q.bucket).toBe('NO_SHOW');
  });

  it('handles token=0 gracefully', () => {
    const q = computeCancellation(0, createdMinAgo(120), tripInHours(12), now);
    expect(q.feeAmount).toBe(0);
    expect(q.refundAmount).toBe(0);
  });
});
