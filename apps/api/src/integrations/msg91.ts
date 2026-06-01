import { env } from '../env.js';
import { logger } from '../logger.js';
import { Errors } from '../errors.js';

/**
 * Send an OTP via MSG91. In bypass mode (dev/test) this is a no-op so the
 * verify step accepts the fixed dev code. The code is NEVER logged.
 */
export async function sendOtp(phone: string, code: string): Promise<void> {
  if (env.MSG91_BYPASS) {
    logger.info('msg91_bypass_enabled: otp not actually sent');
    return;
  }

  const mobile = phone.replace(/^\+/, '');
  const url = `https://control.msg91.com/api/v5/otp?template_id=${env.MSG91_OTP_TEMPLATE_ID}&mobile=${mobile}&otp=${code}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    logger.error({ status: res.status }, 'msg91_send_failed');
    throw Errors.badGateway('otp_send_failed');
  }
}
