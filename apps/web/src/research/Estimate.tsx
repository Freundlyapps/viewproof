import type { KeywordEstimate } from '@viewproof/core';
import type { Loaded } from '../useApi';
import { Badge } from '../ui/Badge';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';

export function Estimate(props: { r: Loaded<KeywordEstimate> }) {
  const { r } = props;
  const head = <h2>Estimated monthly searches <Badge kind="est" /></h2>;
  if (r.state === 'loading') return <div className="card">{head}<p className="empty">Loading…</p></div>;
  if (r.state === 'error') return <div className="card">{head}<p className="empty">{r.error.message}</p></div>;
  const e = r.data;
  if (e.status !== 'ok') return <div className="card">{head}<p className="empty muted">{e.reason}</p></div>;
  return (
    <div className="card">
      {head}
      <p className="small" style={{ marginTop: -6 }}>{e.label}</p>
      <div className="kpi"><div className="v"><Value m={e.volume} format={fmt.count} /></div><div className="l">per month ({e.provider}, {e.country})</div></div>
      {e.monthly.length ? (
        <table aria-label="Monthly estimate">
          <thead><tr><th>Month</th><th className="num">Estimated searches</th></tr></thead>
          <tbody>{e.monthly.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{fmt.count(m.volume)}</td></tr>)}</tbody>
        </table>
      ) : null}
      {e.interestError ? <p className="small muted">YouTube search interest: no data ({e.interestError})</p> : null}
      {e.interest.length ? (
        <p className="small muted">YouTube search interest (Google Trends, 100 = peak): {e.interest.map((p) => `${p.date} ${p.value}`).join(' · ')}</p>
      ) : null}
    </div>
  );
}
