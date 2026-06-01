/**
 * Hard eligibility gates for driver matching (Phase 4 §6.1).
 *
 * The production candidate query (`pool.ts`) enforces most of these at the SQL
 * level for performance. This module re-expresses them as a pure, fully
 * unit-testable predicate used for defensive re-checks and tests.
 */

export const CRITICAL_DOC_TYPES = ['LICENSE', 'RC', 'INSURANCE', 'PERMIT'] as const;

export interface EligDoc {
  type: string;
  verified: boolean;
  expiresAt: Date | null;
  deletedAt: Date | null;
}

export interface EligDriver {
  status: string; // DriverStatus
  availability: string; // DriverAvailability
  lastSeenAt: Date | null;
  vehicleCategory: string | null; // assigned vehicle's category, null if no vehicle
  documents: EligDoc[];
  hasOpenOfferElsewhere: boolean; // OFFERED offer for a DIFFERENT booking
  hasOverlappingAssignment: boolean; // active booking overlapping this window
  declinedOrExpiredThisBooking: boolean; // skip cool-down for this booking
}

export interface EligContext {
  vehicleCategory: string; // booking.vehicleCategory
  scheduledAt: Date;
  now: Date;
  heartbeatMaxAgeSec?: number; // default 120
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

export function checkEligibility(d: EligDriver, ctx: EligContext): EligibilityResult {
  const heartbeatMaxAgeMs = (ctx.heartbeatMaxAgeSec ?? 120) * 1000;

  if (d.status !== 'ACTIVE') return { eligible: false, reason: 'driver_not_active' };

  if (d.availability !== 'ONLINE') return { eligible: false, reason: 'driver_offline' };

  if (!d.lastSeenAt || ctx.now.getTime() - d.lastSeenAt.getTime() > heartbeatMaxAgeMs) {
    return { eligible: false, reason: 'heartbeat_stale' };
  }

  if (!d.vehicleCategory) return { eligible: false, reason: 'no_vehicle' };
  if (d.vehicleCategory !== ctx.vehicleCategory) {
    return { eligible: false, reason: 'vehicle_category_mismatch' };
  }

  for (const type of CRITICAL_DOC_TYPES) {
    const doc = d.documents.find((x) => x.type === type && !x.deletedAt);
    if (!doc) return { eligible: false, reason: `missing_doc_${type}` };
    if (!doc.verified) return { eligible: false, reason: `unverified_doc_${type}` };
    if (!doc.expiresAt || doc.expiresAt <= ctx.scheduledAt) {
      return { eligible: false, reason: `expired_doc_${type}` };
    }
  }

  if (d.hasOverlappingAssignment) return { eligible: false, reason: 'overlapping_assignment' };
  if (d.hasOpenOfferElsewhere) return { eligible: false, reason: 'open_offer_elsewhere' };
  if (d.declinedOrExpiredThisBooking) return { eligible: false, reason: 'cooldown_this_booking' };

  return { eligible: true };
}

export function isEligible(d: EligDriver, ctx: EligContext): boolean {
  return checkEligibility(d, ctx).eligible;
}
