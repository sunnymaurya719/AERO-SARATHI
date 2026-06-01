import { Router } from 'express';
import type { Router as ExpressRouter, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { prisma } from '../../prisma.js';
import { verifyTrackToken } from './track-token.js';
import { buildSnapshot, buildRoute } from './tracking.service.js';
import { raiseSos } from './sos.service.js';

/**
 * Public tracking API (Phase 5 §10). Every route is authorised by a signed HMAC
 * track token (`?t=`) bound to the `:code`. No session/login required.
 */
export const trackingRouter: ExpressRouter = Router();

// Feature gate.
trackingRouter.use((_req: Request, res: Response, next: NextFunction) => {
  if (!env.TRACKING_ENABLED) {
    res.status(404).json({ type: 'about:blank', title: 'NotFound', status: 404, detail: 'Tracking disabled' });
    return;
  }
  next();
});

const ParamsSchema = z.object({ code: z.string().min(4).max(32) });
const TokenSchema = z.object({ t: z.string().min(8) });

interface TrackRequest extends Request {
  bookingId?: string;
}

/** Verify the token + code pairing and stash the resolved bookingId. */
async function requireTrackToken(req: TrackRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = ParamsSchema.parse(req.params);
    const { t } = TokenSchema.parse(req.query);
    const bookingId = await verifyTrackToken(t);
    if (!bookingId) return next(Errors.unauthorized('invalid_or_expired_link'));
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { code: true } });
    if (!booking || booking.code !== code) return next(Errors.unauthorized('invalid_or_expired_link'));
    req.bookingId = bookingId;
    next();
  } catch (err) {
    next(err);
  }
}

// No-index + tight cache headers for the public surface.
trackingRouter.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

trackingRouter.get('/:code/snapshot', requireTrackToken, async (req, res, next) => {
  try {
    res.status(200).json(await buildSnapshot((req as TrackRequest).bookingId!));
  } catch (err) {
    next(err);
  }
});

trackingRouter.get('/:code/route', requireTrackToken, async (req, res, next) => {
  try {
    const route = await buildRoute((req as TrackRequest).bookingId!);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).json(route);
  } catch (err) {
    next(err);
  }
});

const SosSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  message: z.string().max(500).optional(),
});

trackingRouter.post('/:code/sos', requireTrackToken, async (req, res, next) => {
  try {
    if (!env.SOS_ENABLED) throw Errors.conflict('sos_disabled');
    const body = SosSchema.parse(req.body ?? {});
    const result = await raiseSos({
      bookingId: (req as TrackRequest).bookingId!,
      triggeredBy: 'PASSENGER',
      lat: body.lat,
      lng: body.lng,
      message: body.message,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});
