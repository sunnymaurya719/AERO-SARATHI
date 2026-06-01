import { env } from '../../../env.js';
import { logger } from '../../../logger.js';
import type { RenderedEmail } from '../templates.js';

function parseFrom(from: string): { email: string; name?: string } {
  const m = from.match(/^(.*)<(.+)>$/);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    return { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() };
  }
  return { email: from.trim() };
}

/**
 * Send a transactional email via SendGrid's v3 Mail Send API. In NOTIFY_BYPASS
 * mode (dev) or without an API key the email is logged, never sent. Throws on
 * gateway failure so the worker retries.
 */
export async function sendEmail(to: string, msg: RenderedEmail): Promise<void> {
  if (env.NOTIFY_BYPASS || !env.SENDGRID_API_KEY) {
    logger.info({ to, subject: msg.subject }, 'email_bypass: not sent');
    return;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: parseFrom(env.EMAIL_FROM),
      subject: msg.subject,
      content: [{ type: 'text/html', value: msg.html }],
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    logger.error({ status: res.status }, 'sendgrid_email_failed');
    throw new Error(`sendgrid_email_failed_${res.status}`);
  }
}
