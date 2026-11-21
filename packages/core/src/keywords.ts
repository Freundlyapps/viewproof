import { type Measured, median, noData, value } from './measured';

/** Same keyword whatever its case, spacing or Unicode form. */
export function normalizeKeyword(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

export interface SearchResult {
  videoId: string;
  title: string;
  channelId: string | null;
  channelName: string;
  views: Measured<number>;
  ageDays: Measured<number>;
  /** YouTube's own rounded label, e.g. "4y ago". */
  ageLabel: string | null;
  durationSec: number | null;
  live: boolean;
}

export interface SearchPage {
  query: string;
  results: SearchResult[];
  /** Shorts shelves YouTube mixed into the page (their videos are not counted as results). */
  shortsShelves: number;
  /** YouTube's own "about N results" estimate. */
  estimatedResults: number | null;
}

const PAGE_SOURCE = "YouTube's search page";
const CANARY = 'YouTube changed its search page; no results could be read';
const MAX_RESULTS = 20;

type Obj = Record<string, any>;
const text = (t: Obj | undefined): string | null => {
  if (!t) return null;
  if (typeof t.simpleText === 'string') return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r: Obj) => r.text ?? '').join('');
  return null;
};

const UNITS: [RegExp, number][] = [
  [/^(\d+)\s*(y|yr|yrs|years?|jahr|jahre|jahren)$/, 365],
  [/^(\d+)\s*(mo|mos|months?|monat|monate|monaten)$/, 30],
  [/^(\d+)\s*(w|wk|wks|weeks?|woche|wochen)$/, 7],
  [/^(\d+)\s*(d|days?|tag|tage|tagen)$/, 1],
  [/^(\d+)\s*(h|hr|hrs|hours?|stunde|stunden)$/, 1 / 24],
  [/^(\d+)\s*(m|min|mins|minutes?|minute|minuten)$/, 1 / 1440],
  [/^(\d+)\s*(s|sec|secs|seconds?|sekunde|sekunden)$/, 1 / 86400],
];

/** Days since upload from YouTube's relative label (English short/long, German). Null if not understood. */
export function parseAge(label: string): number | null {
  let s = label.trim().toLowerCase().replace(/^(streamed|premiered|live gestreamt|premiere)\s+/, '');
  const en = /^(.+?)\s+ago$/.exec(s);
  const de = /^vor\s+(.+)$/.exec(s);
  if (en) s = en[1]!;
  else if (de) s = de[1]!;
  else return null;
  for (const [re, days] of UNITS) {
    const m = re.exec(s.trim());
    if (m) return Math.floor(Number(m[1]) * days);
  }
  return null;
}

function duration(s: string | null): number | null {
  if (!s || !/^\d+(:\d{1,2}){1,2}$/.test(s)) return null;
  return s.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}

function result(v: Obj): SearchResult {
  const viewsText = text(v.viewCountText) ?? '';
  const live = /watching|zuschauer/i.test(viewsText) || (v.badges ?? []).some((b: Obj) => b.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_LIVE_NOW');
  const digits = viewsText.replace(/\D/g, '');
  let views: Measured<number>;
  if (live) views = noData('Live now: viewers, not views');
  else if (/^no views|^keine aufrufe/i.test(viewsText)) views = value(0, PAGE_SOURCE, { text: viewsText });
  else if (digits) views = value(Number(digits), PAGE_SOURCE, { text: viewsText });
  else views = noData('YouTube showed no view count for this result');
  const ageLabel = text(v.publishedTimeText);
  const days = ageLabel ? parseAge(ageLabel) : null;
  const ageDays = days !== null ? value(days, PAGE_SOURCE, { text: ageLabel! })
    : noData(ageLabel ? `Upload age label not understood: ${ageLabel}` : live ? 'Live now' : 'YouTube showed no upload age for this result');
  const owner = v.ownerText?.runs?.[0] ?? v.longBylineText?.runs?.[0];
  return {
    videoId: String(v.videoId),
    title: text(v.title) ?? '',
    channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
    channelName: owner?.text ?? '',
    views,
    ageDays,
    ageLabel,
    durationSec: duration(text(v.lengthText)),
    live,
  };
}

/**
 * Read a search page: `ytInitialData`, or the `response` of a `yt-navigate-finish` event (same shape).
 * Organic videos in page order (≤ 20); Shorts shelves counted; playlists skipped.
 * Results present in the markup but none readable → error (parser canary), never an empty report.
 */
export function parseSearchPage(response: unknown, query: string): SearchPage | { error: string } {
  const sections = (response as Obj)?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  if (!Array.isArray(sections)) return { error: CANARY };
  const results: SearchResult[] = [];
  let shortsShelves = 0;
  let items = 0;
  let noResultsMessage = false;
  for (const sec of sections as Obj[]) {
    const contents = sec.itemSectionRenderer?.contents;
    if (!Array.isArray(contents)) continue;
    for (const it of contents as Obj[]) {
      items++;
      if (it.videoRenderer?.videoId && results.length < MAX_RESULTS) results.push(result(it.videoRenderer));
      else if (it.gridShelfViewModel || it.reelShelfRenderer) shortsShelves++;
      else if (it.messageRenderer || it.backgroundPromoRenderer) noResultsMessage = true;
    }
  }
  if (results.length === 0 && shortsShelves === 0 && !noResultsMessage && items > 0) return { error: CANARY };
  if (items === 0) return { error: CANARY };
  const est = Number((response as Obj).estimatedResults);
  return { query, results, shortsShelves, estimatedResults: Number.isFinite(est) && (response as Obj).estimatedResults != null ? est : null };
}

/** YouTube's suggestion JSONP (`window.google.ac.h([...])`) → suggestions in YouTube's order. */
export function parseSuggestions(text: string): string[] | null {
  const m = /^\s*window\.google\.ac\.h\((.*)\)\s*;?\s*$/s.exec(text);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]!) as unknown[];
    const list = data[1];
    if (!Array.isArray(list)) return null;
    return list.map((x) => (Array.isArray(x) ? x[0] : x)).filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}

