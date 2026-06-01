import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { requirePermission } from '../../../rbac/middleware.js';
import { getDashboard } from './dashboard.service.js';

export const dashboardRouter: ExpressRouter = Router();

dashboardRouter.get('/', requirePermission('dashboard.view'), async (_req, res, next) => {
  try {
    res.status(200).json(await getDashboard());
  } catch (err) {
    next(err);
  }
});
