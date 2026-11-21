/** Date ranges for My channel (spec §8 item 2: channel audit 30/60/90 days → 7/28/90 days and 12 months). */
export type RangeKey = '7d' | '28d' | '90d' | '365d';
export const RANGES: RangeKey[] = ['7d', '28d', '90d', '365d'];
export const RANGE_DAYS: Record<RangeKey, number> = { '7d': 7, '28d': 28, '90d': 90, '365d': 365 };

export function parseRange(s: string | undefined): RangeKey {
  return (RANGES as string[]).includes(s ?? '') ? (s as RangeKey) : '28d';
}

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `end` is today (UTC date); the previous period has the same length and ends the day before `start`. */
export function periodFor(range: RangeKey, todayIso: string): { start: string; end: string; prevStart: string; prevEnd: string } {
  const days = RANGE_DAYS[range];
  const end = Date.parse(`${todayIso}T00:00:00Z`);
  const start = end - (days - 1) * DAY_MS;
  return { start: iso(start), end: iso(end), prevStart: iso(start - days * DAY_MS), prevEnd: iso(start - DAY_MS) };
}

export interface Coverage { period: { start: string; end: string; prevStart: string; prevEnd: string }; dataThrough: string | null; days: number; rangeDays: number }

/**
 * YouTube lags 48–72 h, so the current period's last days are empty. Compare only the days it has filled:
 * the current period ends at `dataThrough`, and the previous period is the same number of days before it.
 */
export function coverage(range: RangeKey, todayIso: string, dataThrough: string | null): Coverage {
  const full = periodFor(range, todayIso);
  const rangeDays = RANGE_DAYS[range];
  if (!dataThrough || dataThrough < full.start) return { period: full, dataThrough: null, days: 0, rangeDays };
  const end = dataThrough > full.end ? full.end : dataThrough;
  const startMs = Date.parse(`${full.start}T00:00:00Z`);
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - startMs) / DAY_MS) + 1;
  return { period: { start: full.start, end, prevStart: iso(startMs - days * DAY_MS), prevEnd: iso(startMs - DAY_MS) }, dataThrough: end, days, rangeDays };
}

/** Today's date in YouTube Analytics' time zone (Pacific), so we never ask for a day that hasn't started there. */
export function todayPacific(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}
