import { env } from '../../env.js';
import { prisma } from '../../prisma.js';
import { Errors } from '../../errors.js';
import { logger } from '../../logger.js';
import { transitionBooking } from '../../state/booking.transitions.js';
import { enqueueNotification } from '../notifications/notifications.service.js';
import {
  createOrder,
  fetchPayment,
  verifyCheckoutSignature,
  isRazorpayConfigured,
} from './razorpay.js';
import type { PaymentIntentResponse, PaymentVerifyRequest, PaymentVerifyResponse } from '@aero/types';

async function loadOwnedBooking(userId: string, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { user: true },
  });
  if (!booking || booking.userId !== userId) throw Errors.notFound('Booking not found');
  return booking;
}

/** Create (or reuse) a Razorpay order for the token amount of a PENDING booking. */
export async function createPaymentIntent(userId: string, bookingId: string): Promise<PaymentIntentResponse> {
  if (!isRazorpayConfigured()) throw Errors.badGateway('Payments are not configured');

  const booking = await loadOwnedBooking(userId, bookingId);
  if (booking.status !== 'PENDING') throw Errors.conflict('Booking is not awaiting payment');

  const minLeadMs = env.MIN_LEAD_TIME_MIN * 60_000;
  if (booking.scheduledAt.getTime() < Date.now() + minLeadMs) {
    throw Errors.gone('Pickup is too soon to confirm this booking');
  }

  // Reuse an open token payment whose order is still within the TTL window.
  const ttlMs = env.PAYMENT_INTENT_TTL_MIN * 60_000;
  const existing = await prisma.payment.findFirst({
    where: { bookingId: booking.id, type: 'TOKEN', status: { in: ['CREATED', 'PENDING'] } },
    orderBy: { createdAt: 'desc' },
  });

  let payment = existing;
  if (!payment || !payment.gatewayOrderId || payment.createdAt.getTime() < Date.now() - ttlMs) {
    const order = await createOrder({
      amount: booking.tokenAmount,
      receipt: booking.code,
      notes: { bookingId: booking.id, bookingCode: booking.code },
    });
    payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        amount: booking.tokenAmount,
        type: 'TOKEN',
        status: 'CREATED',
        gateway: 'razorpay',
        gatewayOrderId: order.id,
      },
    });
  }

  return {
    paymentId: payment.id,
    razorpayKeyId: env.RAZORPAY_KEY_ID,
    razorpayOrderId: payment.gatewayOrderId!,
    amount: booking.tokenAmount,
    currency: 'INR',
    name: 'Aero Sarathi',
    description: `Token for ${booking.code}`,
    prefill: {
      name: booking.passengerName,
      contact: booking.passengerPhone,
      email: booking.user.email ?? null,
    },
    notes: { bookingId: booking.id, bookingCode: booking.code },
  };
}

/**
 * Verify the Checkout signature the browser returns, then confirm with Razorpay
 * server-side. The webhook remains the source of truth, but this gives instant
 * UX and is fully idempotent.
 */
export async function verifyPayment(
  userId: string,
  bookingId: string,
  body: PaymentVerifyRequest,
): Promise<PaymentVerifyResponse> {
  const booking = await loadOwnedBooking(userId, bookingId);

  if (!verifyCheckoutSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
    logger.warn({ bookingId, orderId: body.razorpay_order_id }, 'razorpay_bad_checkout_signature');
    throw Errors.validation('Payment signature verification failed');
  }

  const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: body.razorpay_order_id } });
  if (!payment || payment.bookingId !== booking.id) throw Errors.notFound('Payment not found for this booking');

  if (payment.status === 'SUCCESS') {
    const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    return snapshot(fresh);
  }

  // Mark the payment id; final SUCCESS depends on the gateway capture state.
  await prisma.payment.update({
    where: { id: payment.id },
    data: { gatewayPayId: body.razorpay_payment_id, status: 'PENDING' },
  });

  const gp = await fetchPayment(body.razorpay_payment_id);
  if (gp.status === 'captured') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESS',
        amountPaid: gp.amount,
        gatewayMethod: gp.method,
        gatewayFee: gp.fee ?? null,
        gatewayTax: gp.tax ?? null,
        capturedAt: new Date(),
      },
    });
    await transitionBooking(booking.id, 'CONFIRMED', { actorId: userId, reason: 'payment_verified' });
    void enqueueNotification(booking.id, 'booking_confirmed');
  }

  const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  return snapshot(fresh);
}

function snapshot(b: {
  id: string;
  code: string;
  status: string;
  confirmedAt: Date | null;
}): PaymentVerifyResponse {
  return {
    booking: {
      id: b.id,
      code: b.code,
      status: b.status as PaymentVerifyResponse['booking']['status'],
      confirmedAt: b.confirmedAt ? b.confirmedAt.toISOString() : null,
    },
  };
}
