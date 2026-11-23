import type { Deps } from '../app';
import { archiveDay } from '../pool/archive';
import { pollStale, pruneCompetitors } from './poll';
import { saveStats } from './routes';

/**
 * Cron (hourly). Archive and prune first, so they run even if polling hits a platform limit.
 * Feed budget B (CRON_FEED_BUDGET, default 10): user-tracked channels first (up to ⌈2B/3⌉), then pool channels
 * with what is left, at most ⌈B/3⌉. 03 UTC: Data API counts for tracked channels (needs a key).
 */
export async function runCron(deps: Deps, at: Date): Promise<void> {
  // Processed Stripe event ids are only needed while Stripe may still retry (3 days); keep 30.
  await deps.db.prepare('DELETE FROM stripe_events WHERE received_at < ?').bind(new Date(at.getTime() - 30 * 86_400_000).toISOString()).run();
  if (at.getUTCHours() === 4) await archiveDay(deps, new Date(at.getTime() - 86_400_000).toISOString().slice(0, 10));
  await pruneCompetitors(deps);
  const budget = deps.config.cronFeedBudget;
  const tracked = await pollStale(deps, Math.ceil((2 * budget) / 3), undefined, 'tracked');
  await pollStale(deps, Math.min(budget - tracked, Math.ceil(budget / 3)), undefined, 'pool');
  if (at.getUTCHours() === 3 && deps.config.youtubeApiKey) {
    const ids = (await deps.db.prepare('SELECT channel_id FROM user_competitors GROUP BY channel_id').all<{ channel_id: string }>()).results.map((r) => r.channel_id);
    if (ids.length) await saveStats(deps, ids, { key: deps.config.youtubeApiKey });
  }
}
