import { Router } from 'express';
import type { Router as ExpressRouter, Request, Response, NextFunction } from 'express';
import { env } from '../../env.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { driverAuthRouter } from './driver-auth.router.js';
import { driverMeRouter } from './driver-me.router.js';
import { driverOffersRouter } from './driver-offers.router.js';
import { driverTripsRouter } from './driver-trips.router.js';
import { driverEarningsRouter } from './driver-earnings.router.js';
import { driverChatRouter } from './driver-chat.router.js';
import { requireDriver } from './driver.middleware.js';

/**
 * Driver portal API (Phase 4 §9). Auth routes are public (OTP); everything else
 * requires a DRIVER-scoped access token plus a loaded Driver row.
 */
export const driverRouter: ExpressRouter = Router();

// Feature flag gate — return 404 when the portal is disabled.
driverRouter.use((_req: Request, res: Response, next: NextFunction) => {
  if (!env.DRIVER_PORTAL_ENABLED) {
    res.status(404).json({ type: 'about:blank', title: 'NotFound', status: 404, detail: 'Driver portal disabled' });
    return;
  }
  next();
});

driverRouter.use('/auth', driverAuthRouter);

// Authenticated driver area.
driverRouter.use(requireAuth, requireRole('DRIVER'), requireDriver);
driverRouter.use(driverMeRouter);
driverRouter.use('/offers', driverOffersRouter);
driverRouter.use('/trips', driverTripsRouter);
driverRouter.use(driverEarningsRouter);
driverRouter.use(driverChatRouter);

driverRouter.use((_req, res) => {
  res.status(404).json({ type: 'about:blank', title: 'NotFound', status: 404, detail: 'Driver route not found' });
});
