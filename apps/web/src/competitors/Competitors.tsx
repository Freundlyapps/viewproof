import type { Competitor, CompetitorUploads } from '@viewproof/core';
import { type FormEvent, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { isApiError, sendJson } from '../api';
import { Badge } from '../ui/Badge';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { useApi } from '../useApi';
import { CompetitorDetail } from './CompetitorDetail';
import { ago, dateOnly } from './format';
import { type SortKey, SortChips, VideoTable, sortVideos } from './VideoTable';

export const MAX_COMPETITORS = 25;
const EMPTY = 'Track a competitor by pasting its channel link or @handle.';

/** Competitors (spec §8 item 4): up to 25 channels from their public feeds. */
export function Competitors() {
  const { channelId } = useParams();
  return (
    <section className="screen">
      {channelId ? <CompetitorDetail channelId={channelId} /> : <CompetitorList />}
    </section>
  );
}

function CompetitorList() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'channels' ? 'channels' : 'uploads';
  const [version, setVersion] = useState(0);
  const list = useApi<Competitor[]>(`/api/competitors?v=${version}`);
  const [text, setText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = list.state === 'ok' ? list.data.length : null;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await sendJson<Competitor>('POST', '/api/competitors', { input: text.trim() });
    setBusy(false);
    if (isApiError(r)) return setAddError(r.message ?? r.error);
    setAddError(null);
    setText('');
    setVersion((x) => x + 1);
  };
  const remove = async (id: string) => {
    const r = await sendJson('DELETE', `/api/competitors/${encodeURIComponent(id)}`);
    if (!isApiError(r)) setVersion((x) => x + 1);
  };

  return (
    <>
      <div className="row between" style={{ alignItems: 'end' }}>
        <div><h1>Competitors</h1><p className="sub">New uploads and their pace, from each channel's public feed.</p></div>
        {n !== null ? <span className="muted">{n} of {MAX_COMPETITORS}</span> : null}
      </div>
      <form className="card row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={add}>
        <label style={{ flex: 1, minWidth: 260 }}>Competitor channel<br /><input value={text} placeholder="https://www.youtube.com/@handle or UC…" onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} /></label>
        <button type="submit" className="btn pri" disabled={busy || (n !== null && n >= MAX_COMPETITORS)}>Track</button>
        {addError ? <p className="small" role="alert" style={{ width: '100%', margin: 0 }}>{addError}</p> : null}
      </form>
      {list.state === 'loading' ? <p className="empty">Loading…</p> : list.state === 'error' ? <p className="empty">{list.error.message}</p> : list.data.length === 0 ? (
        <div className="card"><p className="empty">{EMPTY}</p></div>
      ) : (
        <>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'uploads'} className={`tab${tab === 'uploads' ? ' on' : ''}`} onClick={() => setParams({})}>New uploads</button>
            <button type="button" role="tab" aria-selected={tab === 'channels'} className={`tab${tab === 'channels' ? ' on' : ''}`} onClick={() => setParams({ tab: 'channels' })}>Channels</button>
          </div>
          {tab === 'uploads' ? <Uploads version={version} /> : <ChannelsTable list={list.data} onRemove={remove} />}
        </>
      )}
    </>
  );
}

function Uploads(props: { version: number }) {
  const r = useApi<CompetitorUploads>(`/api/competitors/uploads?v=${props.version}`);
  const [by, setBy] = useState<SortKey>('new');
  if (r.state === 'loading') return <p className="empty">Loading…</p>;
  if (r.state === 'error') return <p className="empty">{r.error.message}</p>;
  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>New uploads <Badge kind="real">REAL · public feed</Badge></h2>
        <SortChips by={by} set={setBy} />
      </div>
      <p className="small muted">Each channel's feed lists its latest 15 uploads. Views per hour: between two of ViewProof's checks at least an hour apart, otherwise the average since upload. ×N: views ÷ the median of the channel's earlier uploads of the same type.</p>
      {r.data.uploads.length === 0 ? <p className="empty">No uploads in the feeds yet.</p> : <VideoTable label="New uploads" videos={sortVideos(r.data.uploads, by)} channel />}
    </div>
  );
}

function ChannelsTable(props: { list: Competitor[]; onRemove: (id: string) => void }) {
  const count = (n: number) => fmt.count(n);
  return (
    <div className="card">
      <table aria-label="Tracked channels">
        <thead><tr>
          <th>Channel</th><th className="num">Subscribers <Badge kind="real">REAL · YouTube Data API</Badge></th><th>Latest upload</th><th>Last 30 days</th>
          <th className="num">Median views, long</th><th className="num">Median views, Shorts</th><th>Checked</th><th />
        </tr></thead>
        <tbody>
          {props.list.map((c) => (
            <tr key={c.channelId}>
              <td><Link to={`/competitors/${c.channelId}`}>{c.title}</Link>{c.handle ? <div className="small muted">{c.handle}</div> : null}</td>
              <td className="num"><Value m={c.subscribers} format={count} />{c.subscribers.kind === 'value' && typeof c.subscribers.inputs.asOf === 'string' ? <div className="small muted">as of {dateOnly(c.subscribers.inputs.asOf)}</div> : null}</td>
              <td>{ago(c.summary.latestUploadAt)}</td>
              <td>{c.summary.inLast30Days.count} of the feed's latest {c.summary.inLast30Days.ofFeed}</td>
              <td className="num"><Value m={c.summary.medianViewsLong} format={count} /></td>
              <td className="num"><Value m={c.summary.medianViewsShorts} format={count} /></td>
              <td>{c.checkError ? <span className="nodata">{c.checkError}</span> : ago(c.lastCheckedAt)}</td>
              <td><button type="button" className="btn" onClick={() => props.onRemove(c.channelId)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
