import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requestOtp } from '../auth/otp.service.js';
import { verifyDriverOtp } from './driver-auth.service.js';
import { rotateRefresh, logout } from '../auth/auth.service.js';
import { ipRateLimit } from '../../middleware/rate-limit.js';
import { requireAuth } from '../../middleware/auth.js';

export const driverAuthRouter: ExpressRouter = Router();

const PhoneSchema = z.object({ phone: z.string().regex(/^\+91\d{10}$/, 'phone must be +91 followed by 10 digits') });
const VerifySchema = PhoneSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const RefreshSchema = z.object({ refreshToken: z.string().min(10) });

function clientIp(req: { ip?: string; socket: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

driverAuthRouter.post(
  '/otp/request',
  ipRateLimit({ keyPrefix: 'rl:drv:otpreq', points: 20, durationSec: 3600 }),
  async (req, res, next) => {
    try {
      const { phone } = PhoneSchema.parse(req.body);
      const result = await requestOtp(phone, clientIp(req));
      res.status(200).json({ otpId: result.otpId, expiresInSec: result.expiresInSec, channel: 'sms' });
    } catch (err) {
      next(err);
    }
  },
);

driverAuthRouter.post('/otp/verify', async (req, res, next) => {
  try {
    const { phone, code } = VerifySchema.parse(req.body);
    const tokens = await verifyDriverOtp(phone, code, {
      userAgent: req.header('user-agent'),
      ip: clientIp(req),
    });
    res.status(200).json(tokens);
  } catch (err) {
    next(err);
  }
});

driverAuthRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = RefreshSchema.parse(req.body);
    const tokens = await rotateRefresh(refreshToken, { userAgent: req.header('user-agent'), ip: clientIp(req) });
    res.status(200).json(tokens);
  } catch (err) {
    next(err);
  }
});

driverAuthRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const { refreshToken } = RefreshSchema.parse(req.body);
    await logout(refreshToken, req.user?.jti, 900);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
