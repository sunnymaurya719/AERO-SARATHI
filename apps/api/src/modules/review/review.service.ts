/**
 * Reviews & ratings (Phase 6 §8.2). Both parties may rate a completed trip
 * (1-5 stars) within a window. Driver ratings feed a Bayesian-smoothed score
 * used by Phase 4 assignment; persistently low ratings raise a SystemAlert.
 */
import type { ReviewDirection } from '@aero/db';
import { Prisma } from '@aero/db';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { logger } from '../../logger.js';

const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'bastard'];

/** PURE: Bayesian-smoothed rating = (C·m + Σstars) / (C + n). */
export function bayesianRating(sumStars: number, count: number, C = env.RATING_SMOOTHING_C, m = env.RATING_GLOBAL_MEAN): number {
  if (count <= 0) return m;
  return (C * m + sumStars) / (C + count);
}

/** PURE: round to 2 decimals. */
export function roundRating(n: number): number {
  return Math.round(n * 100) / 100;
}

/** PURE: does free text contain blocked words? */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PROFANITY.some((w) => lower.includes(w));
}

/** PURE: is the review within the allowed window after completion? */
export function withinReviewWindow(completedAt: Date, now: Date, windowDays = env.REVIEW_WINDOW_DAYS): boolean {
  const ms = now.getTime() - completedAt.getTime();
  return ms >= 0 && ms <= windowDays * 24 * 60 * 60 * 1000;
}

/** Submit a review for one direction of a completed trip. */
export async function submitReview(input: {
  bookingId: string;
  direction: ReviewDirection;
  raterId: string;
  rateeId: string;
  stars: number;
  tags?: string[];
  text?: string;
}): Promise<{ id: string }> {
  if (!env.REVIEWS_ENABLED) throw Errors.validation('reviews_disabled');
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw Errors.validation('stars_out_of_range');
  }

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: { status: true, completedAt: true },
  });
  if (!booking || booking.status !== 'COMPLETED' || !booking.completedAt) {
    throw Errors.validation('booking_not_completed');
  }
  if (!withinReviewWindow(booking.completedAt, new Date())) {
    throw Errors.validation('review_window_closed');
  }

  const existing = await prisma.review.findUnique({
    where: { bookingId_direction: { bookingId: input.bookingId, direction: input.direction } },
  });
  if (existing) throw Errors.conflict('already_reviewed');

  const review = await prisma.review.create({
    data: {
      bookingId: input.bookingId,
      direction: input.direction,
      raterId: input.raterId,
      rateeId: input.rateeId,
      stars: input.stars,
      tags: input.tags ?? [],
      text: input.text ?? null,
      hidden: containsProfanity(input.text),
    },
  });

  if (input.direction === 'CUSTOMER_TO_DRIVER') {
    await recomputeDriverRating(input.rateeId).catch((err) =>
      logger.error({ err, driverId: input.rateeId }, 'rating_recompute_failed'),
    );
  }
  return { id: review.id };
}

/** Recompute a driver's Bayesian rating and raise a low-rating alert if needed. */
export async function recomputeDriverRating(driverId: string): Promise<void> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } });
  if (!driver) return;

  const agg = await prisma.review.aggregate({
    where: { rateeId: driverId, direction: 'CUSTOMER_TO_DRIVER', hidden: false },
    _sum: { stars: true },
    _count: true,
  });
  const count = agg._count;
  const sum = agg._sum.stars ?? 0;
  const rating = roundRating(bayesianRating(sum, count));

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = await prisma.review.aggregate({
    where: { rateeId: driverId, direction: 'CUSTOMER_TO_DRIVER', hidden: false, createdAt: { gte: since } },
    _sum: { stars: true },
    _count: true,
  });
  const last30 = recent._count > 0 ? roundRating(bayesianRating(recent._sum.stars ?? 0, recent._count)) : null;

  await prisma.driver.update({
    where: { id: driverId },
    data: { rating, ratingCount: count, last30Rating: last30 },
  });

  if (count >= 20 && rating < env.RATING_LOW_THRESHOLD) {
    await prisma.systemAlert.create({
      data: {
        type: 'LOW_RATING',
        severity: 'WARNING',
        entityType: 'driver',
        entityId: driverId,
        payload: { rating, ratingCount: count } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
