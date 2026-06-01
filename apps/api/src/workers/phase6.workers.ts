import { Worker } from 'bullmq';
import type { Worker as BullWorker } from 'bullmq';
import { bullConnection } from '../queues/index.js';
import {
  QUEUE_ANALYTICS_ROLLUP,
  QUEUE_RATING_RECOMPUTE,
  QUEUE_REFERRAL_CREDIT,
  QUEUE_SUPPLY_REFRESH,
  QUEUE_LEDGER_RECONCILE,
  schedulePhase6Repeatables,
  type RatingRecomputeJobData,
  type ReferralCreditJobData,
} from '../queues/phase6.queues.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { rollupDay } from '../analytics/rollup.js';
import { recomputeDriverRating } from '../modules/review/review.service.js';
import { rewardReferralOnFirstTrip } from '../modules/referral/referral.service.js';
import { refreshSupply } from '../modules/pricing/demand.service.js';
import { reconcile } from '../modules/ledger/ledger.js';

let workers: BullWorker[] = [];

/** Start all Phase 6 background workers and register repeatable schedules. */
export function startPhase6Workers(): void {
  workers = [
    new Worker(QUEUE_ANALYTICS_ROLLUP, async () => { await rollupDay(); }, { connection: bullConnection, concurrency: 1 }),
    new Worker<RatingRecomputeJobData>(QUEUE_RATING_RECOMPUTE, async (job) => { await recomputeDriverRating(job.data.driverId); }, { connection: bullConnection, concurrency: 4 }),
    new Worker<ReferralCreditJobData>(QUEUE_REFERRAL_CREDIT, async (job) => { return rewardReferralOnFirstTrip(job.data.refereeId); }, { connection: bullConnection, concurrency: 4 }),
    new Worker(QUEUE_SUPPLY_REFRESH, async () => { return refreshSupply(); }, { connection: bullConnection, concurrency: 1 }),
    new Worker(QUEUE_LEDGER_RECONCILE, async () => { const r = await reconcile(); return { drift: r.drift.toString() }; }, { connection: bullConnection, concurrency: 1 }),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => logger.error({ err, queue: w.name, jobId: job?.id }, 'phase6_worker_failed'));
  }

  void schedulePhase6Repeatables(env.SUPPLY_REFRESH_SEC).catch((err) =>
    logger.error({ err }, 'phase6_schedule_failed'),
  );
}

export async function closePhase6Workers(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  workers = [];
}
