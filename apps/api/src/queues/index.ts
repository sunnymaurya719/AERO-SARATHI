import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../env.js';

/**
 * BullMQ requires a dedicated connection with `maxRetriesPerRequest: null`.
 * We keep this separate from the app's `redis` client (used for caching/denylist).
 */
export const bullConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const QUEUE_WEBHOOK = 'webhooks';
export const QUEUE_NOTIFICATIONS = 'notifications';

export interface WebhookJobData {
  webhookEventId: string;
}

export interface NotificationJobData {
  notificationId: string;
}

export const webhookQueue = new Queue<WebhookJobData>(QUEUE_WEBHOOK, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});

export const notificationsQueue = new Queue<NotificationJobData>(QUEUE_NOTIFICATIONS, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([webhookQueue.close(), notificationsQueue.close()]);
  await bullConnection.quit();
}
