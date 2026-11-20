import { type FeedVideo, type ParseResult, parseChannelFeed } from '@open-iq/core';

export const BASELINE_TTL_MS = 3_600_000;

export type BaselineCache = Map<string, { at: number; result: ParseResult<FeedVideo[]> }>;

/**
 * The channel's latest uploads from its public RSS feed (spec D1). Quota-free,
 * fetched without cookies. Successful results are cached for an hour; failures are not.
 */
export async function getBaseline(
  channelId: string,
  deps: { fetch: typeof fetch; now: () => number; cache: BaselineCache },
): Promise<ParseResult<FeedVideo[]>> {
  const hit = deps.cache.get(channelId);
  if (hit && deps.now() - hit.at < BASELINE_TTL_MS) return hit.result;

  let result: ParseResult<FeedVideo[]>;
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    const res = await deps.fetch(url, { credentials: 'omit' });
    result = res.ok ? parseChannelFeed(await res.text()) : { ok: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    result = { ok: false, reason: e instanceof Error ? e.message : 'network error' };
  }
  if (result.ok) deps.cache.set(channelId, { at: deps.now(), result });
  return result;
}
