import { XMLParser } from 'fast-xml-parser';
import type { FeedVideo } from './types';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: (name) => name === 'entry' || name === 'link' });

type Node = Record<string, unknown>;
const obj = (x: unknown): Node | undefined => (x && typeof x === 'object' ? (x as Node) : undefined);
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : undefined);

/** Parse a channel's public RSS feed (https://www.youtube.com/feeds/videos.xml?channel_id=…). Never throws. */
export function parseChannelFeed(xml: string): ParseResult<FeedVideo[]> {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (e) {
    return { ok: false, reason: `not a YouTube feed (${e instanceof Error ? e.message : 'parse error'})` };
  }
  const feed = obj(doc?.feed);
  if (!feed) return { ok: false, reason: 'not a YouTube feed (no <feed> element)' };

  const entries = (feed.entry as unknown[] | undefined) ?? [];
  const out: FeedVideo[] = [];
  for (const raw of entries) {
    const e = obj(raw);
    const videoId = str(e?.['yt:videoId']);
    const publishedAt = str(e?.published);
    if (!e || !videoId || !publishedAt) return { ok: false, reason: 'feed entry missing videoId or published date' };
    const links = (e.link as unknown[] | undefined) ?? [];
    const href = links.map((l) => str(obj(l)?.['@href'])).find((h) => h?.includes('youtube.com/')) ?? '';
    const stats = obj(obj(obj(e['media:group'])?.['media:community'])?.['media:statistics']);
    const viewsText = str(stats?.['@views']);
    out.push({
      platform: 'youtube',
      videoId,
      title: str(e.title) ?? '',
      publishedAt,
      views: viewsText !== undefined && /^\d+$/.test(viewsText) ? Number(viewsText) : null,
      format: href.includes('/shorts/') ? 'short' : href.includes('/watch') ? 'long' : 'unknown',
    });
  }
  return { ok: true, value: out };
}

/** The channel a feed belongs to: id (UC…) and title. Null when the text isn't a YouTube channel feed. */
export function parseFeedChannel(xml: string): { channelId: string; title: string } | null {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    return null;
  }
  const feed = obj(doc?.feed);
  if (!feed) return null;
  const raw = str(feed['yt:channelId']);
  const channelId = raw ? (raw.startsWith('UC') ? raw : `UC${raw}`) : undefined;
  const title = str(feed.title) ?? str(obj(feed.author)?.name);
  return channelId && /^UC[\w-]{22}$/.test(channelId) && title ? { channelId, title } : null;
}
