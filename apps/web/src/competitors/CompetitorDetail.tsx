import type { CompetitorDetail as Detail, CompetitorVideo } from '@viewproof/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../ui/Badge';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { useApi } from '../useApi';
import { ago, dateOnly } from './format';
import { type SortKey, SortChips, VideoTable, sortVideos } from './VideoTable';
import { ViewsLine } from './ViewsLine';

export function CompetitorDetail(props: { channelId: string }) {
  const r = useApi<Detail>(`/api/competitors/${encodeURIComponent(props.channelId)}`);
  const [by, setBy] = useState<SortKey>('new');
  const [picked, setPicked] = useState<CompetitorVideo | null>(null);
  const back = <Link to="/competitors?tab=channels" className="small">← Competitors</Link>;
  if (r.state === 'loading') return <>{back}<p className="empty">Loading…</p></>;
  if (r.state === 'error') return <>{back}<p className="empty">{r.error.message}</p></>;
  const d = r.data;
  const count = (n: number) => fmt.count(n);
  const asOf = d.subscribers.kind === 'value' && typeof d.subscribers.inputs.asOf === 'string' ? ` (as of ${dateOnly(d.subscribers.inputs.asOf)})` : '';
  return (
    <>
      {back}
      <div>
        <h1>{d.title}</h1>
        <p className="sub">
          <a href={`https://www.youtube.com/channel/${d.channelId}`} target="_blank" rel="noreferrer">Open on YouTube</a>
          {' · '}Subscribers: <Value m={d.subscribers} format={count} />{asOf}
          {' · '}{d.checkError ? <span className="nodata">{d.checkError}</span> : <>feed checked {ago(d.lastCheckedAt)}</>}
        </p>
      </div>
      <div className="grid g-kpi">
        <div className="card kpi"><div className="l">Uploads in the last 30 days</div><div className="v">{d.summary.inLast30Days.count}</div><div className="small muted">of the feed's latest {d.summary.inLast30Days.ofFeed}</div></div>
        <div className="card kpi"><div className="l">Median views, long</div><div className="v"><Value m={d.summary.medianViewsLong} format={count} /></div></div>
        <div className="card kpi"><div className="l">Median views, Shorts</div><div className="v"><Value m={d.summary.medianViewsShorts} format={count} /></div></div>
        <div className="card kpi"><div className="l">Latest upload</div><div className="v">{ago(d.summary.latestUploadAt)}</div></div>
      </div>
      {picked ? (
        <div className="card">
          <div className="row between"><h2 style={{ margin: 0 }}>{picked.title}</h2><button type="button" className="btn" onClick={() => setPicked(null)}>Close</button></div>
          <p className="small muted">Public view count at each of ViewProof's checks of the feed.</p>
          <ViewsLine title={picked.title} history={picked.history} />
        </div>
      ) : null}
      <div className="card">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Latest uploads <Badge kind="real">REAL · public feed</Badge></h2>
          <SortChips by={by} set={setBy} />
        </div>
        {d.videos.length === 0 ? <p className="empty">The feed lists no uploads.</p> : <VideoTable label="Videos" videos={sortVideos(d.videos, by)} onHistory={setPicked} />}
      </div>
    </>
  );
}
