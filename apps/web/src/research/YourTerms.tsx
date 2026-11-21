import type { YourTerms as YourTermsData } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import type { Loaded } from '../useApi';
import { Badge } from '../ui/Badge';
import { CoverageNote } from '../ui/CoverageNote';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';

export function YourTerms(props: { channel: ChannelInfo | null; r: Loaded<YourTermsData> }) {
  const { r } = props;
  const head = <h2>Your search terms <Badge kind="real">REAL · YouTube Analytics</Badge></h2>;
  if (!props.channel) return <div className="card">{head}<p className="empty">Connect a channel to see which of your real search terms match.</p></div>;
  return (
    <div className="card">
      {head}
      <p className="small muted" style={{ marginTop: -6 }}>Real YouTube searches that led to your videos and contain this keyword (your top 25, last 90 days).</p>
      {r.state === 'loading' ? <p className="empty">Loading…</p> : null}
      {r.state === 'error' ? <ErrorNote error={r.error} /> : null}
      {r.state === 'ok' ? <CoverageNote c={r.data.coverage} /> : null}
      {r.state === 'ok' && r.data.note ? <p className="empty">{r.data.note}</p> : null}
      {r.state === 'ok' && r.data.terms.length > 0 ? (
        <table aria-label="Your search terms">
          <thead><tr><th>Term</th><th className="num">Views</th><th className="num">Previous period</th><th className="num">Watch time</th></tr></thead>
          <tbody>
            {r.data.terms.map((t) => (
              <tr key={t.term}><td>{t.term}</td><td className="num">{fmt.count(t.views)}</td><td className="num"><Value m={t.previousViews} format={fmt.count} /></td><td className="num">{fmt.hours(t.watchMinutes)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
