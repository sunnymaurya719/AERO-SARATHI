import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import { prisma } from '../../../prisma.js';
import { recomputeDriverRating } from '../../review/review.service.js';

export const adminReviewsRouter: ExpressRouter = Router();

adminReviewsRouter.get('/', requirePermission('reviews.view'), async (req, res, next) => {
  try {
    const hidden = req.query.hidden === 'true' ? true : req.query.hidden === 'false' ? false : undefined;
    const reviews = await prisma.review.findMany({
      where: { ...(hidden !== undefined ? { hidden } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.status(200).json(reviews);
  } catch (err) {
    next(err);
  }
});

const ModerateBody = z.object({ hidden: z.boolean() });

adminReviewsRouter.post('/:id/moderate', requirePermission('reviews.moderate'), async (req, res, next) => {
  try {
    const { hidden } = ModerateBody.parse(req.body);
    const id = String(req.params.id);
    const review = await prisma.review.update({ where: { id }, data: { hidden } });
    if (review.direction === 'CUSTOMER_TO_DRIVER') {
      await recomputeDriverRating(review.rateeId);
    }
    await audit({ req: req as AdminRequest, action: 'reviews.moderate', entity: { type: 'Review', id }, after: { hidden } });
    res.status(200).json(review);
  } catch (err) {
    next(err);
  }
});