export interface KeywordSuggestions { related: string[]; questions: string[]; matching: string[] }
export const QUESTION_PREFIXES = ['how', 'what', 'why'] as const;
const QUESTION_START = /^(how|what|why|when|where|who|can|is|does|do|should|which)\b/;

/** Related (plain query), questions, and matching (contains every keyword word) — de-duplicated, YouTube's order. */
export function groupSuggestions(keyword: string, lists: { prefix: string; items: string[] }[]): KeywordSuggestions {
  const kw = normalizeKeyword(keyword);
  const words = kw.split(' ').filter(Boolean);
  const uniq = (xs: string[]) => [...new Set(xs.map(normalizeKeyword))].filter((x) => x && x !== kw);
  const plain = lists.filter((l) => l.prefix === '').flatMap((l) => l.items);
  const all = lists.flatMap((l) => l.items);
  const fromPrefixes = lists.filter((l) => l.prefix !== '').flatMap((l) => l.items);
  const questions = uniq([...fromPrefixes, ...all].filter((s) => QUESTION_START.test(normalizeKeyword(s))));
  return {
    related: uniq(plain),
    questions,
    matching: uniq(all.filter((s) => { const n = ` ${normalizeKeyword(s)} `; return words.every((w) => n.includes(` ${w} `) || n.includes(w)); })),
  };
}

export interface TopResultsFacts {
  videos: number;
  medianViews: Measured<number>;
  medianAgeDays: Measured<number>;
  recent: Measured<number>;
  under10kViews: Measured<number>;
  distinctChannels: number;
  topChannel: { name: string; count: number } | null;
  shortsShelves: number;
  channelSizes: Measured<number>;
}

const RECENT_DAYS = 90;
const SMALL_VIEWS = 10_000;

/** Plain counts and medians over the page the user saw (not YouTube API data). */
export function topResultsFacts(page: SearchPage): TopResultsFacts {
  const r = page.results;
  const vals = (pick: (x: SearchResult) => Measured<number>) => r.flatMap((x) => { const m = pick(x); return m.kind === 'value' ? [m.value] : []; });
  const views = vals((x) => x.views);
  const ages = vals((x) => x.ageDays);
  const med = (xs: number[], what: string, why: string): Measured<number> => {
    const m = median(xs);
    return m === null ? noData(why) : value(m, `median ${what} of ${xs.length} results`, { n: xs.length });
  };
  const counts = new Map<string, { name: string; count: number }>();
  for (const x of r) {
    const key = x.channelId ?? x.channelName;
    const c = counts.get(key) ?? { name: x.channelName, count: 0 };
    c.count++;
    counts.set(key, c);
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return {
    videos: r.length,
    medianViews: med(views, 'views', 'No view counts on the page'),
    medianAgeDays: med(ages, 'upload age (days)', 'No upload ages could be read'),
    recent: ages.length ? value(ages.filter((d) => d <= RECENT_DAYS).length, `results uploaded within ${RECENT_DAYS} days`, { of: ages.length }) : noData('No upload ages could be read'),
    under10kViews: views.length ? value(views.filter((v) => v < SMALL_VIEWS).length, `results under ${SMALL_VIEWS} views`, { of: views.length }) : noData('No view counts on the page'),
    distinctChannels: counts.size,
    topChannel: top && top.count >= 3 ? top : null,
    shortsShelves: page.shortsShelves,
    channelSizes: noData("YouTube's search page doesn't show channel sizes"),
  };
}

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n));

/** Deterministic plain-language summary; each sentence quotes its number. */
export function factsSummary(f: TopResultsFacts): string[] {
  const n = f.videos;
  const out: string[] = [];
  if (f.medianViews.kind === 'value') {
    const v = f.medianViews.value;
    const size = v < 10_000 ? 'small' : v < 100_000 ? 'mid-sized' : 'big';
    out.push(`Top videos are ${size}: median ${fmt(v)} views.`);
  }
  if (f.recent.kind === 'value') {
    const r = f.recent.value;
    if (r === 0) out.push(`None of the top ${n} is from the last 3 months.`);
    else if (r >= n / 2) out.push(`${r} of the top ${n} are from the last 3 months — YouTube is showing new videos for this search.`);
  }
  if (f.topChannel) out.push(`${f.topChannel.name} has ${f.topChannel.count} of the top ${n} results.`);
  if (f.under10kViews.kind === 'value' && f.under10kViews.value >= 5) out.push(`${f.under10kViews.value} of the top ${n} have under 10,000 views — smaller videos do rank here.`);
  return out;
}
