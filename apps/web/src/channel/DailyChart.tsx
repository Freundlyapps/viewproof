/** Views per day as YouTube returned them; no padding for days it hasn't processed yet. */
export function DailyChart(props: { daily: { date: string; views: number }[]; dataThrough: string | null }) {
  const { daily } = props;
  if (daily.length === 0) return <p className="empty">No daily data from YouTube for these dates</p>;
  const max = Math.max(...daily.map((d) => d.views), 1) * 1.1;
  const x = (i: number) => (daily.length === 1 ? 500 : (i / (daily.length - 1)) * 1000);
  const pts = daily.map((d, i) => `${x(i).toFixed(1)},${(240 - (d.views / max) * 230).toFixed(1)}`).join(' ');
  return (
    <>
      <svg viewBox="0 0 1000 240" preserveAspectRatio="none" style={{ width: '100%', height: 'clamp(170px,20vw,260px)' }} role="img" aria-label="Views per day">
        {[60, 120, 180].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="var(--border)" vectorEffect="non-scaling-stroke" />)}
        <polygon points={`0,240 ${pts} 1000,240`} fill="var(--accent)" opacity=".12" />
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="row between small muted">
        <span>{daily[0]!.date}</span>
        <span>Peak {new Intl.NumberFormat('en-US').format(Math.max(...daily.map((d) => d.views)))} views/day</span>
        <span>{props.dataThrough ? `Data through ${props.dataThrough}` : ''}</span>
      </div>
    </>
  );
}
