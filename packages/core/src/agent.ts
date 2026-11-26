// The weekly agent's arithmetic (Phase 2 "propose → approve → measure"). Pure code: the AI never computes these numbers.
// Facts only (no score): views in the days after a change next to the same number of days before it, and how much
// the video normally moved between such periods before anything changed.

export interface DayViews { date: string; views: number; searchViews: number }
export type Verdict = 'above_swing' | 'below_swing' | 'within_swing' | 'too_few' | 'no_history';

export interface MetricResult {
  before: number;
  after: number;
  /** after vs before in percent, one decimal; null when before is 0. */
  changePct: number | null;
  /** The biggest period-to-period change (in percent, absolute) in the periods before the change; null without enough history. */
  usualSwingPct: number | null;
  /** How many earlier period-to-period changes the swing is taken from. */
  swingCount: number;
  verdict: Verdict;
}

export type Measurement =
  | { state: 'waiting'; readyOn: string }
  | { state: 'measured'; days: number; applied: string; afterEnd: string; views: MetricResult; searchViews: MetricResult };

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const addDays = (iso: string, n: number) => new Date(toMs(iso) + n * DAY).toISOString().slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (from: number, to: number) => (from === 0 ? null : round1(((to - from) / from) * 100));

/** Earlier periods compared: 8 weeks for the 7-day check, 4 periods (112 days) for the 28-day check. */
export const HISTORY_PERIODS: Record<7 | 28, number> = { 7: 8, 28: 4 };
/** Below one view a day before the change, a percentage says nothing. */
const MIN_VIEWS_PER_DAY = 1;

/** First day (inclusive) of the Analytics query a measurement needs. */
export function historyStart(applied: string, days: 7 | 28): string {
  return addDays(applied, -days * HISTORY_PERIODS[days]);
}

function metric(sums: { after: number; before: number[] }, days: number): MetricResult {
  const [before, ...older] = sums.before;
  const b = before ?? 0;
  const changePct = pct(b, sums.after);
  // Swings between consecutive earlier periods: older[i] → (i === 0 ? before : older[i-1]).
  const chain = [b, ...older];
  const swings: number[] = [];
  for (let i = 1; i < chain.length; i++) {
    const p = pct(chain[i]!, chain[i - 1]!);
    if (p !== null) swings.push(Math.abs(p));
  }
  const usualSwingPct = swings.length >= 2 ? Math.max(...swings) : null;
  let verdict: Verdict;
  if (b < MIN_VIEWS_PER_DAY * days || changePct === null) verdict = 'too_few';
  else if (usualSwingPct === null) verdict = 'no_history';
  else if (Math.abs(changePct) <= usualSwingPct) verdict = 'within_swing';
  else verdict = changePct > 0 ? 'above_swing' : 'below_swing';
  return { before: b, after: sums.after, changePct, usualSwingPct, swingCount: swings.length, verdict };
}

/**
 * Views in the `days` after `applied` (the first day the new title was live) against the `days` before,
 * plus the usual swing between earlier periods. Days YouTube didn't report count as 0 views, but only periods
 * that start on or after `published` are used, so a young video isn't compared with days before it existed.
 */
export function measureChange(daily: DayViews[], o: { applied: string; days: 7 | 28; dataThrough: string | null; published: string }): Measurement {
  const afterEnd = addDays(o.applied, o.days - 1);
  if (!o.dataThrough || o.dataThrough < afterEnd) return { state: 'waiting', readyOn: afterEnd };
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const sum = (start: string, key: 'views' | 'searchViews') => {
    let t = 0;
    for (let i = 0; i < o.days; i++) t += byDate.get(addDays(start, i))?.[key] ?? 0;
    return t;
  };
  const published = o.published.slice(0, 10);
  const starts: string[] = [];
  for (let k = 1; k <= HISTORY_PERIODS[o.days]; k++) {
    const s = addDays(o.applied, -k * o.days);
    if (s < published) break;
    starts.push(s);
  }
  const of = (key: 'views' | 'searchViews') => metric({ after: sum(o.applied, key), before: starts.map((s) => sum(s, key)) }, o.days);
  return { state: 'measured', days: o.days, applied: o.applied, afterEnd, views: of('views'), searchViews: of('searchViews') };
}

export interface CandidateVideo { videoId: string; title: string; publishedAt: string; views28: number | null }

/**
 * Videos worth a title proposal: published 28–365 days ago (settled, but not ancient), views in the last 28 days known
 * and below the median of those videos, and at least one view a day (so a later measurement can say something).
 * Lowest first, at most `max`.
 */
export function pickCandidates(videos: CandidateVideo[], today: string, max = 3): { median: number | null; videos: CandidateVideo[] } {
  const age = (v: CandidateVideo) => (toMs(today) - toMs(v.publishedAt)) / DAY;
  const pool = videos.filter((v) => v.views28 !== null && age(v) >= 28 && age(v) <= 365);
  if (pool.length < 3) return { median: null, videos: [] };
  const sorted = pool.map((v) => v.views28!).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const picked = pool
    .filter((v) => v.views28! < median && v.views28! >= 28)
    .sort((a, b) => a.views28! - b.views28!)
    .slice(0, max);
  return { median, videos: picked };
}

/** Plain-language line for one metric, built from the numbers only. */
export function describeMetric(name: string, m: MetricResult, days: number): string {
  const head = `${name}: ${m.after.toLocaleString('en-US')} in the ${days} days after, ${m.before.toLocaleString('en-US')} in the ${days} days before`;
  const ch = m.changePct === null ? '' : ` (${m.changePct > 0 ? '+' : ''}${m.changePct}%)`;
  switch (m.verdict) {
    case 'too_few':
      return `${head}${ch}. Too few views to tell anything.`;
    case 'no_history':
      return `${head}${ch}. Not enough earlier history to know its usual ups and downs, so we can't tell if this is unusual.`;
    case 'within_swing':
      return `${head}${ch}. That's within its usual ups and downs (up to ±${m.usualSwingPct}% between earlier periods), so we can't tell if the change did anything.`;
    case 'above_swing':
    case 'below_swing':
      return `${head}${ch}. That's more than its biggest move between earlier periods (±${m.usualSwingPct}%). Other things can cause this too, such as a trend or a link from elsewhere.`;
  }
}
