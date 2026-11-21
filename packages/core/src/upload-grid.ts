/** When the creator posts: a count of their own uploads per weekday × 4-hour block, in the viewer's time zone. */
export const GRID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const GRID_BLOCKS = ['0–4h', '4–8h', '8–12h', '12–16h', '16–20h', '20–24h'];

export function uploadGrid(uploads: { publishedAt: string }[], timeZone: string): { days: string[]; blocks: string[]; counts: number[][] } {
  const counts = GRID_DAYS.map(() => GRID_BLOCKS.map(() => 0));
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  for (const u of uploads) {
    const t = Date.parse(u.publishedAt);
    if (!Number.isFinite(t)) continue;
    const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, p.value]));
    const d = GRID_DAYS.indexOf(parts.weekday ?? '');
    const h = Number(parts.hour);
    if (d < 0 || !Number.isFinite(h)) continue;
    counts[d]![Math.floor(h / 4)]! += 1;
  }
  return { days: GRID_DAYS, blocks: GRID_BLOCKS, counts };
}
