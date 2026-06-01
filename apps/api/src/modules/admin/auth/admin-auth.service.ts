import { randomBytes, createHash } from 'node:crypto';
import type { AdminRole } from '@aero/db';
import { prisma } from '../../../prisma.js';
import { redis } from '../../../redis.js';
import { env } from '../../../env.js';
import { Errors } from '../../../errors.js';
import { logger } from '../../../logger.js';
import { verifyPassword, hashPassword } from './password.js';
import { verifyTotp, generateTotpSecret, otpauthUri } from './totp.js';
import { generateCsrfToken } from './csrf.js';
import { hashSessionToken } from '../../../middleware/admin-session.js';

const CHALLENGE_TTL_SEC = 5 * 60; // 5 min

export interface LoginResult {
  requires2fa: true;
  challengeId: string;
}

export interface SessionTokens {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

interface Challenge {
  userId: string;
}

/** Step 1: email + password. Always returns a 2FA challenge (TOTP mandatory). */
export async function login(email: string, password: string, ip: string): Promise<LoginResult> {
  const user = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  const now = new Date();

  // Constant-ish work even when user missing to avoid trivial enumeration.
  if (!user) {
    await verifyPassword('$argon2id$v=19$m=65536,t=3,p=1$ZHVtbXlzYWx0$0000000000000000000000000000000000000000000', password);
    logger.warn({ email, ip }, 'admin login: unknown email');
    throw Errors.unauthorized('Invalid credentials');
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    throw Errors.tooMany('Account temporarily locked. Try again later.');
  }
  if (user.status !== 'ACTIVE') throw Errors.forbidden('Account disabled');

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    await registerFailedAttempt(user.id);
    throw Errors.unauthorized('Invalid credentials');
  }

  if (!user.totpEnabled || !user.totpSecret) {
    // TOTP is mandatory; force enrolment via a challenge that the 2FA step
    // rejects until enrolment is completed. We surface a clear error instead.
    throw Errors.forbidden('Two-factor enrolment required. Complete TOTP setup first.');
  }

  // Reset failure counter on a correct password.
  if (user.failedAttempts > 0) {
    await prisma.adminUser.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
  }

  const challengeId = randomBytes(24).toString('hex');
  await redis.set(`admin:challenge:${challengeId}`, JSON.stringify({ userId: user.id } satisfies Challenge), 'EX', CHALLENGE_TTL_SEC);
  return { requires2fa: true, challengeId };
}

async function registerFailedAttempt(userId: string): Promise<void> {
  const user = await prisma.adminUser.update({
    where: { id: userId },
    data: { failedAttempts: { increment: 1 } },
  });
  if (user.failedAttempts >= env.ADMIN_LOGIN_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + env.ADMIN_LOCK_MINUTES * 60_000);
    await prisma.adminUser.update({ where: { id: userId }, data: { lockedUntil, failedAttempts: 0 } });
    logger.warn({ userId, lockedUntil }, 'admin account locked after repeated failures');
  }
}

/** Step 2: verify TOTP, mint a session + CSRF token. Replay-protected per window. */
export async function verify2fa(
  challengeId: string,
  code: string,
  ip: string,
  userAgent: string,
): Promise<SessionTokens> {
  const raw = await redis.get(`admin:challenge:${challengeId}`);
  if (!raw) throw Errors.unauthorized('Challenge expired');
  const { userId } = JSON.parse(raw) as Challenge;

  const user = await prisma.adminUser.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'ACTIVE' || !user.totpSecret) throw Errors.unauthorized('Invalid challenge');

  if (!verifyTotp(user.totpSecret, code)) {
    await registerFailedAttempt(user.id);
    throw Errors.unauthorized('Invalid code');
  }

  // Prevent replay of the same code within its validity window.
  const codeKey = `admin:totp:used:${user.id}:${code.replace(/\s+/g, '')}`;
  const firstUse = await redis.set(codeKey, '1', 'EX', 90, 'NX');
  if (firstUse !== 'OK') throw Errors.unauthorized('Code already used');

  await redis.del(`admin:challenge:${challengeId}`);

  const sessionToken = randomBytes(32).toString('hex');
  const csrfToken = generateCsrfToken();
  const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_TTL_SEC * 1000);

  await prisma.adminSession.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      csrfToken,
      ip,
      userAgent: userAgent.slice(0, 255),
      expiresAt,
    },
  });
  await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedAttempts: 0 } });

  return { sessionToken, csrfToken, expiresAt };
}

export async function logout(sessionId: string): Promise<void> {
  await prisma.adminSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }).catch(() => {});
}

/** Begin TOTP enrolment: generate a secret (not yet enabled), return otpauth URI. */
export async function beginTotpEnrol(userId: string): Promise<{ secret: string; otpauthUri: string }> {
  const user = await prisma.adminUser.findUnique({ where: { id: userId } });
  if (!user) throw Errors.notFound('User not found');
  if (user.totpEnabled) throw Errors.conflict('TOTP already enabled');
  const secret = generateTotpSecret();
  await prisma.adminUser.update({ where: { id: userId }, data: { totpSecret: secret } });
  return { secret, otpauthUri: otpauthUri(user.email, secret) };
}

/** Confirm enrolment by verifying a code against the pending secret. */
export async function confirmTotpEnrol(userId: string, code: string): Promise<void> {
  const user = await prisma.adminUser.findUnique({ where: { id: userId } });
  if (!user || !user.totpSecret) throw Errors.validation('No pending enrolment');
  if (!verifyTotp(user.totpSecret, code)) throw Errors.unauthorized('Invalid code');
  await prisma.adminUser.update({ where: { id: userId }, data: { totpEnabled: true } });
}

/** List active (non-revoked, unexpired) sessions for the current admin. */
export async function listSessions(userId: string) {
  return prisma.adminSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
  });
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.adminSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) throw Errors.notFound('Session not found');
  await prisma.adminSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

/** Accept an invite: set password, create TOTP secret, activate on first 2FA. */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ secret: string; otpauthUri: string; email: string }> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const invite = await prisma.adminInvite.findUnique({ where: { tokenHash } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw Errors.gone('Invite invalid or expired');
  if (password.length < 12) throw Errors.validation('Password must be at least 12 characters');

  const existing = await prisma.adminUser.findUnique({ where: { email: invite.email } });
  if (existing) throw Errors.conflict('User already exists');

  const passwordHash = await hashPassword(password);
  const secret = generateTotpSecret();
  const user = await prisma.adminUser.create({
    data: {
      email: invite.email,
      name: invite.email.split('@')[0] ?? invite.email,
      passwordHash,
      role: invite.role as AdminRole,
      totpSecret: secret,
      totpEnabled: false,
      createdById: invite.invitedById,
    },
  });
  await prisma.adminInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
  return { secret, otpauthUri: otpauthUri(user.email, secret), email: user.email };
}
