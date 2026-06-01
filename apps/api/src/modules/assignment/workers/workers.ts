import { Worker } from 'bullmq';
import type { Worker as BullWorker } from 'bullmq';
import { bullConnection } from '../../../queues/index.js';
import {
  QUEUE_ASSIGNMENT,
  QUEUE_OFFER_EXPIRY,
  QUEUE_REMINDERS,
  QUEUE_ADMIN_ALERT,
  type AssignmentJobData,
  type OfferExpiryJobData,
  type ReminderJobData,
  type AdminAlertJobData,
} from '../../../queues/phase4.queues.js';
import { logger } from '../../../logger.js';
import { prisma } from '../../../prisma.js';
import { runAssignmentAttempt } from '../assignment.service.js';
import { expireOffer } from '../offer.service.js';
import { dispatchBookingNotification } from '../../notifications/notifications.service.js';
import { systemCancelBookingNoDriver } from '../../cancellations/cancel.service.js';
import { postToSlack } from '../../../integrations/slack.js';
import { Prisma } from '@aero/db';

let workers: BullWorker[] = [];

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '****';
  return phone.length >= 6 ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : '****';
}

/** Consumes booking-assignment jobs and runs one matching attempt. */
function startAssignmentWorker(): BullWorker {
  return new Worker<AssignmentJobData>(
    QUEUE_ASSIGNMENT,
    async (job) => {
      const { bookingId, attemptNumber, triggerReason } = job.data;
      const outcome = await runAssignmentAttempt({
        bookingId,
        attemptNumber,
        triggerReason,
        bullJobId: job.id ?? null,
      });
      logger.info({ bookingId, attemptNumber, outcome }, 'assignment_attempt_done');
      return outcome;
    },
    { connection: bullConnection, concurrency: 8, lockDuration: 30_000 },
  );
}

/** Consumes offer-expiry jobs and flips stale offers to EXPIRED. */
function startOfferExpiryWorker(): BullWorker {
  return new Worker<OfferExpiryJobData>(
    QUEUE_OFFER_EXPIRY,
    async (job) => {
      await expireOffer(job.data.offerId);
    },
    { connection: bullConnection, concurrency: 16 },
  );
}

/** Consumes pre-trip reminder + auto-cancel jobs. */
function startRemindersWorker(): BullWorker {
  return new Worker<ReminderJobData>(
    QUEUE_REMINDERS,
    async (job) => {
      const { bookingId, kind } = job.data;
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { driver: true, vehicle: true },
      });
      if (!booking) return;

      if (kind === 'auto_cancel_check') {
        // Last-resort safety net: still no driver at pickup time → cancel + refund.
        if (booking.status === 'CONFIRMED') {
          const res = await systemCancelBookingNoDriver(bookingId);
          if (res.cancelled) {
            await dispatchBookingNotification({
              bookingId,
              template: 'passenger_no_driver_found',
            });
            logger.warn({ bookingId }, 'booking_auto_cancelled_no_driver');
          }
        }
        return;
      }

      if (kind === 't_minus_30min') {
        if (booking.status === 'DRIVER_ASSIGNED' && booking.driver) {
          await dispatchBookingNotification({
            bookingId,
            template: 'passenger_t_minus_30',
            extra: {
              driverName: booking.driver.name,
              driverPhoneMasked: maskPhone(booking.driver.phone),
              carModel: booking.vehicle?.model,
              plate: booking.vehicle?.regNo,
            },
          });
        }
        return;
      }
    },
    { connection: bullConnection, concurrency: 8 },
  );
}

/** Consumes admin-alert jobs: persists a SystemAlert + notifies ops. */
function startAdminAlertWorker(): BullWorker {
  return new Worker<AdminAlertJobData>(
    QUEUE_ADMIN_ALERT,
    async (job) => {
      const { type, bookingId, payload } = job.data;
      const severity = type === 'UNASSIGNED_T_MINUS_30' ? 'CRITICAL' : 'WARNING';
      const alert = await prisma.systemAlert.create({
        data: {
          type,
          severity,
          entityType: bookingId ? 'Booking' : null,
          entityId: bookingId ?? null,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
          status: 'OPEN',
        },
      });
      const text = `:rotating_light: *${type}* (${severity})${
        bookingId ? ` · booking ${payload?.code ?? bookingId}` : ''
      } · alert ${alert.id}`;
      await postToSlack(text);
      logger.warn({ alertId: alert.id, type }, 'system_alert_raised');
    },
    { connection: bullConnection, concurrency: 4 },
  );
}

/** Boot all Phase 4 workers. Call once at API startup. */
export function startPhase4Workers(): void {
  workers = [
    startAssignmentWorker(),
    startOfferExpiryWorker(),
    startRemindersWorker(),
    startAdminAlertWorker(),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job?.id, err }, 'phase4_job_failed'));
  }
  logger.info('phase4_workers_started');
}

/** Gracefully close all Phase 4 workers. */
export async function closePhase4Workers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}
