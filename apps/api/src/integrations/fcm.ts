import { env } from '../env.js';
import { logger } from '../logger.js';
import { prisma } from '../prisma.js';

/**
 * Firebase Cloud Messaging (web push) for driver offer notifications.
 *
 * Graceful degradation: when FCM credentials are not configured (local/dev),
 * sends are logged and skipped — SMS remains the guaranteed channel. When
 * configured, uses the FCM HTTP v1 API with a service-account bearer token.
 */

export function isFcmConfigured(): boolean {
  return Boolean(env.FCM_PROJECT_ID && env.FCM_PRIVATE_KEY && env.FCM_CLIENT_EMAIL);
}

export interface FcmDataMessage {
  type: string;
  offerId?: string;
  code?: string;
  expiresAt?: string;
  deepLink?: string;
  [k: string]: string | undefined;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  // Build a JWT assertion signed with the service-account private key (RS256).
  const { SignJWT, importPKCS8 } = await import('jose');
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.FCM_CLIENT_EMAIL)
    .setSubject(env.FCM_CLIENT_EMAIL)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`fcm_token_failed_${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/**
 * Send a data-only message to all active tokens of a driver. Returns the count
 * sent. On `registration-token-not-registered` errors, soft-deletes the token.
 */
export async function sendOfferPush(driverId: string, data: FcmDataMessage): Promise<number> {
  const tokens = await prisma.driverFcmToken.findMany({
    where: { driverId, revokedAt: null },
  });
  if (tokens.length === 0) return 0;

  if (!isFcmConfigured()) {
    logger.info({ driverId, count: tokens.length, type: data.type }, 'fcm_bypass: push not sent');
    return 0;
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    logger.warn({ err: (err as Error).message, driverId }, 'fcm_auth_failed');
    return 0;
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  const cleanData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (v != null) cleanData[k] = v;

  let sent = 0;
  for (const t of tokens) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: t.token, data: cleanData } }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        sent += 1;
        await prisma.driverFcmToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
      } else {
        const body = await res.text();
        if (body.includes('registration-token-not-registered') || res.status === 404) {
          await prisma.driverFcmToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
        }
        logger.warn({ driverId, status: res.status }, 'fcm_send_failed');
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, driverId }, 'fcm_send_error');
    }
  }
  return sent;
}

export interface FcmNotification {
  title: string;
  body: string;
}

/**
 * Send a notification (+ optional data) to all active DeviceTokens of a customer
 * (Phase 7 native passenger push). Soft-deletes dead tokens. Returns count sent.
 */
export async function sendCustomerPush(
  userId: string,
  notification: FcmNotification,
  data: Record<string, string> = {},
): Promise<number> {
  const tokens = await prisma.deviceToken.findMany({ where: { userId, revokedAt: null } });
  if (tokens.length === 0) return 0;

  if (!isFcmConfigured()) {
    logger.info({ userId, count: tokens.length }, 'fcm_bypass: customer push not sent');
    return 0;
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId }, 'fcm_auth_failed');
    return 0;
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`;
  const cleanData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (v != null) cleanData[k] = String(v);

  let sent = 0;
  for (const t of tokens) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: t.token, notification, data: cleanData } }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        sent += 1;
        await prisma.deviceToken.update({ where: { id: t.id }, data: { lastSeenAt: new Date() } });
      } else {
        const body = await res.text();
        if (body.includes('registration-token-not-registered') || res.status === 404) {
          await prisma.deviceToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
        }
        logger.warn({ userId, status: res.status }, 'customer_push_failed');
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, userId }, 'customer_push_error');
    }
  }
  return sent;
}
