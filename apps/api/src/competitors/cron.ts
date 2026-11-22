import type { Deps } from '../app';
import { archiveDay } from '../pool/archive';
import { pollStale, pruneCompetitors } from './poll';
import { saveStats } from './routes';

/** Feed fetches per run stay ≤ 45 (Workers Free allows 50 subrequests per invocation). */
export const TRACKED_BUDGET = 30;
export const POOL_BUDGET = 15;

/** Cron (hourly): user-tracked feeds, then pool feeds; 03 UTC Data API counts; 04 UTC archive yesterday's pool; prune. */
export async function runCron(deps: Deps, at: Date): Promise<void> {
  await pollStale(deps, TRACKED_BUDGET, undefined, 'tracked');
  await pollStale(deps, POOL_BUDGET, undefined, 'pool');
  if (at.getUTCHours() === 3 && deps.config.youtubeApiKey) {
    const ids = (await deps.db.prepare('SELECT channel_id FROM user_competitors GROUP BY channel_id').all<{ channel_id: string }>()).results.map((r) => r.channel_id);
    if (ids.length) await saveStats(deps, ids, { key: deps.config.youtubeApiKey });
  }
  if (at.getUTCHours() === 4) await archiveDay(deps, new Date(at.getTime() - 86_400_000).toISOString().slice(0, 10));
  await pruneCompetitors(deps);
}
