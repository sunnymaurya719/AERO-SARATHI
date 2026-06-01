import { describe, it, expect } from 'vitest';
import {
  checkEligibility,
  isEligible,
  CRITICAL_DOC_TYPES,
  type EligDriver,
  type EligContext,
  type EligDoc,
} from '../src/modules/assignment/eligibility.js';

const NOW = new Date('2026-06-01T10:00:00.000Z');
const SCHEDULED = new Date('2026-06-01T13:00:00.000Z');

function goodDocs(): EligDoc[] {
  return CRITICAL_DOC_TYPES.map((type) => ({
    type,
    verified: true,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    deletedAt: null,
  }));
}

function baseDriver(overrides: Partial<EligDriver> = {}): EligDriver {
  return {
    status: 'ACTIVE',
    availability: 'ONLINE',
    lastSeenAt: new Date(NOW.getTime() - 30_000),
    vehicleCategory: 'SEDAN',
    documents: goodDocs(),
    hasOpenOfferElsewhere: false,
    hasOverlappingAssignment: false,
    declinedOrExpiredThisBooking: false,
    ...overrides,
  };
}

const ctx: EligContext = { vehicleCategory: 'SEDAN', scheduledAt: SCHEDULED, now: NOW };

function reasonOf(d: EligDriver, c: EligContext = ctx): string | null {
  const r = checkEligibility(d, c);
  return r.eligible ? null : r.reason;
}

describe('checkEligibility', () => {
  it('accepts a fully eligible driver', () => {
    expect(checkEligibility(baseDriver(), ctx)).toEqual({ eligible: true });
    expect(isEligible(baseDriver(), ctx)).toBe(true);
  });

  it('rejects a non-active driver', () => {
    expect(checkEligibility(baseDriver({ status: 'SUSPENDED' }), ctx)).toEqual({
      eligible: false,
      reason: 'driver_not_active',
    });
  });

  it('rejects an offline driver', () => {
    expect(checkEligibility(baseDriver({ availability: 'OFFLINE' }), ctx)).toEqual({
      eligible: false,
      reason: 'driver_offline',
    });
  });

  it('rejects a busy driver', () => {
    expect(checkEligibility(baseDriver({ availability: 'BUSY' }), ctx).eligible).toBe(false);
  });

  it('rejects a driver with no heartbeat', () => {
    expect(checkEligibility(baseDriver({ lastSeenAt: null }), ctx)).toEqual({
      eligible: false,
      reason: 'heartbeat_stale',
    });
  });

  it('rejects a driver with a stale heartbeat (>120s)', () => {
    const stale = new Date(NOW.getTime() - 121_000);
    expect(reasonOf(baseDriver({ lastSeenAt: stale }))).toBe('heartbeat_stale');
  });

  it('honours a custom heartbeat max age', () => {
    const stale = new Date(NOW.getTime() - 91_000);
    expect(reasonOf(baseDriver({ lastSeenAt: stale }), { ...ctx, heartbeatMaxAgeSec: 90 })).toBe(
      'heartbeat_stale',
    );
  });

  it('rejects a driver with no vehicle', () => {
    expect(checkEligibility(baseDriver({ vehicleCategory: null }), ctx)).toEqual({
      eligible: false,
      reason: 'no_vehicle',
    });
  });

  it('rejects a vehicle category mismatch', () => {
    expect(checkEligibility(baseDriver({ vehicleCategory: 'SUV' }), ctx)).toEqual({
      eligible: false,
      reason: 'vehicle_category_mismatch',
    });
  });

  it('rejects when a critical doc is missing', () => {
    const docs = goodDocs().filter((d) => d.type !== 'PERMIT');
    expect(checkEligibility(baseDriver({ documents: docs }), ctx)).toEqual({
      eligible: false,
      reason: 'missing_doc_PERMIT',
    });
  });

  it('rejects when a critical doc is unverified', () => {
    const docs = goodDocs().map((d) => (d.type === 'RC' ? { ...d, verified: false } : d));
    expect(reasonOf(baseDriver({ documents: docs }))).toBe('unverified_doc_RC');
  });

  it('rejects when a critical doc expires before the trip', () => {
    const docs = goodDocs().map((d) =>
      d.type === 'INSURANCE' ? { ...d, expiresAt: new Date('2026-05-31T00:00:00.000Z') } : d,
    );
    expect(reasonOf(baseDriver({ documents: docs }))).toBe('expired_doc_INSURANCE');
  });

  it('treats a soft-deleted doc as missing', () => {
    const docs = goodDocs().map((d) => (d.type === 'LICENSE' ? { ...d, deletedAt: NOW } : d));
    expect(reasonOf(baseDriver({ documents: docs }))).toBe('missing_doc_LICENSE');
  });

  it('rejects a driver with an overlapping assignment', () => {
    expect(reasonOf(baseDriver({ hasOverlappingAssignment: true }))).toBe('overlapping_assignment');
  });

  it('rejects a driver with an open offer elsewhere', () => {
    expect(reasonOf(baseDriver({ hasOpenOfferElsewhere: true }))).toBe('open_offer_elsewhere');
  });

  it('rejects a driver in cooldown for this booking', () => {
    expect(reasonOf(baseDriver({ declinedOrExpiredThisBooking: true }))).toBe('cooldown_this_booking');
  });
});
