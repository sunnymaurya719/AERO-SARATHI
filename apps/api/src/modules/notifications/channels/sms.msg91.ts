import { env } from '../../../env.js';
import { logger } from '../../../logger.js';
import type { RenderedSms } from '../templates.js';

/**
 * Send a transactional SMS via MSG91's flow API. In NOTIFY_BYPASS mode (dev)
 * the message is logged, never sent. Throws on gateway failure so the worker
 * retries.
 */
export async function sendSms(phone: string, msg: RenderedSms): Promise<void> {
  if (env.NOTIFY_BYPASS || !env.MSG91_AUTH_KEY) {
    logger.info({ to: phone, template: msg.templateId || 'inline' }, 'sms_bypass: not sent');
    return;
  }

  const mobile = phone.replace(/^\+/, '');
  const res = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template_id: msg.templateId,
      sender: env.MSG91_SENDER_ID,
      short_url: '0',
      recipients: [{ mobiles: mobile, message: msg.text }],
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    logger.error({ status: res.status }, 'msg91_sms_failed');
    throw new Error(`msg91_sms_failed_${res.status}`);
  }
}
