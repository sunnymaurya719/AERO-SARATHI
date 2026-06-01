import { env } from '../../env.js';

export type NotificationTemplate =
  | 'booking_confirmed'
  | 'payment_failed'
  | 'cancellation_confirmed'
  | 'refund_completed'
  // ── Phase 4 ──
  | 'driver_offer'
  | 'driver_assignment_confirmed'
  | 'driver_trip_cancelled'
  | 'passenger_driver_assigned'
  | 'passenger_t_minus_30'
  | 'passenger_no_driver_found'
  | 'passenger_driver_reassigned'
  // ── Phase 5 ──
  | 'passenger_driver_en_route'
  | 'passenger_driver_arrived'
  | 'passenger_ride_started'
  | 'passenger_ride_completed'
  | 'passenger_no_show'
  | 'driver_no_show_recorded';

export type Channel = 'SMS' | 'EMAIL';

/** All data required to render any notification. Built at enqueue time. */
export interface NotifData {
  code: string;
  passengerName: string;
  pickup: string;
  drop: string;
  scheduledAt: string; // ISO
  fareTotal: number; // paise
  tokenAmount: number; // paise
  balanceAmount: number; // paise
  refundAmount?: number; // paise
  // ── Phase 4 fields ──
  driverName?: string;
  driverPhone?: string; // shown to passenger after assignment
  driverPhoneMasked?: string;
  passengerPhone?: string; // shown to driver after assignment
  carModel?: string;
  plate?: string;
  deepLink?: string;
  etaMin?: number;
  fareToDriver?: number; // paise
  // ── Phase 5 ──
  trackUrl?: string; // signed shareable track link
}

