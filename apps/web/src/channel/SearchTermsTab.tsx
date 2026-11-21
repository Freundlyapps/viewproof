import type { SearchTerms } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import { useApi } from '../useApi';
import { Badge } from '../ui/Badge';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { useRange } from './RangeChips';

export function SearchTermsTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const r = useApi<SearchTerms>(`/api/channels/${props.channel.id}/search-terms?range=${range}`);
  return (
    <div className="card">
      <h2>What people typed before finding you <Badge kind="real">REAL · YouTube</Badge></h2>
      <p className="small muted" style={{ marginTop: -6 }}>Real YouTube searches that led to your videos (YouTube's top 25).</p>
      {r.state === 'loading' ? <p className="empty">Loading…</p> : null}
      {r.state === 'error' ? <ErrorNote error={r.error} /> : null}
      {r.state === 'ok' && r.data.note ? <p className="empty">{r.data.note}</p> : null}
      {r.state === 'ok' && r.data.terms.length > 0 ? (
        <table>
          <thead><tr><th>Term</th><th className="num">Views</th><th className="num">Previous period</th><th className="num">Watch time</th><th>Your video</th></tr></thead>
          <tbody>
            {r.data.terms.map((t) => (
              <tr key={t.term}>
                <td>{t.term}</td>
                <td className="num">{fmt.count(t.views)}</td>
                <td className="num"><Value m={t.previousViews} format={fmt.count} /></td>
                <td className="num">{fmt.hours(t.watchMinutes)}</td>
                <td>{t.topVideo ? t.topVideo.title : <span className="muted small">not among your top 10 videos</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
