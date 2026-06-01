import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Exotel click-to-call / number-masking bridge. When unconfigured (local/dev),
 * connect requests are logged and return a synthetic SID so the rest of the
 * flow (logging, rate-limit, UI) can be exercised without a live account.
 */

export function isExotelConfigured(): boolean {
  return Boolean(env.EXOTEL_SID && env.EXOTEL_API_KEY && env.EXOTEL_API_TOKEN && env.EXOTEL_CALLER_ID);
}

export interface ExotelConnectResult {
  sid: string | null;
  status: 'initiated' | 'failed';
}

/**
 * Bridge two numbers via the Exotel virtual number (`EXOTEL_CALLER_ID`). The
 * `from` party's phone rings first; on answer Exotel dials `to`. Neither party
 * sees the other's real number — both see the ExoPhone.
 */
export async function connectMaskedCall(from: string, to: string): Promise<ExotelConnectResult> {
  if (!isExotelConfigured()) {
    logger.info({ }, 'exotel_bypass: masked call not placed');
    return { sid: `dev-${Date.now()}`, status: 'initiated' };
  }

  const url = `https://${env.EXOTEL_API_KEY}:${env.EXOTEL_API_TOKEN}@${env.EXOTEL_SUBDOMAIN}/v1/Accounts/${env.EXOTEL_SID}/Calls/connect.json`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: from,
        To: to,
        CallerId: env.EXOTEL_CALLER_ID,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'exotel_connect_failed');
      return { sid: null, status: 'failed' };
    }
    const json = (await res.json()) as { Call?: { Sid?: string } };
    return { sid: json.Call?.Sid ?? null, status: 'initiated' };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'exotel_connect_error');
    return { sid: null, status: 'failed' };
  }
}
