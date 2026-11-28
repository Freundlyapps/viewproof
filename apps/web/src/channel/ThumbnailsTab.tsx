import type { Thumbnails } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import { useApi } from '../useApi';
import { BarList } from '../ui/BarList';
import { Badge } from '../ui/Badge';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { CtrDays } from '../ui/CtrDays';
import { Value } from '../ui/Value';
import { useRange } from './RangeChips';

/** Thumbnail impressions and click-through rate (YouTube Reporting API, last 30 days at most). */
export function ThumbnailsTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const r = useApi<Thumbnails>(`/api/channels/${props.channel.id}/thumbnails?range=${range}`);
  if (r.state === 'loading') return <p className="empty">Loading…</p>;
  if (r.state === 'error') return <ErrorNote error={r.error} />;
  const t = r.data;
  if (t.status !== 'ok') {
    return (
      <div className="card" data-testid="thumbs-status">
        <h2>{t.status === 'waiting' ? 'Thumbnail data is on its way' : "YouTube didn't start thumbnail reports"}</h2>
        <p className="small muted">{t.reason}</p>
        {t.status === 'waiting' ? <p className="small muted">Nothing to do: ViewProof checks for new reports every few hours. Come back in a day or two.</p> : null}
      </div>
    );
  }
  const maxImp = Math.max(1, ...t.daily.map((d) => d.impressions));
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        {t.days.count ? `Thumbnail data for ${t.days.count} days (${t.days.from} to ${t.days.to}). ViewProof keeps the last 30 days.` : t.reason}
      </p>
      <div className="grid g-kpi">
        <div className="card kpi" data-testid="kpi-impressions"><div className="l row between"><span>Impressions</span><Badge kind="real" /></div><div className="v"><Value m={t.totals.impressions} format={fmt.count} /></div><div className="small muted">Times your thumbnails were shown</div></div>
        <div className="card kpi"><div className="l row between"><span>End screen impressions</span><Badge kind="real" /></div><div className="v"><Value m={t.endScreens.impressions} format={fmt.count} /></div><div className="small muted">End screen elements shown</div></div>
        <div className="card kpi"><div className="l row between"><span>End screen clicks</span><Badge kind="real" /></div><div className="v"><Value m={t.endScreens.clicks} format={fmt.count} /></div><div className="small muted">Clicks on them</div></div>
      </div>
      {t.daily.length ? (
        <div className="card">
          <h2>Impressions per day</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140 }} role="img" aria-label="Thumbnail impressions per day">
            {t.daily.map((d) => <div key={d.date} title={`${d.date}: ${fmt.count(d.impressions)} impressions`} style={{ flex: 1, height: `${(d.impressions / maxImp) * 100}%`, background: 'var(--accent)', opacity: 0.75, borderRadius: '3px 3px 0 0', minHeight: 2 }} />)}
          </div>
          <div className="row between small muted"><span>{t.daily[0]!.date}</span><span>{t.daily.at(-1)!.date}</span></div>
        </div>
      ) : null}
      <div className="card" style={{ overflow: 'auto' }}>
        <h2>Your videos: impressions and click-through rate</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Click-through rate: of the people who saw the thumbnail, how many clicked to watch. YouTube gives it per day; hover a bar for the day's value.</p>
        {t.videos.length === 0 ? <p className="empty">No video had thumbnail impressions in these days.</p> : (
          <table>
            <thead><tr><th>Video</th><th className="num">Impressions</th><th className="num">CTR (latest day)</th><th>CTR per day</th></tr></thead>
            <tbody>{t.videos.map((v) => (
              <tr key={v.videoId}>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>{v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" style={{ width: 64, borderRadius: 6, flex: 'none' }} /> : null}<span>{v.title}</span></div></td>
                <td className="num">{fmt.count(v.impressions)}</td>
                <td className="num"><Value m={v.latestCtr} format={fmt.pct} />{v.latestCtr.kind === 'value' ? <div className="small muted">{String(v.latestCtr.inputs.day)}</div> : null}</td>
                <td style={{ width: 180 }}><CtrDays days={v.ctrByDay} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Where your thumbnails were shown</h2>
        {t.sources.length === 0 ? <p className="empty">YouTube sent no split by source for these days.</p>
          : <BarList testId="thumb-sources" items={t.sources.map((s) => ({ key: String(s.type), label: s.label, value: s.impressions, right: `${fmt.count(s.impressions)} impressions` }))} />}
      </div>
      <div className="hint small muted">Click-through rates differ by where the thumbnail is shown: search and Suggested usually get more clicks than the home page. Compare your videos with each other, not with a fixed number.</div>
    </>
  );
}
