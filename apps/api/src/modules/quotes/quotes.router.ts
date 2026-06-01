import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { QuoteRequestSchema } from './quotes.schema.js';
import { createQuote } from './quotes.service.js';
import { ipRateLimit } from '../../middleware/rate-limit.js';
import { writeEvent } from '../../analytics/events.js';

export const quotesRouter: ExpressRouter = Router();

quotesRouter.post('/', ipRateLimit({ keyPrefix: 'rl:quotes', points: 30, durationSec: 60 }), async (req, res, next) => {
  try {
    const input = QuoteRequestSchema.parse(req.body);
    const quote = await createQuote(input);
    void writeEvent('quote_created', { quoteId: quote.quoteId, distanceKm: quote.distanceKm });
    res.status(200).json(quote);
  } catch (err) {
    next(err);
  }
});
