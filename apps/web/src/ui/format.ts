const int = new Intl.NumberFormat('en-US');
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = {
  count: (n: number) => int.format(Math.round(n)),
  /** YouTube reports minutes; shown as hours with one decimal. */
  hours: (minutes: number) => `${one.format(minutes / 60)} h`,
  /** Seconds → m:ss or h:mm:ss. */
  duration: (sec: number) => {
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  },
  usd: (n: number) => money.format(n),
};

export const RANGE_LABEL: Record<string, string> = { '7d': '7 days', '28d': '28 days', '90d': '90 days', '365d': '12 months' };

/** "Mon 18:30" in the viewer's time zone. */
export function weekdayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).replace(',', '');
}
