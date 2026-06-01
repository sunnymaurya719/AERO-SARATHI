import { Worker } from 'bullmq';
import type { Worker as BullWorker } from 'bullmq';
import { Prisma } from '@aero/db';
import { bullConnection } from '../../../queues/index.js';
import {
  QUEUE_ETA_TICK,
  QUEUE_TRIP_STALE,
  QUEUE_TRIP_FRAUD,
  type EtaTickJobData,
  type TripStaleJobData,
  type TripFraudJobData,
} from '../../../queues/phase5.queues.js';
import { logger } from '../../../logger.js';
import { prisma } from '../../../prisma.js';
import { recomputeEta } from '../../tracking/eta.service.js';
import { finalizeTripStats } from '../trip-stats.service.js';
import { postToSlack } from '../../../integrations/slack.js';

let workers: BullWorker[] = [];

/** Recompute + broadcast ETA for one active booking. */
function startEtaWorker(): BullWorker {
  return new Worker<EtaTickJobData>(
    QUEUE_ETA_TICK,
    async (job) => {
      const kind = await recomputeEta(job.data.bookingId);
      return kind;
    },
    { connection: bullConnection, concurrency: 16 },
  );
}

/** Watchdog: if a trip has not started moving towards drop in time, page ops. */
function startStaleWorker(): BullWorker {
  return new Worker<TripStaleJobData>(
    QUEUE_TRIP_STALE,
    async (job) => {
      const booking = await prisma.booking.findUnique({
        where: { id: job.data.bookingId },
        select: { id: true, code: true, status: true, arrivedAt: true },
      });
      if (!booking) return 'no_booking';
      // Healthy if it has progressed past EN_ROUTE or already reached pickup.
      if (booking.status !== 'EN_ROUTE' || booking.arrivedAt) return 'healthy';

      await prisma.systemAlert.create({
        data: {
          type: 'TRIP_STALE',
          severity: 'WARNING',
          entityType: 'Booking',
          entityId: booking.id,
          payload: { bookingCode: booking.code, status: booking.status } as unknown as Prisma.InputJsonValue,
          status: 'OPEN',
        },
      });
      void postToSlack(`:warning: Trip ${booking.code} appears stalled (still EN_ROUTE, no pickup).`);
      return 'flagged';
    },
    { connection: bullConnection, concurrency: 8 },
  );
}

/** Compute trip stats + fraud after completion. */
function startFraudWorker(): BullWorker {
  return new Worker<TripFraudJobData>(
    QUEUE_TRIP_FRAUD,
    async (job) => {
      await finalizeTripStats(job.data.bookingId);
    },
    { connection: bullConnection, concurrency: 4 },
  );
}

export function startPhase5Workers(): void {
  workers = [startEtaWorker(), startStaleWorker(), startFraudWorker()];
  for (const w of workers) {
    w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job?.id, err }, 'phase5_job_failed'));
  }
  logger.info('phase5_workers_started');
}

export async function closePhase5Workers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}
