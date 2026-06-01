import { prisma } from '../prisma.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { assignmentQueue, remindersQueue } from '../queues/phase4.queues.js';
import { cancelOffersForBooking } from '../modules/assignment/offer.service.js';

const LEAD_MS = () => env.ASSIGNMENT_LEAD_HOURS * 60 * 60 * 1000;
const MIN_DELAY_MS = 5_000;

/**
 * Fired after a booking transitions to CONFIRMED. Schedules the first
 * assignment attempt at scheduledAt − lead, plus pre-trip passenger reminders.
 * Idempotent via deterministic BullMQ jobIds. Never throws.
 */
export async function onBookingConfirmed(bookingId: string, scheduledAt: Date): Promise<void> {
  if (!env.ASSIGNMENT_AUTOMATION_ENABLED) {
    logger.info({ bookingId }, 'assignment_automation_disabled: skipping auto-assign');
    return;
  }
  try {
    const runAt = scheduledAt.getTime() - LEAD_MS();
    const delay = Math.max(MIN_DELAY_MS, runAt - Date.now());
    const job = await assignmentQueue.add(
      'assign',
      { bookingId, attemptNumber: 1, triggerReason: 'initial_t_minus_lead' },
      { delay, jobId: `assign:${bookingId}:1`, attempts: 1, removeOnComplete: 1000, removeOnFail: false },
    );
    await prisma.booking.update({ where: { id: bookingId }, data: { assignmentJobId: job.id ?? null } });

    // Pre-trip passenger reminder. Only fires if a driver is assigned by then;
    // otherwise the cutoff/unassigned path overtakes it.
    await scheduleReminder(bookingId, scheduledAt, 't_minus_30min', 30);
  } catch (err) {
    logger.error({ err, bookingId }, 'on_booking_confirmed_failed');
  }
}

async function scheduleReminder(
  bookingId: string,
  scheduledAt: Date,
  kind: 't_minus_30min',
  minsBefore: number,
): Promise<void> {
  const fireAt = scheduledAt.getTime() - minsBefore * 60_000;
  const delay = fireAt - Date.now();
  if (delay <= 0) return; // pickup already within this window
  await remindersQueue.add(
    kind,
    { bookingId, kind },
    { delay, jobId: `reminder:${kind}:${bookingId}`, removeOnComplete: 1000 },
  );
}

/**
 * Fired after a booking transitions to CANCELLED. Removes the pending
 * assignment + reminder jobs and cancels any open offers (notifying drivers).
 */
export async function onBookingCancelled(bookingId: string): Promise<void> {
  try {
    await cancelOffersForBooking(bookingId, 'booking_cancelled');
    const ids = [
      `assign:${bookingId}:1`,
      `reminder:t_minus_30min:${bookingId}`,
      `autocancel:${bookingId}`,
    ];
    for (const id of ids) {
      const assignJob = await assignmentQueue.getJob(id);
      if (assignJob) await assignJob.remove().catch(() => undefined);
      const remJob = await remindersQueue.getJob(id);
      if (remJob) await remJob.remove().catch(() => undefined);
    }
  } catch (err) {
    logger.error({ err, bookingId }, 'on_booking_cancelled_failed');
  }
}
