import type { ParseResult } from './feed';
import type { Format } from './types';

export interface WatchVideo {
  platform: 'youtube';
  videoId: string;
  channelId: string;
  title: string;
  views: number;
  lengthSeconds: number;
  publishedAt: string;
  tags: string[];
  isLive: boolean;
  isUpcoming: boolean;
  format: Format;
}

function formatFromUrl(url: string | undefined): Format {
  if (!url) return 'unknown';
  return url.includes('/shorts/') ? 'short' : 'long';
}

type Node = Record<string, unknown>;
const obj = (x: unknown): Node | undefined => (x && typeof x === 'object' ? (x as Node) : undefined);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);

/**
 * Read the page's own player data (ytInitialPlayerResponse / movie_player.getPlayerResponse()).
 * Returns a failure naming the missing field instead of throwing or defaulting.
 */
export function parsePlayerResponse(raw: unknown): ParseResult<WatchVideo> {
  try {
    const root = obj(raw);
    const vd = obj(root?.videoDetails);
    if (!vd) return { ok: false, reason: 'player data has no videoDetails' };
    const videoId = str(vd.videoId);
    if (!videoId) return { ok: false, reason: 'videoDetails.videoId missing' };
    const viewCount = str(vd.viewCount);
    if (!viewCount || !/^\d+$/.test(viewCount)) return { ok: false, reason: 'videoDetails.viewCount missing' };
    const mf = obj(obj(root?.microformat)?.playerMicroformatRenderer);
    const publishedAt = str(mf?.publishDate) ?? str(mf?.uploadDate);
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
      return { ok: false, reason: 'microformat publishDate missing' };
    }
    const channelId = str(vd.channelId) ?? str(mf?.externalChannelId);
    if (!channelId) return { ok: false, reason: 'videoDetails.channelId missing' };
    const live = obj(mf?.liveBroadcastDetails);
    const isLive = vd.isLive === true || live?.isLiveNow === true;
    const isUpcoming = vd.isUpcoming === true || (!!live && live.isLiveNow !== true && !str(live.endTimestamp));
    const tags = Array.isArray(vd.keywords) ? vd.keywords.filter((k): k is string => typeof k === 'string') : [];
    return {
      ok: true,
      value: {
        platform: 'youtube',
        videoId,
        channelId,
        title: str(vd.title) ?? '',
        views: Number(viewCount),
        lengthSeconds: Number(str(vd.lengthSeconds) ?? 0),
        publishedAt,
        tags,
        isLive,
        isUpcoming,
        format: formatFromUrl(str(mf?.canonicalUrl)),
      },
    };
  } catch (e) {
    return { ok: false, reason: `could not read player data (${e instanceof Error ? e.message : 'error'})` };
  }
}
