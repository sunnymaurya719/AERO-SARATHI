import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import type { AdminRole } from '@aero/db';
import { prisma } from '../prisma.js';
import { env } from '../env.js';

export const ADMIN_SID_COOKIE = '__Host-admin_sid';

export interface AdminContext {
  id: string;
  role: AdminRole;
  email: string;
  sessionId: string;
  csrfToken: string;
  ip: string;
}

export interface AdminRequest extends Request {
  admin?: AdminContext;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Validates the admin session cookie. Enforces absolute expiry, idle timeout
 * (revokes the session on breach), and active user status. On success, attaches
 * req.admin and touches lastSeenAt (fire-and-forget).
 */
export async function adminSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[ADMIN_SID_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }

  const tokenHash = hashSessionToken(token);
  const session = await prisma.adminSession.findUnique({ where: { tokenHash }, include: { user: true } });
  const now = new Date();

  if (!session || session.revokedAt || session.expiresAt < now) {
    res.status(401).json({ error: 'session_expired' });
    return;
  }

  const idleMs = env.ADMIN_SESSION_IDLE_SEC * 1000;
  if (now.getTime() - session.lastSeenAt.getTime() > idleMs) {
    await prisma.adminSession.update({ where: { id: session.id }, data: { revokedAt: now } });
    res.status(401).json({ error: 'idle_timeout' });
    return;
  }

  if (session.user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'user_disabled' });
    return;
  }

  // Touch lastSeenAt without blocking the request.
  void prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});

  (req as AdminRequest).admin = {
    id: session.user.id,
    role: session.user.role,
    email: session.user.email,
    sessionId: session.id,
    csrfToken: session.csrfToken,
    ip: req.ip ?? 'unknown',
  };
  next();
}
