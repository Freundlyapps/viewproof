import type { Deps } from '../app';

/** Write one UTC day of accepted pool observations to R2 as gzipped NDJSON (Q1: kept 36 months by a lifecycle rule). */
export async function archiveDay(deps: Deps, day: string): Promise<'written' | 'exists' | 'skipped'> {
  if (!deps.pool) {
    console.log('pool archive skipped: no R2 binding POOL');
    return 'skipped';
  }
  const key = `pool/${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}.ndjson.gz`;
  if (await deps.pool.head(key)) return 'exists';
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();
  const rows = (await deps.db.prepare(
    `SELECT o.video_id, v.channel_id, o.at, o.views, o.source FROM pool_observations o JOIN pool_videos v USING (video_id)
     WHERE o.at >= ? AND o.at < ? ORDER BY o.at, o.video_id`,
  ).bind(`${day}T00:00:00.000Z`, next).all<{ video_id: string; channel_id: string; at: string; views: number; source: string }>()).results;
  const ndjson = rows.map((r) => JSON.stringify({ videoId: r.video_id, channelId: r.channel_id, at: r.at, views: r.views, source: r.source })).join('\n') + (rows.length ? '\n' : '');
  const gz = await new Response(new Blob([ndjson]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  await deps.pool.put(key, gz, { httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' } });
  return 'written';
}
