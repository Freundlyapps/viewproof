import type { GoogleError } from './google';

/** One YouTube Analytics `reports.query` call (channel==MINE). */
export interface ReportQuery {
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  filters?: string;
  sort?: string;
  maxResults?: number;
}

export interface Report {
  columns: string[];
  rows: (string | number)[][];
}

export interface Upload {
  videoId: string;
  title: string;
  publishedAt: string;
  durationSec: number | null;
  views: number | null;
  thumbnailUrl: string | null;
}

/** One video's editable fields (Optimize). `tags` is [] when YouTube omits it, which it does when there are none. */
export interface VideoDetails { videoId: string; channelId: string; title: string; description: string; tags: string[]; publishedAt: string; durationSec: number | null }

export interface YouTubeClient {
  report(accessToken: string, q: ReportQuery): Promise<Report | GoogleError>;
  /** The channel's newest uploads, newest first, at most `max`. */
  uploads(accessToken: string, max: number): Promise<Upload[] | GoogleError>;
  /** One video (1 quota unit); null when YouTube returns no item. */
  video(accessToken: string, videoId: string): Promise<VideoDetails | null | GoogleError>;
}

const REPORTS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA_URL = 'https://www.googleapis.com/youtube/v3';
const QUOTA = 'YouTube quota used up for today';

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | undefined => (x && typeof x === 'object' ? (x as Json) : undefined);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);
const errText = (e: unknown) => (e instanceof Error ? e.message : 'network error');

/** ISO-8601 duration (PT#H#M#S, optional days) → seconds; anything else → null. */
export function durationSeconds(iso: string | undefined): number | null {
  const m = iso ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso) : null;
  if (!m || iso === 'P' || iso === 'PT') return null;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d! * 86400 + h! * 3600 + mi! * 60 + s!;
}

async function call(fetchFn: typeof fetch, url: string, token: string): Promise<Json | GoogleError> {
  try {
    const res = await fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
    const body = obj(await res.json().catch(() => undefined));
    if (res.status === 401) return { kind: 'revoked' };
    const err = obj(body?.error);
    const reasons = ((err?.errors as unknown[] | undefined) ?? []).map((e) => str(obj(e)?.reason));
    if (res.status === 429 || reasons.includes('quotaExceeded') || reasons.includes('dailyLimitExceeded')) return { kind: 'failed', reason: QUOTA };
    if (res.status === 403) return { kind: 'forbidden', reason: str(err?.message) ?? 'Forbidden' };
    if (!res.ok || !body) return { kind: 'failed', reason: `HTTP ${res.status}` };
    return body;
  } catch (e) {
    return { kind: 'failed', reason: errText(e) };
  }
}
// Google's own bodies carry `kind` too ("youtube#channelListResponse"), so only our error kinds count.
const ERROR_KINDS: readonly string[] = ['revoked', 'failed', 'forbidden'];
const isError = (x: unknown): x is GoogleError => ERROR_KINDS.includes(String(obj(x)?.kind));

export function httpYouTubeClient(fetchFn: typeof fetch): YouTubeClient {
  return {
    async report(token, q) {
      const p = new URLSearchParams({ ids: 'channel==MINE', startDate: q.startDate, endDate: q.endDate, metrics: q.metrics.join(',') });
      if (q.dimensions?.length) p.set('dimensions', q.dimensions.join(','));
      if (q.filters) p.set('filters', q.filters);
      if (q.sort) p.set('sort', q.sort);
      if (q.maxResults !== undefined) p.set('maxResults', String(q.maxResults));
      const body = await call(fetchFn, `${REPORTS_URL}?${p}`, token);
      if (isError(body)) return body;
      const columns = ((body.columnHeaders as unknown[] | undefined) ?? []).map((h) => str(obj(h)?.name) ?? '');
      const rows = ((body.rows as unknown[] | undefined) ?? []).filter(Array.isArray) as (string | number)[][];
      return { columns, rows };
    },

    async uploads(token, max) {
      const ch = await call(fetchFn, `${DATA_URL}/channels?part=contentDetails&mine=true`, token);
      if (isError(ch)) return ch;
      const playlist = str(obj(obj(obj((ch.items as unknown[] | undefined)?.[0])?.contentDetails)?.relatedPlaylists)?.uploads);
      if (!playlist) return [];

      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const p = new URLSearchParams({ part: 'contentDetails', playlistId: playlist, maxResults: '50' });
        if (pageToken) p.set('pageToken', pageToken);
        const page = await call(fetchFn, `${DATA_URL}/playlistItems?${p}`, token);
        if (isError(page)) return page;
        for (const it of (page.items as unknown[] | undefined) ?? []) {
          const id = str(obj(obj(it)?.contentDetails)?.videoId);
          if (id && ids.length < max) ids.push(id);
        }
        pageToken = str(page.nextPageToken);
      } while (pageToken && ids.length < max);

      const out: Upload[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const p = new URLSearchParams({ part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') });
        const page = await call(fetchFn, `${DATA_URL}/videos?${p}`, token);
        if (isError(page)) return page;
        for (const raw of (page.items as unknown[] | undefined) ?? []) {
          const it = obj(raw);
          const id = str(it?.id);
          if (!it || !id) continue;
          const sn = obj(it.snippet);
          const thumbs = obj(sn?.thumbnails);
          const views = str(obj(it.statistics)?.viewCount);
          out.push({
            videoId: id,
            title: str(sn?.title) ?? '',
            publishedAt: str(sn?.publishedAt) ?? '',
            durationSec: durationSeconds(str(obj(it.contentDetails)?.duration)),
            views: views && /^\d+$/.test(views) ? Number(views) : null,
            thumbnailUrl: str(obj(thumbs?.medium)?.url) ?? str(obj(thumbs?.default)?.url) ?? null,
          });
        }
      }
      return out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    },
    async video(token, videoId) {
      const p = new URLSearchParams({ part: 'snippet,contentDetails', id: videoId });
      const page = await call(fetchFn, `${DATA_URL}/videos?${p}`, token);
      if (isError(page)) return page;
      const it = obj(((page.items as unknown[] | undefined) ?? [])[0]);
      const sn = obj(it?.snippet);
      if (!it || !sn || str(it.id) !== videoId) return null;
      const tags = Array.isArray(sn.tags) ? sn.tags.filter((t): t is string => typeof t === 'string') : [];
      return {
        videoId, channelId: str(sn.channelId) ?? '', title: str(sn.title) ?? '', description: str(sn.description) ?? '', tags,
        publishedAt: str(sn.publishedAt) ?? '', durationSec: durationSeconds(str(obj(it.contentDetails)?.duration)),
      };
    },
  };
}
