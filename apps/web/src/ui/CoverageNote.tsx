import type { Coverage } from '@viewproof/core';

/** How far YouTube's data goes (it lags 48–72 h) and which days a comparison covers. */
export function coverageText(c: Coverage): string {
  if (!c.dataThrough) return 'YouTube has no data for these dates yet.';
  if (c.days < c.rangeDays) return `Data through ${c.dataThrough} (${c.days} of ${c.rangeDays} days, compared with the ${c.days} days before)`;
  return `Data through ${c.dataThrough}`;
}
export function CoverageNote(props: { c: Coverage }) {
  return <p className="small muted" style={{ margin: 0 }}>{coverageText(props.c)}</p>;
}
/** Label for the previous period: matches the days actually compared. */
export function previousLabel(c: Coverage, rangeLabel: string): string {
  return c.dataThrough && c.days < c.rangeDays ? `${c.days} day${c.days === 1 ? '' : 's'}` : rangeLabel;
}
