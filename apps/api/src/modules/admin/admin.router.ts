import { Router } from 'express';
import type { Router as ExpressRouter, Request, Response, NextFunction } from 'express';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { adminSession } from '../../middleware/admin-session.js';
import { csrfDoubleSubmit } from './auth/csrf.js';
import { adminAuthRouter } from './auth/admin-auth.router.js';
import { dashboardRouter } from './dashboard/dashboard.router.js';
import { adminBookingsRouter } from './bookings/admin-bookings.router.js';
import { adminDriversRouter } from './drivers/admin-drivers.router.js';
import { adminVehiclesRouter } from './vehicles/admin-vehicles.router.js';
import { adminFareRulesRouter } from './fare-rules/admin-fare-rules.router.js';
import { adminRefundsRouter } from './refunds/admin-refunds.router.js';
import { adminWebhooksRouter } from './webhooks/admin-webhooks.router.js';
import { adminAuditRouter } from './audit/admin-audit.router.js';
import { adminUsersRouter } from './users/admin-users.router.js';
import { alertsRouter } from '../alerts/alerts.router.js';
import { adminPricingRouter } from './pricing/admin-pricing.router.js';
import { adminFinanceRouter } from './finance/admin-finance.router.js';
import { adminEmiRouter } from './emi/admin-emi.router.js';
import { adminReviewsRouter } from './reviews/admin-reviews.router.js';
import { adminCitiesRouter } from './cities/admin-cities.router.js';

/** Optional IP allowlist gate (CIDR-free exact-match on remote address). */
function ipAllowlist(req: Request, _res: Response, next: NextFunction): void {
  if (env.ADMIN_IP_ALLOWLIST.length === 0) return next();
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  if (env.ADMIN_IP_ALLOWLIST.includes(ip)) return next();
  next(Errors.forbidden('IP not allowed'));
}

/**
 * Composes the admin API. The auth router (login / 2fa / accept-invite) is
 * mounted BEFORE the session+CSRF gate; every other route requires a valid
 * admin session and a matching CSRF double-submit token.
 */
export const adminRouter: ExpressRouter = Router();

adminRouter.use(ipAllowlist);

// Public (session-less) auth endpoints. The router self-applies session/CSRF
// to its protected routes (logout, totp enrol, sessions).
adminRouter.use('/auth', adminAuthRouter);

// Everything below requires an authenticated admin session + CSRF.
adminRouter.use(adminSession);
adminRouter.use(csrfDoubleSubmit);

adminRouter.use('/dashboard', dashboardRouter);
adminRouter.use('/bookings', adminBookingsRouter);
adminRouter.use('/drivers', adminDriversRouter);
adminRouter.use('/vehicles', adminVehiclesRouter);
adminRouter.use('/fare-rules', adminFareRulesRouter);
adminRouter.use('/refunds', adminRefundsRouter);
adminRouter.use('/webhooks', adminWebhooksRouter);
adminRouter.use('/audit', adminAuditRouter);
adminRouter.use('/users', adminUsersRouter);
adminRouter.use('/alerts', alertsRouter);
adminRouter.use('/pricing', adminPricingRouter);
adminRouter.use('/finance', adminFinanceRouter);
adminRouter.use('/emi', adminEmiRouter);
adminRouter.use('/reviews', adminReviewsRouter);
adminRouter.use('/cities', adminCitiesRouter);

adminRouter.use((_req, res) => {
  res.status(404).json({ type: 'about:blank', title: 'NotFound', status: 404, detail: 'Admin route not found' });
});
