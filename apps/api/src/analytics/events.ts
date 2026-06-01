import { connectMongo, getMongo } from '../mongo.js';
import { logger } from '../logger.js';

export type AnalyticsEvent =
  | 'page_view'
  | 'booking_started'
  | 'quote_seen'
  | 'quote_created'
  | 'vehicle_selected'
  | 'otp_requested'
  | 'otp_verified'
  | 'otp_failed'
  | 'booking_created'
  // ── Phase 6 ──
  | 'surge_applied'
  | 'payment_succeeded'
  | 'booking_cancelled'
  | 'trip_completed'
  | 'no_show'
  | 'offer_sent'
  | 'offer_accepted'
  | 'offer_declined'
  | 'referral_signup'
  | 'referral_rewarded'
  | 'review_submitted'
  | 'wallet_credit'
  | 'wallet_debit'
  | 'track_page_view';

/** Fire-and-forget write to Mongo analytics_events. Never throws. */
export async function writeEvent(
  event: AnalyticsEvent,
  props: Record<string, unknown> = {},
  ctx: { userId?: string | null; sessionId?: string | null } = {},
): Promise<void> {
  try {
    const db = getMongo() ?? (await connectMongo());
    await db.collection('analytics_events').insertOne({
      event,
      ts: new Date(),
      userId: ctx.userId ?? null,
      sessionId: ctx.sessionId ?? null,
      props,
    });
  } catch (err) {
    logger.warn({ err, event }, 'analytics_write_failed');
  }
}
