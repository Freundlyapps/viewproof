const DAY_MS = 86_400_000;
const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/**
 * Views per day as YouTube returned them, placed by date from the period start to the last day with data.
 * A day YouTube returned no row for breaks the line, so missing data is never drawn as a value.
 */
export function DailyChart(props: { daily: { date: string; views: number }[]; dataThrough: string | null; start?: string }) {
  const { daily } = props;
  if (daily.length === 0) return <p className="empty">No daily data from YouTube for these dates</p>;
  const first = dayNo(props.start && props.start < daily[0]!.date ? props.start : daily[0]!.date);
  const last = dayNo(daily.at(-1)!.date);
  const span = last - first;
  const max = Math.max(...daily.map((d) => d.views), 1) * 1.1;
  const x = (iso: string) => (span === 0 ? 500 : ((dayNo(iso) - first) / span) * 1000);
  const y = (v: number) => 240 - (v / max) * 230;
  // Runs of consecutive days.
  const runs: { date: string; views: number }[][] = [];
  for (const d of daily) {
    const run = runs.at(-1);
    if (run && dayNo(d.date) - dayNo(run.at(-1)!.date) === 1) run.push(d);
    else runs.push([d]);
  }
  const gaps = runs.length > 1 || dayNo(daily[0]!.date) > first;
  return (
    <>
      <svg viewBox="0 0 1000 240" preserveAspectRatio="none" style={{ width: '100%', height: 'clamp(170px,20vw,260px)' }} role="img" aria-label="Views per day">
        {[60, 120, 180].map((g) => <line key={g} x1="0" x2="1000" y1={g} y2={g} stroke="var(--border)" vectorEffect="non-scaling-stroke" />)}
        {runs.map((run) => {
          const pts = run.map((d) => `${x(d.date).toFixed(1)},${y(d.views).toFixed(1)}`).join(' ');
          const x0 = x(run[0]!.date).toFixed(1);
          const x1 = x(run.at(-1)!.date).toFixed(1);
          return (
            <g key={run[0]!.date}>
              {run.length > 1 ? <polygon points={`${x0},240 ${pts} ${x1},240`} fill="var(--accent)" opacity=".12" /> : null}
              {run.length > 1
                ? <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
                : <circle cx={x0} cy={y(run[0]!.views).toFixed(1)} r="4" fill="var(--accent)" />}
            </g>
          );
        })}
      </svg>
      <div className="row between small muted">
        <span>{props.start && props.start < daily[0]!.date ? props.start : daily[0]!.date}</span>
        <span>Peak {new Intl.NumberFormat('en-US').format(Math.max(...daily.map((d) => d.views)))} views/day</span>
        <span>{props.dataThrough ? `Data through ${props.dataThrough}` : ''}</span>
      </div>
      {gaps ? <p className="small muted">Gaps are days YouTube returned no row for.</p> : null}
    </>
  );
}