function rupees(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface RenderedSms {
  channel: 'SMS';
  text: string;
  /** MSG91 DLT template id for this message, when configured. */
  templateId: string;
}

export interface RenderedEmail {
  channel: 'EMAIL';
  subject: string;
  html: string;
}

/** Channels a given template is delivered over (EMAIL only attempted if user has an email). */
export function channelsFor(template: NotificationTemplate): Channel[] {
  switch (template) {
    case 'booking_confirmed':
    case 'cancellation_confirmed':
      return ['SMS', 'EMAIL'];
    case 'payment_failed':
    case 'refund_completed':
      return ['SMS', 'EMAIL'];
    case 'passenger_driver_assigned':
    case 'passenger_no_driver_found':
    case 'passenger_driver_reassigned':
    case 'passenger_ride_completed':
      return ['SMS', 'EMAIL'];
    case 'passenger_t_minus_30':
    case 'driver_offer':
    case 'driver_assignment_confirmed':
    case 'driver_trip_cancelled':
    case 'passenger_driver_en_route':
    case 'passenger_driver_arrived':
    case 'passenger_ride_started':
    case 'passenger_no_show':
    case 'driver_no_show_recorded':
      return ['SMS'];
    default:
      return ['SMS'];
  }
}

export function renderSms(template: NotificationTemplate, d: NotifData): RenderedSms {
  const track = `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/track/${d.code}`;
  switch (template) {
    case 'booking_confirmed':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_BOOKING_CONFIRMED,
        text: `Aero Sarathi: Booking ${d.code} confirmed. ${d.pickup} to ${d.drop} on ${when(
          d.scheduledAt,
        )}. Track: ${track}`,
      };
    case 'payment_failed':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PAYMENT_FAILED,
        text: `Aero Sarathi: Payment for booking ${d.code} failed. Please try again from My Bookings.`,
      };
    case 'cancellation_confirmed':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_CANCELLATION,
        text: `Aero Sarathi: Booking ${d.code} cancelled. Refund of Rs.${rupees(
          d.refundAmount ?? 0,
        )} will be processed in 5-7 days.`,
      };
    case 'refund_completed':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_REFUND,
        text: `Aero Sarathi: Refund of Rs.${rupees(d.refundAmount ?? 0)} for booking ${d.code} processed.`,
      };
    case 'driver_offer':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_DRIVER_OFFER,
        text: `Aero Sarathi: New trip ${d.code}. ${d.pickup} to ${d.drop} on ${when(
          d.scheduledAt,
        )}. Fare Rs.${rupees(d.fareToDriver ?? d.balanceAmount)}. Accept (60s): ${d.deepLink ?? ''}`,
      };
    case 'driver_assignment_confirmed':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_DRIVER_ASSIGNMENT_CONFIRMED,
        text: `Aero Sarathi: Trip ${d.code} confirmed. Pickup ${d.pickup} at ${when(
          d.scheduledAt,
        )}. Passenger ${d.passengerName} (${d.passengerPhone ?? ''}).`,
      };
    case 'driver_trip_cancelled':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_DRIVER_TRIP_CANCELLED,
        text: `Aero Sarathi: Trip ${d.code} was cancelled. Sorry for the inconvenience.`,
      };
    case 'passenger_driver_assigned':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_DRIVER_ASSIGNED,
        text: `Aero Sarathi: Driver ${d.driverName ?? ''} (${d.driverPhoneMasked ?? ''}) will arrive in ${d.carModel ?? 'car'} (${d.plate ?? ''}) for booking ${d.code}.`,
      };
    case 'passenger_t_minus_30':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_T_MINUS_30,
        text: `Aero Sarathi: Your driver ${d.driverName ?? ''} will arrive at ${when(
          d.scheduledAt,
        )} in ~${d.etaMin ?? 30} min for booking ${d.code}.`,
      };
    case 'passenger_no_driver_found':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_NO_DRIVER,
        text: `Aero Sarathi: We could not find a driver for booking ${d.code}. Full refund of Rs.${rupees(
          d.refundAmount ?? 0,
        )} initiated. Sorry - our team will reach out.`,
      };
    case 'passenger_driver_reassigned':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_DRIVER_REASSIGNED,
        text: `Aero Sarathi: New driver assigned for ${d.code}. ${d.driverName ?? ''} (${d.driverPhoneMasked ?? ''}) in ${d.carModel ?? 'car'} (${d.plate ?? ''}).`,
      };
    case 'passenger_driver_en_route':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_DRIVER_ASSIGNED,
        text: `Aero Sarathi: Your driver is on the way for booking ${d.code}. Track live: ${d.trackUrl ?? track}`,
      };
    case 'passenger_driver_arrived':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_DRIVER_ASSIGNED,
        text: `Aero Sarathi: Your driver has arrived for booking ${d.code}. Please head to the pickup point.`,
      };
    case 'passenger_ride_started':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_DRIVER_ASSIGNED,
        text: `Aero Sarathi: Your ride ${d.code} has started. Track live: ${d.trackUrl ?? track}`,
      };
    case 'passenger_ride_completed':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_DRIVER_ASSIGNED,
        text: `Aero Sarathi: Ride ${d.code} completed. Thank you for travelling with us!`,
      };
    case 'passenger_no_show':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_PASSENGER_DRIVER_ASSIGNED,
        text: `Aero Sarathi: Booking ${d.code} was marked as a no-show. Please contact support if this is a mistake.`,
      };
    case 'driver_no_show_recorded':
      return {
        channel: 'SMS',
        templateId: env.MSG91_TEMPLATE_DRIVER_ASSIGNMENT_CONFIRMED,
        text: `Aero Sarathi: No-show recorded for trip ${d.code}. You are free for new trips.`,
      };
  }
}

function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f8f7f4;font-family:Arial,Helvetica,sans-serif;color:#1e2d5a">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:20px;font-weight:700;color:#f48024;letter-spacing:0.5px">AERO SARATHI</div>
    <div style="background:#fff;border-radius:14px;padding:28px;margin-top:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
      ${bodyHtml}
    </div>
    <p style="font-size:12px;color:#6b6760;margin-top:20px">Aero Sarathi · Punjab. Need help? Reply to this email.</p>
  </div></body></html>`;
}

function detailRows(d: NotifData): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#6b6760">Booking</td><td style="padding:6px 0;text-align:right;font-weight:700">${d.code}</td></tr>
    <tr><td style="padding:6px 0;color:#6b6760">Pickup</td><td style="padding:6px 0;text-align:right">${d.pickup}</td></tr>
    <tr><td style="padding:6px 0;color:#6b6760">Drop</td><td style="padding:6px 0;text-align:right">${d.drop}</td></tr>
    <tr><td style="padding:6px 0;color:#6b6760">When</td><td style="padding:6px 0;text-align:right">${when(d.scheduledAt)}</td></tr>
  </table>`;
}

