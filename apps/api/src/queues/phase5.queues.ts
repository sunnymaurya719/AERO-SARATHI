import { Queue } from 'bullmq';
import { bullConnection } from './index.js';

/**
 * Phase 5 queues (live tracking). Share the single BullMQ connection.
 *
 * - eta-tick: repeatable per active trip — recompute + broadcast ETA.
 * - trip-stale-watchdog: delayed — pages ops if a trip stalls.
 * - trip-fraud-check: one-shot on COMPLETED — run heuristics + summary.
 */

export const QUEUE_ETA_TICK = 'eta-tick';
export const QUEUE_TRIP_STALE = 'trip-stale-watchdog';
export const QUEUE_TRIP_FRAUD = 'trip-fraud-check';

export interface EtaTickJobData {
  bookingId: string;
}

export interface TripStaleJobData {
  bookingId: string;
}

export interface TripFraudJobData {
  bookingId: string;
}

export const etaTickQueue = new Queue<EtaTickJobData>(QUEUE_ETA_TICK, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 1000,
    removeOnFail: 1000,
  },
});

export const tripStaleQueue = new Queue<TripStaleJobData>(QUEUE_TRIP_STALE, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});

export const tripFraudQueue = new Queue<TripFraudJobData>(QUEUE_TRIP_FRAUD, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});

export const etaJobName = (bookingId: string): string => `eta:${bookingId}`;
export const staleJobName = (bookingId: string): string => `stale:${bookingId}`;

/** Add (or replace) the repeatable ETA tick for a booking at a given cadence. */
export async function scheduleEtaTick(bookingId: string, everySec: number): Promise<void> {
  await etaTickQueue.add(
    etaJobName(bookingId),
    { bookingId },
    { repeat: { every: everySec * 1000 }, jobId: etaJobName(bookingId) },
  );
}

/** Remove the repeatable ETA tick for a booking. */
export async function removeEtaTick(bookingId: string): Promise<void> {
  const repeatables = await etaTickQueue.getRepeatableJobs();
  for (const r of repeatables) {
    if (r.name === etaJobName(bookingId)) {
      await etaTickQueue.removeRepeatableByKey(r.key).catch(() => undefined);
    }
  }
}

export async function closePhase5Queues(): Promise<void> {
  await Promise.allSettled([etaTickQueue.close(), tripStaleQueue.close(), tripFraudQueue.close()]);
}
