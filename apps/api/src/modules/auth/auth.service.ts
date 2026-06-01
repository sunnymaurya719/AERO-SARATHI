import bcrypt from 'bcryptjs';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { redis } from '../../redis.js';
import { Errors } from '../../errors.js';
import { signAccessToken, generateRefreshToken } from './tokens.js';
import type { AuthTokenResponse } from '@aero/types';

interface IssueContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

/** Issue an access + refresh token pair, persisting a hashed refresh session. */
export async function issueTokens(userId: string, ctx: IssueContext): Promise<AuthTokenResponse> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { token: accessToken } = await signAccessToken(user.id, user.role);

  const refreshToken = generateRefreshToken();
  const refreshHash = await bcrypt.hash(refreshToken, 10);
  await prisma.session.create({
    data: {
      userId: user.id,
      refreshHash,
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000),
    },
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, phone: user.phone, name: user.name },
  };
}

/** Rotate a refresh token: validate, revoke old session, issue a new pair. */
export async function rotateRefresh(refreshToken: string, ctx: IssueContext): Promise<AuthTokenResponse> {
  const sessions = await prisma.session.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  let matched: (typeof sessions)[number] | undefined;
  for (const s of sessions) {
    if (await bcrypt.compare(refreshToken, s.refreshHash)) {
      matched = s;
      break;
    }
  }
  if (!matched) throw Errors.unauthorized('Invalid refresh token');

  await prisma.session.update({ where: { id: matched.id }, data: { revokedAt: new Date() } });
  return issueTokens(matched.userId, ctx);
}

/** Revoke a session by refresh token and denylist the access token jti. */
export async function logout(refreshToken: string, jti: string | undefined, accessTtlRemaining: number): Promise<void> {
  const sessions = await prisma.session.findMany({ where: { revokedAt: null } });
  for (const s of sessions) {
    if (await bcrypt.compare(refreshToken, s.refreshHash)) {
      await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
      break;
    }
  }
  if (jti && accessTtlRemaining > 0) {
    await redis.set(`jwt:denylist:${jti}`, '1', 'EX', accessTtlRemaining);
  }
}
