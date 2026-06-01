import { prisma } from '../../prisma.js';
import { env } from '../../env.js';

export type DevicePlatform = 'ANDROID' | 'IOS';
export type MobileApp = 'passenger' | 'driver';

export interface MobileConfig {
  app: MobileApp;
  platform: DevicePlatform;
  minSupported: string;
  latest: string;
  maintenance: boolean;
  message: string | null;
  /** Client is below minSupported and MUST update before continuing. */
  forceUpdate: boolean;
  /** A newer (non-blocking) version is available. */
  updateAvailable: boolean;
}

/**
 * PURE: compare two dotted semver-ish strings (major.minor.patch). Missing
 * segments are treated as 0; non-numeric segments as 0. Returns -1/0/1.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/** PURE: client must force-update when its version is strictly below minSupported. */
export function isForceUpdate(clientVersion: string, minSupported: string): boolean {
  return compareVersions(clientVersion, minSupported) < 0;
}

/** PURE: a soft update banner shows when client is below latest but >= minSupported. */
export function isUpdateAvailable(clientVersion: string, latest: string): boolean {
  return compareVersions(clientVersion, latest) < 0;
}

function envFallback(app: MobileApp): { min: string; latest: string } {
  return app === 'driver'
    ? { min: env.MOBILE_DRIVER_MIN_VERSION, latest: env.MOBILE_DRIVER_LATEST_VERSION }
    : { min: env.MOBILE_PASSENGER_MIN_VERSION, latest: env.MOBILE_PASSENGER_LATEST_VERSION };
}

/**
 * Resolve the version policy for an app/platform from AppVersionPolicy, falling
 * back to env defaults when no row exists, then evaluate the gate for the given
 * client version.
 */
export async function resolveMobileConfig(
  app: MobileApp,
  platform: DevicePlatform,
  clientVersion: string,
): Promise<MobileConfig> {
  const policy = await prisma.appVersionPolicy
    .findUnique({ where: { platform_app: { platform, app } } })
    .catch(() => null);

  const fallback = envFallback(app);
  const minSupported = policy?.minSupported ?? fallback.min;
  const latest = policy?.latest ?? fallback.latest;
  const maintenance = policy?.maintenance ?? env.MOBILE_MAINTENANCE;
  const message = policy?.message ?? null;

  return {
    app,
    platform,
    minSupported,
    latest,
    maintenance,
    message,
    forceUpdate: isForceUpdate(clientVersion, minSupported),
    updateAvailable: isUpdateAvailable(clientVersion, latest),
  };
}
