import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Slack ops alerts. Graceful degradation: when no bot token is configured the
 * message is logged and skipped. Email is always sent in parallel by the
 * caller, so Slack outages never blind ops.
 */

export function isSlackConfigured(): boolean {
  return Boolean(env.SLACK_BOT_TOKEN);
}

export async function postToSlack(text: string, channel: string = env.SLACK_OPS_CHANNEL): Promise<boolean> {
  if (!isSlackConfigured()) {
    logger.info({ channel, text }, 'slack_bypass: alert not posted');
    return false;
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text }),
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      logger.warn({ error: json.error }, 'slack_post_failed');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'slack_post_error');
    return false;
  }
}
