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
