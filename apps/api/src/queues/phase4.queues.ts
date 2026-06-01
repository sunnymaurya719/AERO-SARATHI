import { Queue } from 'bullmq';
import { bullConnection } from './index.js';

/**
 * Phase 4 queues. All share the single BullMQ connection from `queues/index.ts`.
 *
 * - booking-assignment: initial + retry assignment attempts (delayed jobs).
 * - offer-expiry: flips an OFFERED offer to EXPIRED at its TTL.
 * - pre-trip-reminders: T-24h / T-2h / T-30min passenger reminders.
 * - admin-alert: creates SystemAlert + Slack + email on cutoff.
 */

export const QUEUE_ASSIGNMENT = 'booking-assignment';
export const QUEUE_OFFER_EXPIRY = 'offer-expiry';
export const QUEUE_REMINDERS = 'pre-trip-reminders';
export const QUEUE_ADMIN_ALERT = 'admin-alert';

export interface AssignmentJobData {
  bookingId: string;
  attemptNumber: number;
  triggerReason: string;
}

export interface OfferExpiryJobData {
  offerId: string;
}

export type ReminderKind = 't_minus_24h' | 't_minus_2h' | 't_minus_30min' | 'auto_cancel_check';

export interface ReminderJobData {
  bookingId: string;
  kind: ReminderKind;
}

export interface AdminAlertJobData {
  type:
    | 'UNASSIGNED_T_MINUS_30'
    | 'POOL_EMPTY'
    | 'DRIVER_NO_SHOW'
    | 'REFUND_STUCK'
    | 'DOC_EXPIRY'
    | 'WEBHOOK_DLQ';
  bookingId?: string;
  payload: Record<string, unknown>;
}

export const assignmentQueue = new Queue<AssignmentJobData>(QUEUE_ASSIGNMENT, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});

export const offerExpiryQueue = new Queue<OfferExpiryJobData>(QUEUE_OFFER_EXPIRY, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  },
});

export const remindersQueue = new Queue<ReminderJobData>(QUEUE_REMINDERS, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});

export const adminAlertQueue = new Queue<AdminAlertJobData>(QUEUE_ADMIN_ALERT, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});

export async function closePhase4Queues(): Promise<void> {
  await Promise.allSettled([
    assignmentQueue.close(),
    offerExpiryQueue.close(),
    remindersQueue.close(),
    adminAlertQueue.close(),
  ]);
}
