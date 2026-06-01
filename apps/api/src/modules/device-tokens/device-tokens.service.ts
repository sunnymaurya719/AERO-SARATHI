import { prisma } from '../../prisma.js';

export type DevicePlatform = 'ANDROID' | 'IOS';

/**
 * Register (or refresh) a customer's push token. Idempotent on the unique token:
 * re-registering the same token re-points it at the current user and un-revokes
 * it. A token can only belong to one user at a time (handset re-login).
 */
export async function registerDeviceToken(input: {
  userId: string;
  token: string;
  platform: DevicePlatform;
  appVersion: string;
}): Promise<void> {
  await prisma.deviceToken.upsert({
    where: { token: input.token },
    create: {
      userId: input.userId,
      token: input.token,
      platform: input.platform,
      appVersion: input.appVersion,
    },
    update: {
      userId: input.userId,
      platform: input.platform,
      appVersion: input.appVersion,
      lastSeenAt: new Date(),
      revokedAt: null,
    },
  });
}

/** Soft-revoke a token (logout / uninstall signal). No-op if unknown. */
export async function revokeDeviceToken(userId: string, token: string): Promise<void> {
  await prisma.deviceToken.updateMany({
    where: { token, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
