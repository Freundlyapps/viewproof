import type { KeywordTrends } from '@viewproof/core';
import type { Loaded } from '../useApi';
import { Badge } from '../ui/Badge';

const W = 1000;
const H = 160;
const GAP = 2;

/** Optional: relative YouTube search interest (Google Trends), weekly bars, 100 = peak. Not a number of searches. */
export function Trends(props: { r: Loaded<KeywordTrends> }) {
  const { r } = props;
  const head = <h2>YouTube search interest <Badge kind="est">RELATIVE · Google Trends</Badge></h2>;
  if (r.state === 'loading') return <div className="card">{head}<p className="empty">Loading…</p></div>;
  if (r.state === 'error') return <div className="card">{head}<p className="empty">{r.error.message}</p></div>;
  const t = r.data;
  if (t.status !== 'ok') return <div className="card">{head}<p className="empty muted">{t.reason}</p></div>;
  const pts = t.interest;
  const peak = pts.reduce((a, b) => (b.value > a.value ? b : a), pts[0] ?? { date: '', value: 0 });
  const bw = pts.length ? W / pts.length : 0;
  return (
    <div className="card">
      {head}
      <p className="small" style={{ marginTop: -6 }}>{t.label}</p>
      {pts.length === 0 ? <p className="empty">{t.note}</p> : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 140 }} role="img" aria-label={`YouTube search interest by week, ${t.country}; peak week ${peak.date}`}>
            <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
            {pts.map((p) => {
              const h = Math.max((p.value / 100) * (H - 8), p.value > 0 ? 2 : 0);
              return (
                <rect key={p.date} x={pts.indexOf(p) * bw + GAP / 2} y={H - h} width={Math.max(bw - GAP, 1)} height={h} rx="2" fill="var(--accent)">
                  <title>{`Week of ${p.date}: ${p.value}`}</title>
                </rect>
              );
            })}
          </svg>
          <div className="row between small muted"><span>{pts[0]!.date}</span><span>Peak: week of {peak.date} (100)</span><span>Latest: {pts.at(-1)!.value}</span></div>
          <details className="small"><summary>Table</summary>
            <table aria-label="YouTube search interest by week"><thead><tr><th>Week of</th><th className="num">Interest</th></tr></thead>
              <tbody>{pts.map((p) => <tr key={p.date}><td>{p.date}</td><td className="num">{p.value}</td></tr>)}</tbody></table>
          </details>
        </>
      )}
    </div>
  );
}
