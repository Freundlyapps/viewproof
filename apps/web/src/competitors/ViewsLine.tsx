import type { Snapshot } from '@viewproof/core';
import { fmt } from '../ui/format';

const W = 1000;
const H = 180;
const PAD = 8;

/** One video's public view count at each of ViewProof's checks (single series, accent), with a table view. */
export function ViewsLine(props: { title: string; history: Snapshot[] }) {
  const pts = props.history;
  if (pts.length < 2) return <p className="empty">Views over time need at least two checks; ViewProof checks each feed every few hours.</p>;
  const t0 = Date.parse(pts[0]!.at);
  const t1 = Date.parse(pts.at(-1)!.at);
  const lo = Math.min(...pts.map((p) => p.views));
  const hi = Math.max(...pts.map((p) => p.views));
  const x = (at: string) => PAD + ((Date.parse(at) - t0) / Math.max(t1 - t0, 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - lo) / Math.max(hi - lo, 1)) * (H - 2 * PAD);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 160 }} role="img" aria-label={`Views of ${props.title} over time, ${pts.length} checks`}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
        <polyline points={pts.map((p) => `${x(p.at)},${y(p.views)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {pts.map((p) => (
          <circle key={p.at} cx={x(p.at)} cy={y(p.views)} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" vectorEffect="non-scaling-stroke">
            <title>{`${new Date(p.at).toLocaleString()}: ${fmt.count(p.views)} views`}</title>
          </circle>
        ))}
      </svg>
      <div className="row between small muted"><span>{new Date(pts[0]!.at).toLocaleString()}: {fmt.count(pts[0]!.views)}</span><span>{new Date(pts.at(-1)!.at).toLocaleString()}: {fmt.count(pts.at(-1)!.views)}</span></div>
      <details className="small" open><summary>Table</summary>
        <table aria-label="Views by check"><thead><tr><th>Checked</th><th className="num">Views</th></tr></thead>
          <tbody>{pts.map((p) => <tr key={p.at}><td>{new Date(p.at).toLocaleString()}</td><td className="num">{fmt.count(p.views)}</td></tr>)}</tbody></table>
      </details>
    </>
  );
}
