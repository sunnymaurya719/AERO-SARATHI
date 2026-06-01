import { Prisma } from '@aero/db';
import type { Booking } from '@aero/db';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import type { AttemptOutcome, RankedCandidate } from '@aero/types';
import { buildPool } from './pool.js';
import { rankCandidates } from './matching.js';
import { createOffer } from './offer.service.js';
import { assignmentQueue, remindersQueue, adminAlertQueue } from '../../queues/phase4.queues.js';
import { ADJACENT_CITIES } from './matching.js';
import { systemAudit } from '../../middleware/audit.js';

/** Resolve a coarse pickup city from the booking address (best-effort). */
export function resolvePickupCity(pickupAddress: string): string {
  const cities = new Set<string>([...Object.keys(ADJACENT_CITIES)]);
  for (const set of Object.values(ADJACENT_CITIES)) for (const c of set) cities.add(c);
  for (const city of cities) {
    if (pickupAddress.toLowerCase().includes(city.toLowerCase())) return city;
  }
  return '';
}

async function recordAttempt(
  bookingId: string,
  attemptNumber: number,
  outcome: AttemptOutcome,
  candidatePool: RankedCandidate[],
  reason: string | null,
  jobId: string | null,
  driverId: string | null,
): Promise<boolean> {
  try {
    await prisma.assignmentAttempt.create({
      data: {
        bookingId,
        attemptNumber,
        outcome,
        reason,
        jobId,
        driverId,
        candidatePool: candidatePool as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  } catch (err) {
    // Unique (bookingId, attemptNumber) violation → this attempt already ran.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
    throw err;
  }
}

function scheduleRetry(bookingId: string, attemptNumber: number, reason: string, delayMin: number): Promise<unknown> {
  return assignmentQueue.add(
    'assign',
    { bookingId, attemptNumber, triggerReason: reason },
    {
      delay: delayMin * 60_000,
      jobId: `assign:${bookingId}:${attemptNumber}`,
      attempts: 1,
      removeOnComplete: 1000,
    },
  );
}

export interface RunAttemptInput {
  bookingId: string;
  attemptNumber: number;
  triggerReason: string;
  bullJobId?: string | null;
}

/**
 * Core assignment orchestrator (§8.3). Pool → rank → offer the top candidate.
 * Idempotent per (bookingId, attemptNumber). Never assigns directly — the next
 * transition comes from the driver accept route or the offer-expiry worker.
 */
export async function runAssignmentAttempt(input: RunAttemptInput): Promise<AttemptOutcome> {
  const { bookingId, attemptNumber, triggerReason } = input;
  const jobId = input.bullJobId ?? null;

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    logger.warn({ bookingId }, 'assignment_booking_missing');
    return 'ABORTED';
  }
  if (booking.status !== 'CONFIRMED') {
    await recordAttempt(bookingId, attemptNumber, 'ABORTED', [], `status_${booking.status}`, jobId, null);
    return 'ABORTED';
  }

  // Hard cap on attempts (circuit breaker §18).
  if (attemptNumber > env.ASSIGNMENT_MAX_ATTEMPTS) {
    await recordAttempt(bookingId, attemptNumber, 'ABORTED', [], 'max_attempts', jobId, null);
    await enqueueCutoffAlert(booking);
    return 'ABORTED';
  }

  // Cutoff gate (§6.4): stop trying at scheduledAt − cutoff.
  const cutoffAt = new Date(booking.scheduledAt.getTime() - env.ASSIGNMENT_CUTOFF_MIN * 60_000);
  if (Date.now() >= cutoffAt.getTime()) {
    const created = await recordAttempt(bookingId, attemptNumber, 'POOL_EMPTY', [], 'cutoff_reached', jobId, null);
    if (created) await enqueueCutoffAlert(booking);
    return 'POOL_EMPTY';
  }

  // Build + rank pool.
  const candidates = await buildPool(booking);
  if (candidates.length === 0) {
    await recordAttempt(bookingId, attemptNumber, 'POOL_EMPTY', [], 'no_eligible_drivers', jobId, null);
    await scheduleRetry(bookingId, attemptNumber + 1, 'pool_empty_retry', env.ASSIGNMENT_RETRY_MIN);
    return 'POOL_EMPTY';
  }

  const ranked = rankCandidates(candidates, {
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    pickupCity: resolvePickupCity(booking.pickupAddress),
  });
  const topN = ranked.slice(0, env.POOL_TOP_N);

  // Offer to the best candidate; skip those whose lock is busy.
  for (const candidate of topN) {
    const offer = await createOffer({
      bookingId,
      driverId: candidate.driverId,
      attemptNumber,
      ranked: candidate,
      scheduledAt: booking.scheduledAt,
    });
    if (offer) {
      await recordAttempt(bookingId, attemptNumber, 'OFFER_SENT', topN, null, jobId, candidate.driverId);
      void systemAudit({
        action: 'assignment.offer_sent',
        entity: { type: 'Booking', id: bookingId },
        reason: `attempt ${attemptNumber}, driver ${candidate.driverId}, trigger ${triggerReason}`,
      });
      return 'OFFER_SENT';
    }
  }

  // Everyone in the top-N was locked/unavailable → retry shortly.
  await recordAttempt(bookingId, attemptNumber, 'ALL_DECLINED', topN, 'all_candidates_busy', jobId, null);
  await scheduleRetry(bookingId, attemptNumber + 1, 'all_busy_retry', env.ASSIGNMENT_RETRY_MIN);
  return 'ALL_DECLINED';
}

async function enqueueCutoffAlert(booking: Booking): Promise<void> {
  await adminAlertQueue.add('alert', {
    type: 'UNASSIGNED_T_MINUS_30',
    bookingId: booking.id,
    payload: { code: booking.code, scheduledAt: booking.scheduledAt.toISOString() },
  });
  // Final safety net: at pickup time, auto-cancel + refund if still unassigned.
  await remindersQueue.add(
    'auto_cancel_check',
    { bookingId: booking.id, kind: 'auto_cancel_check' },
    {
      delay: Math.max(0, booking.scheduledAt.getTime() - Date.now()),
      jobId: `autocancel:${booking.id}`,
      removeOnComplete: 1000,
    },
  );
}
