import type { TrafficSources } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import { useApi } from '../useApi';
import { BarList } from '../ui/BarList';
import { Badge } from '../ui/Badge';
import { CoverageNote } from '../ui/CoverageNote';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { useRange } from './RangeChips';

/** Where views came from: YouTube search, Browse, Suggested, Shorts feed… */
export function TrafficTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const r = useApi<TrafficSources>(`/api/channels/${props.channel.id}/traffic?range=${range}`);
  if (r.state === 'loading') return <p className="empty">Loading…</p>;
  if (r.state === 'error') return <ErrorNote error={r.error} />;
  const t = r.data;
  return (
    <>
      <CoverageNote c={t.coverage} />
      <div className="grid g-2">
        <div className="card">
          <h2>Where your views come from <Badge kind="real" /></h2>
          <p className="small muted" style={{ marginTop: -6 }}>Views from each source in these dates, as YouTube reports them.</p>
          {t.note ? <p className="empty">{t.note}</p> : <BarList testId="traffic-bars" items={t.sources.map((s) => ({ key: s.type, label: s.label, value: s.views, right: `${fmt.count(s.views)} views` }))} />}
        </div>
        <div className="card">
          <h2>What each source means</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
            <li><b>Browse features</b>: the home page, subscriptions feed and Watch later.</li>
            <li><b>Suggested videos</b>: next to or after other videos.</li>
            <li><b>YouTube search</b>: people searched. See what they typed in Search terms.</li>
            <li><b>Shorts feed</b>: swiping through Shorts.</li>
            <li><b>External</b>: links on other sites and apps, including Google search.</li>
            <li><b>Channel pages</b>, <b>Playlists</b>, <b>Notifications</b>, <b>End screens</b>: from your own channel.</li>
          </ul>
        </div>
      </div>
      {t.sources.length ? (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead><tr><th>Source</th><th className="num">Views</th><th className="num">Previous period</th><th className="num">Watch time</th></tr></thead>
            <tbody>{t.sources.map((s) => (
              <tr key={s.type}><td>{s.label}</td><td className="num">{fmt.count(s.views)}</td><td className="num"><Value m={s.previousViews} format={fmt.count} /></td><td className="num">{fmt.hours(s.watchMinutes)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
