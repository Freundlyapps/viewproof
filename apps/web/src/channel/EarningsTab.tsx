import type { Earnings } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import { useApi } from '../useApi';
import { Badge } from '../ui/Badge';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { Kpi } from './Kpi';
import { useRange } from './RangeChips';

export function EarningsTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const r = useApi<Earnings>(`/api/channels/${props.channel.id}/earnings?range=${range}`);
  if (r.state === 'loading') return <p className="empty">Loading…</p>;
  if (r.state === 'error') return <ErrorNote error={r.error} />;
  const e = r.data;
  if (e.status === 'not_granted') {
    return (
      <div className="card">
        <h2>Revenue isn't connected</h2>
        <p className="small muted">You connected this channel without revenue access. ViewProof can show YouTube's revenue estimates (view only) if you allow it.</p>
        <a className="btn pri" href="/auth/google/start?choose=1&revenue=1">Add revenue access</a>
      </div>
    );
  }
  if (e.status === 'not_available') {
    return <div className="card"><h2>Revenue isn't available for this channel</h2><p className="small muted">{e.reason}</p></div>;
  }
  return (
    <>
      <div className="grid g-kpi">
        <Kpi id="kpi-revenue" label="Estimated revenue" pair={e.totals.estimatedRevenue} range={e.range} format={fmt.usd} badge="est" />
        <Kpi id="kpi-cpm" label="Playback-based CPM" pair={e.totals.playbackBasedCpm} range={e.range} format={fmt.usd} badge="est" />
        <Kpi id="kpi-playbacks" label="Monetized playbacks" pair={e.totals.monetizedPlaybacks} range={e.range} format={fmt.count} />
      </div>
      <div className="card">
        <h2>Top earning videos <Badge kind="est" /></h2>
        {e.topVideos.length === 0 ? <p className="empty">YouTube reported no revenue by video for these dates.</p> : (
          <table>
            <thead><tr><th>Video</th><th className="num">Estimated revenue</th><th className="num">Playback-based CPM</th></tr></thead>
            <tbody>{e.topVideos.map((v) => (
              <tr key={v.videoId}><td>{v.title}</td><td className="num">{fmt.usd(v.estimatedRevenue)}</td><td className="num"><Value m={v.playbackBasedCpm} format={fmt.usd} /></td></tr>
            ))}</tbody>
          </table>
        )}
        <div className="note" style={{ marginTop: 12 }}>YouTube's estimate; it can change at month end.</div>
      </div>
    </>
  );
}
