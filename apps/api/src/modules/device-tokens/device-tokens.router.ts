import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { registerDeviceToken, revokeDeviceToken } from './device-tokens.service.js';

export const deviceTokensRouter: ExpressRouter = Router();

const RegisterSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(['ANDROID', 'IOS']),
  appVersion: z.string().min(1).max(32),
});

/** Register / refresh this device's customer push token. */
deviceTokensRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = RegisterSchema.parse(req.body);
    await registerDeviceToken({ userId: req.user!.id, ...body });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const RevokeSchema = z.object({ token: z.string().min(10).max(4096) });

/** Revoke this device's push token (logout). */
deviceTokensRouter.delete('/', requireAuth, async (req, res, next) => {
  try {
    const { token } = RevokeSchema.parse(req.body);
    await revokeDeviceToken(req.user!.id, token);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
