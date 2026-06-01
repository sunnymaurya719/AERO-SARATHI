import { Queue } from 'bullmq';
import { bullConnection } from './index.js';

/**
 * Phase 6 queues (intelligence layer). Mostly repeatable scheduled jobs:
 * - analytics-rollup: nightly DailyMetric upsert.
 * - rating-recompute: per-driver Bayesian rating refresh.
 * - referral-credit: reward a referral on the referee's first completed trip.
 * - supply-zone-refresh: periodic online-driver-per-zone counter refresh.
 * - ledger-reconcile: periodic global debit/credit drift check.
 */

export const QUEUE_ANALYTICS_ROLLUP = 'analytics-rollup';
export const QUEUE_RATING_RECOMPUTE = 'rating-recompute';
export const QUEUE_REFERRAL_CREDIT = 'referral-credit';
export const QUEUE_SUPPLY_REFRESH = 'supply-zone-refresh';
export const QUEUE_LEDGER_RECONCILE = 'ledger-reconcile';

export interface RatingRecomputeJobData {
  driverId: string;
}
export interface ReferralCreditJobData {
  refereeId: string;
}

const repeatableOpts = { attempts: 2, removeOnComplete: 100, removeOnFail: 200 } as const;
const oneShotOpts = { attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 }, removeOnComplete: 1000, removeOnFail: false } as const;

export const analyticsRollupQueue = new Queue(QUEUE_ANALYTICS_ROLLUP, { connection: bullConnection, defaultJobOptions: repeatableOpts });
export const ratingRecomputeQueue = new Queue<RatingRecomputeJobData>(QUEUE_RATING_RECOMPUTE, { connection: bullConnection, defaultJobOptions: oneShotOpts });
export const referralCreditQueue = new Queue<ReferralCreditJobData>(QUEUE_REFERRAL_CREDIT, { connection: bullConnection, defaultJobOptions: oneShotOpts });
export const supplyRefreshQueue = new Queue(QUEUE_SUPPLY_REFRESH, { connection: bullConnection, defaultJobOptions: repeatableOpts });
export const ledgerReconcileQueue = new Queue(QUEUE_LEDGER_RECONCILE, { connection: bullConnection, defaultJobOptions: repeatableOpts });

/** Register the repeatable schedules (idempotent — BullMQ dedupes by repeat key). */
export async function schedulePhase6Repeatables(supplyRefreshSec: number): Promise<void> {
  await analyticsRollupQueue.add('nightly', {}, { repeat: { pattern: '15 0 * * *' }, jobId: 'analytics-rollup-nightly' });
  await supplyRefreshQueue.add('refresh', {}, { repeat: { every: supplyRefreshSec * 1000 }, jobId: 'supply-zone-refresh' });
  await ledgerReconcileQueue.add('reconcile', {}, { repeat: { pattern: '0 * * * *' }, jobId: 'ledger-reconcile-hourly' });
}

/** Enqueue a one-shot rating recompute for a driver. */
export async function enqueueRatingRecompute(driverId: string): Promise<void> {
  await ratingRecomputeQueue.add(`rating:${driverId}`, { driverId });
}

/** Enqueue a one-shot referral credit attempt for a referee's first trip. */
export async function enqueueReferralCredit(refereeId: string): Promise<void> {
  await referralCreditQueue.add(`referral:${refereeId}`, { refereeId });
}

export async function closePhase6Queues(): Promise<void> {
  await Promise.allSettled([
    analyticsRollupQueue.close(),
    ratingRecomputeQueue.close(),
    referralCreditQueue.close(),
    supplyRefreshQueue.close(),
    ledgerReconcileQueue.close(),
  ]);
}
