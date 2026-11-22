import type { Deps } from '../app';
import { pollStale, pruneCompetitors } from './poll';
import { saveStats } from './routes';

/** Cron (hourly): poll up to 60 stale feeds; at 03:xx UTC refresh Data API counts (needs a key); prune. */
export async function runCron(deps: Deps, at: Date): Promise<void> {
  await pollStale(deps, 60);
  if (at.getUTCHours() === 3 && deps.config.youtubeApiKey) {
    const ids = (await deps.db.prepare('SELECT channel_id FROM tracked_channels').all<{ channel_id: string }>()).results.map((r) => r.channel_id);
    if (ids.length) await saveStats(deps, ids, { key: deps.config.youtubeApiKey });
  }
  await pruneCompetitors(deps);
}
