import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { prisma } from '../../prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { Errors } from '../../errors.js';

export const meRouter: ExpressRouter = Router();

meRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, phone: true, name: true, email: true, role: true, createdAt: true },
    });
    if (!user) throw Errors.notFound('User not found');
    res.status(200).json({ ...user, createdAt: user.createdAt.toISOString() });
  } catch (err) {
    next(err);
  }
});
