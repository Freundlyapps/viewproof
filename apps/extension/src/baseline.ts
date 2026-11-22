import { type FeedVideo, type ParseResult, parseChannelFeed } from '@viewproof/core';

export const BASELINE_TTL_MS = 3_600_000;
/** HTTP failures are remembered briefly so every click doesn't refetch. */
export const FAILURE_TTL_MS = 600_000;
/** 403/429 mean "slow down": back off for an hour. */
export const BACKOFF_TTL_MS = 3_600_000;
export const FEED_TIMEOUT_MS = 8_000;
/** Cache entry that pauses all feed requests after a 403/429. */
const THROTTLE_KEY = '*throttled*';

export type BaselineCache = Map<string, { at: number; ttl: number; result: ParseResult<FeedVideo[]> }>;

/**
 * The channel's latest uploads from its public RSS feed (spec D1). Quota-free,
 * fetched without cookies. Successful results are cached for an hour; failures are not.
 */
export async function getBaseline(
  channelId: string,
  deps: { fetch: typeof fetch; now: () => number; cache: BaselineCache; timeoutMs?: number },
): Promise<ParseResult<FeedVideo[]>> {
  // After any 403/429, YouTube is rate-limiting this browser: no feed requests for any channel until the back-off ends.
  const paused = deps.cache.get(THROTTLE_KEY);
  if (paused && deps.now() - paused.at < paused.ttl) return paused.result;
  const hit = deps.cache.get(channelId);
  if (hit && deps.now() - hit.at < hit.ttl) return hit.result;

  let result: ParseResult<FeedVideo[]>;
  let ttl = 0;
  try {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    // No cookies; never follow a redirect off the feed (consent or "sorry" pages live on other hosts).
    const res = await deps.fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(deps.timeoutMs ?? FEED_TIMEOUT_MS),
    });
    if (res.ok) {
      result = parseChannelFeed(await res.text());
      ttl = result.ok ? BASELINE_TTL_MS : FAILURE_TTL_MS;
    } else {
      result = { ok: false, reason: `HTTP ${res.status}` };
      ttl = res.status === 429 || res.status === 403 ? BACKOFF_TTL_MS : FAILURE_TTL_MS;
      if (ttl === BACKOFF_TTL_MS) deps.cache.set(THROTTLE_KEY, { at: deps.now(), ttl, result: { ok: false, reason: `Paused: YouTube asked to slow down (HTTP ${res.status})` } });
    }
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
    result = { ok: false, reason: timedOut ? 'Timed out loading the channel feed' : e instanceof Error ? e.message : 'network error' };
  }
  if (ttl > 0) deps.cache.set(channelId, { at: deps.now(), ttl, result });
  return result;
}
