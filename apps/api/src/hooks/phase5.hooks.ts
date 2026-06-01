import { logger } from '../logger.js';
import { ensureTrackLink } from '../modules/trips/trips.service.js';
import { revokeTrackTokens } from '../modules/tracking/track-token.js';

/**
 * Phase 5 booking transition hooks (best-effort, post-commit).
 *
 * On DRIVER_ASSIGNED we mint the shareable HMAC track link so the passenger
 * can follow the trip without logging in. On terminal states we revoke any
 * outstanding track tokens so the link stops working.
 */

export async function onDriverAssigned(bookingId: string): Promise<void> {
  try {
    await ensureTrackLink(bookingId);
  } catch (err) {
    logger.warn({ err: (err as Error).message, bookingId }, 'phase5_on_driver_assigned_failed');
  }
}

export async function onTripTerminal(bookingId: string): Promise<void> {
  try {
    await revokeTrackTokens(bookingId);
  } catch (err) {
    logger.warn({ err: (err as Error).message, bookingId }, 'phase5_revoke_tokens_failed');
  }
}
