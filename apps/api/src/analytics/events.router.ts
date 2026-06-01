import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { writeEvent, type AnalyticsEvent } from './events.js';

export const eventsRouter: ExpressRouter = Router();

const KNOWN_EVENTS: readonly AnalyticsEvent[] = [
  'page_view', 'booking_started', 'quote_seen', 'quote_created', 'vehicle_selected',
  'otp_requested', 'otp_verified', 'otp_failed', 'booking_created',
  'surge_applied', 'payment_succeeded', 'booking_cancelled', 'trip_completed', 'no_show',
  'offer_sent', 'offer_accepted', 'offer_declined', 'referral_signup', 'referral_rewarded',
  'review_submitted', 'wallet_credit', 'wallet_debit', 'track_page_view',
];

const EventItem = z.object({
  event: z.enum(KNOWN_EVENTS as [AnalyticsEvent, ...AnalyticsEvent[]]),
  props: z.record(z.unknown()).optional(),
  sessionId: z.string().max(128).optional(),
});
const BatchSchema = z.object({ events: z.array(EventItem).min(1).max(20) });

/** Public batched client-event ingest (fire-and-forget, max 20 per call). */
eventsRouter.post('/', async (req, res, next) => {
  try {
    const { events } = BatchSchema.parse(req.body);
    const userId = req.user?.id ?? null;
    for (const e of events) {
      void writeEvent(e.event, e.props ?? {}, { userId, sessionId: e.sessionId ?? null });
    }
    res.status(202).json({ accepted: events.length });
  } catch (err) {
    next(err);
  }
});