export function renderEmail(template: NotificationTemplate, d: NotifData): RenderedEmail {
  switch (template) {
    case 'booking_confirmed':
      return {
        channel: 'EMAIL',
        subject: `Booking confirmed — ${d.code}`,
        html: emailShell(
          `Hi ${d.passengerName}, your ride is confirmed`,
          `${detailRows(d)}
           <p style="font-size:14px;margin-top:16px">Token paid: <b>Rs.${rupees(d.tokenAmount)}</b> · Pay driver: <b>Rs.${rupees(
             d.balanceAmount,
           )}</b></p>
           <p style="font-size:13px;color:#6b6760">Download your receipt anytime from My Bookings.</p>`,
        ),
      };
    case 'payment_failed':
      return {
        channel: 'EMAIL',
        subject: `Payment failed — ${d.code}`,
        html: emailShell(
          'Your payment could not be completed',
          `${detailRows(d)}<p style="font-size:14px;margin-top:16px">No money was deducted. Please retry from My Bookings.</p>`,
        ),
      };
    case 'cancellation_confirmed':
      return {
        channel: 'EMAIL',
        subject: `Booking cancelled — ${d.code}`,
        html: emailShell(
          'Your booking has been cancelled',
          `${detailRows(d)}<p style="font-size:14px;margin-top:16px">Refund of <b>Rs.${rupees(
            d.refundAmount ?? 0,
          )}</b> will reach your source account in 5-7 working days.</p>`,
        ),
      };
    case 'refund_completed':
      return {
        channel: 'EMAIL',
        subject: `Refund processed — ${d.code}`,
        html: emailShell(
          'Your refund has been processed',
          `${detailRows(d)}<p style="font-size:14px;margin-top:16px">Rs.${rupees(
            d.refundAmount ?? 0,
          )} has been refunded to your original payment method.</p>`,
        ),
      };
    case 'passenger_driver_assigned':
      return {
        channel: 'EMAIL',
        subject: `Driver assigned — ${d.code}`,
        html: emailShell(
          `Your driver ${d.driverName ?? ''} is assigned`,
          `${detailRows(d)}<p style="font-size:14px;margin-top:16px">Car: <b>${d.carModel ?? ''}</b> (${d.plate ?? ''})<br/>Driver phone: <b>${d.driverPhoneMasked ?? ''}</b></p>`,
        ),
      };
    case 'passenger_no_driver_found':
      return {
        channel: 'EMAIL',
        subject: `Booking update — ${d.code}`,
        html: emailShell(
          'We could not find a driver',
          `${detailRows(d)}<p style="font-size:14px;margin-top:16px">A full refund of <b>Rs.${rupees(
            d.refundAmount ?? 0,
          )}</b> has been initiated. Our team will reach out to help re-book.</p>`,
        ),
      };
    case 'passenger_driver_reassigned':
      return {
        channel: 'EMAIL',
        subject: `New driver assigned — ${d.code}`,
        html: emailShell(
          `A new driver ${d.driverName ?? ''} is assigned`,
          `${detailRows(d)}<p style="font-size:14px;margin-top:16px">Car: <b>${d.carModel ?? ''}</b> (${d.plate ?? ''})<br/>Driver phone: <b>${d.driverPhoneMasked ?? ''}</b></p>`,
        ),
      };
    case 'passenger_ride_completed':
      return {
        channel: 'EMAIL',
        subject: `Ride completed — ${d.code}`,
        html: emailShell(
          `Thanks for riding with us, ${d.passengerName}`,
          `${detailRows(d)}<p style="font-size:14px;margin-top:16px">Your ride is complete. We hope you had a comfortable journey.</p>`,
        ),
      };
    case 'passenger_t_minus_30':
    case 'driver_offer':
    case 'driver_assignment_confirmed':
    case 'driver_trip_cancelled':
    case 'passenger_driver_en_route':
    case 'passenger_driver_arrived':
    case 'passenger_ride_started':
    case 'passenger_no_show':
    case 'driver_no_show_recorded':
      // SMS-only templates — no email variant.
      return {
        channel: 'EMAIL',
        subject: `Aero Sarathi — ${d.code}`,
        html: emailShell('Aero Sarathi', `${detailRows(d)}`),
      };
  }
}
