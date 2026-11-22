import { parseAge } from './keywords';
import { type Measured, median, noData, value } from './measured';
import { MAX_BASELINE, MIN_BASELINE, NEGATIVE_OUTLIER, roundRatio } from './outlier';

/** A count as YouTube shows it on channel pages: shortened ("3.1M") unless small. */
export interface RoundedCount {
  lo: number;
  hi: number;
  mid: number;
  /** True when the full number was shown. */
  exact: boolean;
}

export interface GridVideo {
  videoId: string;
  title: string;
  views: RoundedCount | null;
  /** The count as shown, e.g. "3.1M". */
  viewsText: string;
  ageLabel: string | null;
  ageDays: number | null;
  durationSec: number | null;
}

export interface ChannelPage {
  channelId: string;
  title: string;
  tab: 'videos' | 'shorts';
  sort: 'latest' | 'popular' | 'oldest' | null;
  subscribersText: string | null;
  /** In page order (newest first under Latest). */
  videos: GridVideo[];
}

const UNIT: Record<string, number> = {
  k: 1e3, thousand: 1e3, 'tsd.': 1e3, tsd: 1e3,
  m: 1e6, million: 1e6, 'mio.': 1e6, mio: 1e6, millionen: 1e6,
  b: 1e9, billion: 1e9, 'mrd.': 1e9, mrd: 1e9, milliarden: 1e9,
};
const COUNT = /^(\d+(?:[.,]\d+)?|\d{1,3}(?:[.,\s  ]\d{3})+)\s*(k|thousand|tsd\.?|m|million|mio\.?|millionen|b|billion|mrd\.?|milliarden)?(?:\s*(?:views?|aufrufe?))?$/i;

/**
 * Parse a view count as YouTube writes it on channel pages. Shortened counts give a range wide enough for
 * either rounding or truncation (YouTube does not document which): "3.1M" → 3,050,000–3,199,999.
 * Anything not understood is null, never 0.
 */
export function parseRoundedCount(text: string): RoundedCount | null {
  const s = text.trim().replace(/\s+/g, ' ');
  if (/^(no views|keine aufrufe)$/i.test(s)) return { lo: 0, hi: 0, mid: 0, exact: true };
  const m = COUNT.exec(s);
  if (!m) return null;
  const [, n, unitRaw] = m;
  if (!unitRaw) {
    // A full number: separators are thousands groups ("1,234,567" / "290.000").
    if (/[.,]\d{1,2}$/.test(n!)) return null;
    const v = Number(n!.replace(/\D/g, ''));
    return { lo: v, hi: v, mid: v, exact: true };
  }
  if (/[.,\s  ]\d{3}[.,\s  ]/.test(n!)) return null;
  const unit = UNIT[unitRaw.toLowerCase()]!;
  const [int, dec = ''] = n!.split(/[.,]/);
  // YouTube drops a ".0": "2M" means 2.0–2.09M, never 1.5M (that would read "1.5M"). Two digits ("21M") carry no decimal.
  const step = unit / 10 ** (dec.length || (int!.length === 1 ? 1 : 0));
  const mid = Math.round(Number(`${int}.${dec || '0'}`) * unit);
  return { lo: mid - step / 2, hi: mid + step - 1, mid, exact: false };
}

type Obj = Record<string, any>;
const CANARY = 'YouTube changed its channel page; no videos could be read';

function duration(s: unknown): number | null {
  if (typeof s !== 'string' || !/^\d+(:\d{1,2}){1,2}$/.test(s)) return null;
  return s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}

function fromLockup(lv: Obj): GridVideo | null {
  if (typeof lv.contentId !== 'string' || (lv.contentType && lv.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO')) return null;
  const meta = lv.metadata?.lockupMetadataViewModel;
  const parts: Obj[] = (meta?.metadata?.contentMetadataViewModel?.metadataRows ?? []).flatMap((r: Obj) => r.metadataParts ?? []);
  let views: RoundedCount | null = null;
  let viewsText = '';
  let ageLabel: string | null = null;
  for (const p of parts) {
    const text = typeof p.text?.content === 'string' ? p.text.content : '';
    const label = typeof p.accessibilityLabel === 'string' ? p.accessibilityLabel : '';
    if (!views && /\b(views?|aufrufe?)\b/i.test(label)) {
      views = parseRoundedCount(label) ?? parseRoundedCount(text);
      viewsText = text;
    } else if (!ageLabel && parseAge(text) !== null) ageLabel = text;
  }
  const badges: Obj[] = (lv.contentImage?.thumbnailViewModel?.overlays ?? []).flatMap((o: Obj) => o.thumbnailBottomOverlayViewModel?.badges ?? []);
  const durationSec = badges.map((b) => duration(b.thumbnailBadgeViewModel?.text)).find((d) => d !== null) ?? null;
  return {
    videoId: lv.contentId,
    title: typeof meta?.title?.content === 'string' ? meta.title.content : '',
    views, viewsText, ageLabel, ageDays: ageLabel ? parseAge(ageLabel) : null, durationSec,
  };
}

function fromShortsLockup(sl: Obj): GridVideo | null {
  const id = sl.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
    ?? (typeof sl.entityId === 'string' ? /^shorts-shelf-item-([\w-]{11})$/.exec(sl.entityId)?.[1] : undefined);
  if (typeof id !== 'string') return null;
  const viewsText = typeof sl.overlayMetadata?.secondaryText?.content === 'string' ? sl.overlayMetadata.secondaryText.content : '';
  return {
    videoId: id,
    title: typeof sl.overlayMetadata?.primaryText?.content === 'string' ? sl.overlayMetadata.primaryText.content : '',
    views: viewsText ? parseRoundedCount(viewsText) : null, viewsText, ageLabel: null, ageDays: null, durationSec: null,
  };
}

function findAll(o: unknown, key: string, out: Obj[] = []): Obj[] {
  if (Array.isArray(o)) for (const x of o) findAll(x, key, out);
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Obj)) {
      if (k === key && v && typeof v === 'object') out.push(v as Obj);
      findAll(v, key, out);
    }
  }
  return out;
}

