import type { CancelBucket } from '@aero/types';

const GRACE_MIN = 30;
const FLAT_FEE_PAISE = 20_000; // ₹200

export interface PolicyQuote {
  bucket: CancelBucket;
  feeAmount: number; // paise retained
  refundAmount: number; // paise to refund
  explanation: string;
}

/**
 * Canonical cancellation policy (PRD §6). Pure, deterministic, money in paise.
 * Windows are relative to the scheduled pickup time, except the 30-minute grace
 * which is relative to booking creation.
 */
export function computeCancellation(
  tokenPaid: number,
  createdAt: Date,
  scheduledAt: Date,
  now: Date = new Date(),
): PolicyQuote {
  const minSinceCreate = (now.getTime() - createdAt.getTime()) / 60_000;
  const hoursToTrip = (scheduledAt.getTime() - now.getTime()) / 3_600_000;

  if (minSinceCreate <= GRACE_MIN) {
    return {
      bucket: 'GRACE_30_MIN',
      feeAmount: 0,
      refundAmount: tokenPaid,
      explanation: 'Free cancellation within 30 minutes of booking.',
    };
  }
  if (hoursToTrip <= 0) {
    return {
      bucket: 'NO_SHOW',
      feeAmount: tokenPaid,
      refundAmount: 0,
      explanation: 'Pickup time has passed; no refund.',
    };
  }
  if (hoursToTrip < 6) {
    return {
      bucket: 'PCT_100',
      feeAmount: tokenPaid,
      refundAmount: 0,
      explanation: 'Cancellation within 6 hours of pickup: no refund.',
    };
  }
  if (hoursToTrip < 24) {
    const fee = Math.round(tokenPaid * 0.25);
    return {
      bucket: 'PCT_25',
      feeAmount: fee,
      refundAmount: tokenPaid - fee,
      explanation: 'Cancellation between 6 and 24 hours of pickup: 25% fee on token paid.',
    };
  }
  const fee = Math.min(FLAT_FEE_PAISE, tokenPaid);
  return {
    bucket: 'FLAT_200',
    feeAmount: fee,
    refundAmount: tokenPaid - fee,
    explanation: 'Cancellation more than 24 hours before pickup: flat ₹200 fee.',
  };
}
