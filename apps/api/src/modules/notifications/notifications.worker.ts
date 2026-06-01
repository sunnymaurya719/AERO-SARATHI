import { Worker } from 'bullmq';
import type { Worker as BullWorker } from 'bullmq';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { bullConnection, QUEUE_NOTIFICATIONS, type NotificationJobData } from '../../queues/index.js';
import { renderSms, renderEmail, type NotifData, type NotificationTemplate } from './templates.js';
import { sendSms } from './channels/sms.msg91.js';
import { sendEmail } from './channels/email.sendgrid.js';

interface StoredPayload {
  template: NotificationTemplate;
  channel: 'SMS' | 'EMAIL';
  to: string;
  data: NotifData;
}

/**
 * Processes the `notifications` queue: renders the stored template and sends it
 * over the right channel. On failure marks the row, increments attempts, and
 * rethrows so BullMQ retries (exponential backoff, then dead-letters).
 */
export function startNotificationsWorker(): BullWorker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(
    QUEUE_NOTIFICATIONS,
    async (job) => {
      const notif = await prisma.notification.findUnique({ where: { id: job.data.notificationId } });
      if (!notif) return;
      if (notif.status === 'SENT') return; // idempotent

      const p = notif.payload as unknown as StoredPayload;
      try {
        if (p.channel === 'SMS') {
          await sendSms(p.to, renderSms(p.template, p.data));
        } else {
          await sendEmail(p.to, renderEmail(p.template, p.data));
        }
        await prisma.notification.update({
          where: { id: notif.id },
          data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
        });
      } catch (err) {
        await prisma.notification.update({
          where: { id: notif.id },
          data: {
            status: 'FAILED',
            attempts: { increment: 1 },
            lastError: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }
    },
    { connection: bullConnection, concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, 'notification_job_failed');
  });
  return worker;
}
