import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { ipRateLimit } from '../../../middleware/rate-limit.js';
import { adminSession, type AdminRequest } from '../../../middleware/admin-session.js';
import { csrfDoubleSubmit } from './csrf.js';
import { env } from '../../../env.js';
import { Errors } from '../../../errors.js';
import { prisma } from '../../../prisma.js';
import {
  login,
  verify2fa,
  logout,
  beginTotpEnrol,
  confirmTotpEnrol,
  listSessions,
  revokeSession,
  acceptInvite,
} from './admin-auth.service.js';
import { setSessionCookies, clearSessionCookies, setChallengeCookie, clearChallengeCookie } from './cookies.js';

export const adminAuthRouter: ExpressRouter = Router();

const loginLimit = ipRateLimit({ keyPrefix: 'admin:login', points: 5, durationSec: 60 });
const twofaLimit = ipRateLimit({ keyPrefix: 'admin:2fa', points: 5, durationSec: 60 });

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const TwoFaSchema = z.object({ challengeId: z.string().min(1), code: z.string().min(6).max(8) });
const CodeSchema = z.object({ code: z.string().min(6).max(8) });
const AcceptSchema = z.object({ token: z.string().min(1), password: z.string().min(12) });

adminAuthRouter.post('/login', loginLimit, async (req, res, next) => {
  try {
    const { email, password } = LoginSchema.parse(req.body);
    const result = await login(email, password, req.ip ?? 'unknown');
    setChallengeCookie(res, result.challengeId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/2fa', twofaLimit, async (req, res, next) => {
  try {
    const { challengeId, code } = TwoFaSchema.parse(req.body);
    const tokens = await verify2fa(challengeId, code, req.ip ?? 'unknown', req.header('user-agent') ?? 'unknown');
    setSessionCookies(res, tokens.sessionToken, tokens.csrfToken, env.ADMIN_SESSION_TTL_SEC);
    clearChallengeCookie(res);
    res.status(200).json({ ok: true, expiresAt: tokens.expiresAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/logout', adminSession, csrfDoubleSubmit, async (req, res, next) => {
  try {
    await logout((req as AdminRequest).admin!.sessionId);
    clearSessionCookies(res);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.get('/me', adminSession, async (req, res, next) => {
  try {
    const admin = (req as AdminRequest).admin!;
    const user = await prisma.adminUser.findUnique({
      where: { id: admin.id },
      select: { id: true, email: true, name: true, role: true, totpEnabled: true },
    });
    if (!user) return next(Errors.notFound('Admin not found'));
    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/totp/enrol', adminSession, csrfDoubleSubmit, async (req, res, next) => {
  try {
    const result = await beginTotpEnrol((req as AdminRequest).admin!.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/totp/verify-enrol', adminSession, csrfDoubleSubmit, async (req, res, next) => {
  try {
    const { code } = CodeSchema.parse(req.body);
    await confirmTotpEnrol((req as AdminRequest).admin!.id, code);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.get('/sessions', adminSession, async (req, res, next) => {
  try {
    const sessions = await listSessions((req as AdminRequest).admin!.id);
    res.status(200).json({ items: sessions });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/sessions/:id/revoke', adminSession, csrfDoubleSubmit, async (req, res, next) => {
  try {
    await revokeSession((req as AdminRequest).admin!.id, String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post('/accept-invite', loginLimit, async (req, res, next) => {
  try {
    const { token, password } = AcceptSchema.parse(req.body);
    const result = await acceptInvite(token, password);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// Guard against accidental misuse: this router never returns 404 default.
adminAuthRouter.use((_req, _res, next) => next(Errors.notFound('Unknown admin auth route')));
