import { prisma } from '../../prisma.js';
import { Prisma } from '@aero/db';
import { logger } from '../../logger.js';
import { notificationsQueue } from '../../queues/index.js';
import { channelsFor, type NotifData, type NotificationTemplate } from './templates.js';

/**
 * Build notification payloads for a booking and enqueue one job per channel.
 * Each Notification row is the durable record; the BullMQ job carries its id.
 * Never throws to the caller — notification failures must not roll back a
 * payment or cancellation.
 */
export async function enqueueNotification(
  bookingId: string,
  template: NotificationTemplate,
  extra: { refundAmount?: number } = {},
): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { user: true },
    });
    if (!booking) {
      logger.warn({ bookingId, template }, 'notif_skip_booking_missing');
      return;
    }

    const data: NotifData = {
      code: booking.code,
      passengerName: booking.passengerName,
      pickup: booking.pickupAddress,
      drop: booking.dropAddress,
      scheduledAt: booking.scheduledAt.toISOString(),
      fareTotal: booking.fareTotal,
      tokenAmount: booking.tokenAmount,
      balanceAmount: booking.balanceAmount,
      refundAmount: extra.refundAmount,
    };

    const phone = booking.passengerPhone || booking.user.phone;
    const email = booking.user.email;

    for (const channel of channelsFor(template)) {
      if (channel === 'EMAIL' && !email) continue; // no address on file
      const to = channel === 'SMS' ? phone : email!;

      const notif = await prisma.notification.create({
        data: {
          bookingId: booking.id,
          userId: booking.userId,
          channel,
          template,
          status: 'QUEUED',
          payload: { template, channel, to, data } as unknown as Prisma.InputJsonValue,
        },
      });

      await notificationsQueue.add('send', { notificationId: notif.id });
    }
  } catch (err) {
    logger.error({ err, bookingId, template }, 'enqueue_notification_failed');
  }
}

/**
 * Phase 4: dispatch a notification for a booking with explicit recipients and
 * extra render data (driver name, plate, deep link, etc.). Resolves SMS/EMAIL
 * recipients from overrides, falling back to the booking's passenger/user.
 * Never throws.
 */
export async function dispatchBookingNotification(opts: {
  bookingId: string;
  template: NotificationTemplate;
  /** Override SMS recipient (e.g. the driver's phone). */
  smsTo?: string;
  /** Override EMAIL recipient. */
  emailTo?: string | null;
  /** Override the userId stamped on the Notification row. */
  userId?: string;
  extra?: Partial<NotifData>;
}): Promise<string[]> {
  const ids: string[] = [];
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: opts.bookingId },
      include: { user: true },
    });
    if (!booking) {
      logger.warn({ bookingId: opts.bookingId, template: opts.template }, 'notif_skip_booking_missing');
      return ids;
    }

    const data: NotifData = {
      code: booking.code,
      passengerName: booking.passengerName,
      pickup: booking.pickupAddress,
      drop: booking.dropAddress,
      scheduledAt: booking.scheduledAt.toISOString(),
      fareTotal: booking.fareTotal,
      tokenAmount: booking.tokenAmount,
      balanceAmount: booking.balanceAmount,
      ...opts.extra,
    };

    const smsTo = opts.smsTo ?? booking.passengerPhone ?? booking.user.phone;
    const emailTo = opts.emailTo === undefined ? booking.user.email : opts.emailTo;

    for (const channel of channelsFor(opts.template)) {
      if (channel === 'EMAIL' && !emailTo) continue;
      const to = channel === 'SMS' ? smsTo : emailTo!;

      const notif = await prisma.notification.create({
        data: {
          bookingId: booking.id,
          userId: opts.userId ?? booking.userId,
          channel,
          template: opts.template,
          status: 'QUEUED',
          payload: { template: opts.template, channel, to, data } as unknown as Prisma.InputJsonValue,
        },
      });
      ids.push(notif.id);
      await notificationsQueue.add('send', { notificationId: notif.id });
    }
  } catch (err) {
    logger.error({ err, bookingId: opts.bookingId, template: opts.template }, 'dispatch_notification_failed');
  }
  return ids;
}
