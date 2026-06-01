import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { prisma } from '../../prisma.js';
import { writeEvent } from '../../analytics/events.js';
import { ensureReferralCode, applyReferral } from './referral.service.js';

export const referralRouter: ExpressRouter = Router();

referralRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const code = await ensureReferralCode(userId);
    const [referrals, rewarded] = await Promise.all([
      prisma.referral.findMany({ where: { referrerId: userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.referral.count({ where: { referrerId: userId, status: 'REWARDED' } }),
    ]);
    res.status(200).json({ code, rewardedCount: rewarded, referrals });
  } catch (err) {
    next(err);
  }
});

const ApplyBody = z.object({ code: z.string().min(1).max(32), deviceHash: z.string().max(128).optional() });

referralRouter.post('/apply', requireAuth, async (req, res, next) => {
  try {
    const body = ApplyBody.parse(req.body);
    const result = await applyReferral({ refereeId: req.user!.id, code: body.code, deviceHash: body.deviceHash });
    void writeEvent('referral_signup', { referralId: result.id }, { userId: req.user!.id });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