const SORTS: Record<string, ChannelPage['sort']> = { latest: 'latest', popular: 'popular', oldest: 'oldest', neueste: 'latest', beliebt: 'popular', 'älteste': 'oldest' };

/** Read a channel's Videos or Shorts tab from ytInitialData (or an in-app navigation response of the same shape). */
export function parseChannelPage(data: unknown): ChannelPage | { error: string } {
  const d = data as Obj | null;
  const channelId = d?.metadata?.channelMetadataRenderer?.externalId;
  const tabs = d?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  if (typeof channelId !== 'string' || !Array.isArray(tabs)) return { error: 'Not a channel page' };
  const grid = tabs.map((t: Obj) => t.tabRenderer).find((t: Obj | undefined) => t?.selected)?.content?.richGridRenderer;
  if (!grid || !Array.isArray(grid.contents)) return { error: 'Not a channel Videos or Shorts tab' };

  const videos: GridVideo[] = [];
  let items = 0;
  let shorts = 0;
  for (const it of grid.contents as Obj[]) {
    const c = it.richItemRenderer?.content;
    if (!c) continue;
    items++;
    if (c.shortsLockupViewModel) shorts++;
    const v = c.lockupViewModel ? fromLockup(c.lockupViewModel) : c.shortsLockupViewModel ? fromShortsLockup(c.shortsLockupViewModel) : null;
    if (v) videos.push(v);
  }
  if (items > 0 && videos.length === 0) return { error: CANARY };

  const chip = findAll(grid.header, 'chipViewModel').find((c) => c.selected === true);
  const sort = typeof chip?.text === 'string' ? SORTS[chip.text.trim().toLowerCase()] ?? null : null;
  const headerParts = findAll(d?.header, 'metadataParts').flatMap((p) => (Array.isArray(p) ? p : []));
  const subs = headerParts.map((p: Obj) => p.text?.content).find((t: unknown) => typeof t === 'string' && /subscri|abonnent/i.test(t)) ?? null;
  return {
    channelId,
    title: String(d?.metadata?.channelMetadataRenderer?.title ?? ''),
    tab: shorts > 0 && shorts === items ? 'shorts' : 'videos',
    sort,
    subscribersText: subs,
    videos,
  };
}

const SORT_NAMES: Record<string, string> = { popular: 'Popular', oldest: 'Oldest' };

/**
 * ×N for each video on the page: shown count ÷ median of the next ≤ 15 older videos with counts on the same tab
 * (spec §7 thresholds). Counts are rounded, so each value carries the range the rounding allows.
 */
export function gridOutliers(page: ChannelPage): Map<string, Measured<number>> {
  const out = new Map<string, Measured<number>>();
  page.videos.forEach((v, i) => {
    if (page.sort !== 'latest') {
      out.set(v.videoId, noData(page.sort ? `Sorted by ${SORT_NAMES[page.sort]}: ×N needs the Latest order` : "Couldn't tell how the videos are sorted"));
      return;
    }
    if (!v.views) { out.set(v.videoId, noData(v.viewsText ? `View count not understood: ${v.viewsText}` : 'View count not shown')); return; }
    const older = page.videos.slice(i + 1).filter((o) => o.views).slice(0, MAX_BASELINE).map((o) => o.views!);
    if (older.length < MIN_BASELINE) {
      out.set(v.videoId, noData(`Needs ${MIN_BASELINE} earlier videos on this page; found ${older.length}`));
      return;
    }
    const med = median(older.map((o) => o.mid))!;
    const medLo = median(older.map((o) => o.lo))!;
    const medHi = median(older.map((o) => o.hi))!;
    if (med <= 0 || medLo <= 0) { out.set(v.videoId, noData('Earlier videos have no views yet')); return; }
    const score = roundRatio(v.views.mid / med);
    out.set(v.videoId, value(score, "shown views ÷ median shown views of the channel's earlier videos on this page", {
      viewsText: v.viewsText,
      baselineMedian: med,
      baselineCount: older.length,
      low: roundRatio(v.views.lo / medHi),
      high: roundRatio(v.views.hi / medLo),
      rounded: true,
      negative: score <= NEGATIVE_OUTLIER,
    }));
  });
  return out;
}

/** Median shown views of the latest 15 videos with counts. */
export function gridSummary(page: ChannelPage): { medianViews: Measured<number>; counted: number } {
  const counts = page.videos.filter((v) => v.views).slice(0, MAX_BASELINE).map((v) => v.views!.mid);
  const m = median(counts);
  return {
    counted: counts.length,
    medianViews: m === null ? noData('No view counts on this page') : value(m, 'median shown views of the latest videos on this page', { n: counts.length, rounded: true }),
  };
}
