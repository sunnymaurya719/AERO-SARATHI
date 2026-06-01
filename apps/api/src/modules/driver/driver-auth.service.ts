import bcrypt from 'bcryptjs';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { signAccessToken, generateRefreshToken } from '../auth/tokens.js';
import { verifyOtp } from '../auth/otp.service.js';
import type { AuthTokenResponse } from '@aero/types';

interface IssueContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

/**
 * Issue tokens for a driver. The access token is signed with the DRIVER role
 * regardless of the underlying User.role so the driver portal + socket auth
 * gate correctly.
 */
async function issueDriverTokens(userId: string, ctx: IssueContext): Promise<AuthTokenResponse> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { token: accessToken } = await signAccessToken(user.id, 'DRIVER');

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

  return { accessToken, refreshToken, user: { id: user.id, phone: user.phone, name: user.name } };
}

/**
 * Verify a driver's OTP and issue DRIVER-scoped tokens. The phone must already
 * map to an onboarded Driver record; otherwise the login is rejected. The
 * Driver.userId link is established lazily on first successful login.
 */
export async function verifyDriverOtp(
  phone: string,
  code: string,
  ctx: IssueContext,
): Promise<AuthTokenResponse> {
  const { userId } = await verifyOtp(phone, code);

  // The phone must belong to a known driver.
  const driver = await prisma.driver.findUnique({ where: { phone } });
  if (!driver) throw Errors.forbidden('not_a_driver');
  if (driver.status === 'SUSPENDED' || driver.status === 'DISABLED') {
    throw Errors.forbidden('driver_inactive');
  }

  // Bind the user account to the driver on first login, and ensure the user
  // carries the DRIVER role so refreshed tokens stay driver-scoped.
  if (driver.userId !== userId) {
    await prisma.driver.update({ where: { id: driver.id }, data: { userId } });
  }
  await prisma.user.update({ where: { id: userId }, data: { role: 'DRIVER' } });

  return issueDriverTokens(userId, ctx);
}
