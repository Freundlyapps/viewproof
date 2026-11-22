import type { Outliers as OutliersData } from '@viewproof/core';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ago } from '../competitors/format';
import { Outlier } from '../competitors/VideoTable';
import { Badge } from '../ui/Badge';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { useApi } from '../useApi';

const DEFAULTS = { format: 'any', days: '30', size: 'any', min: '2', q: '' } as const;
type Key = keyof typeof DEFAULTS;
const ORDER: Key[] = ['format', 'days', 'size', 'min', 'q'];

/** Research → Outliers: videos the network found that beat their channel's usual views (spec §8 item 5). */
export function OutliersPage() {
  const [params, setParams] = useSearchParams();
  const val = (k: Key) => params.get(k) ?? DEFAULTS[k];
  const set = (k: Key, v: string) => {
    const next = new URLSearchParams();
    for (const key of ORDER) {
      const x = key === k ? v : val(key);
      if (x && x !== DEFAULTS[key]) next.set(key, x);
    }
    setParams(next);
  };
  const query = new URLSearchParams(ORDER.flatMap((k) => (val(k) !== DEFAULTS[k] ? [[k, val(k)]] : []))).toString();
  const r = useApi<OutliersData>(`/api/outliers${query ? `?${query}` : ''}`);
  const [text, setText] = useState(val('q'));
  const submit = (e: FormEvent) => { e.preventDefault(); set('q', text.trim()); };
  const select = (k: Key, label: string, opts: [string, string][]) => (
    <label>{label}<br /><select value={val(k)} onChange={(e) => set(k, e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  );
  return (
    <>
      <form className="card row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={submit}>
        <label style={{ flex: 1, minWidth: 180 }}>Keyword in title<br /><input value={text} maxLength={100} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} /></label>
        {select('format', 'Format', [['any', 'Any'], ['long', 'Long videos'], ['short', 'Shorts']])}
        {select('days', 'Uploaded within', [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '12 months']])}
        {select('size', 'Channel size', [['any', 'Any'], ['small', 'Usual views under 10k'], ['medium', 'Usual views 10k–100k'], ['large', 'Usual views over 100k']])}
        {select('min', 'At least', [['1.5', '×1.5'], ['2', '×2'], ['3', '×3'], ['5', '×5'], ['10', '×10']])}
        <button type="submit" className="btn pri">Search</button>
      </form>
      <Results r={r} min={val('min')} />
    </>
  );
}

function Results(props: { r: ReturnType<typeof useApi<OutliersData>>; min: string }) {
  const { r } = props;
  if (r.state === 'loading') return <p className="empty">Loading…</p>;
  if (r.state === 'error') return <p className="empty">{r.error.message}</p>;
  const { rows, coverage: c } = r.data;
  if (c.videos === 0) {
    return <div className="card"><p className="empty">Your network hasn't found videos yet. Link your browser in <Link to="/settings/extension">Settings → Extension &amp; data</Link>.</p></div>;
  }
  const count = (n: number) => fmt.count(n);
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Videos our network found <Badge kind="real">REAL · public feed</Badge></h2>
      <p className="small muted">
        {c.videos} videos from {c.channels} channels that our network found in the last {c.days} days — not all of YouTube.
        {c.olderThanFeed ? ` ${c.olderThanFeed} of them are older than their channel's latest 15 uploads, so the public feed gives no ×N for them.` : ''}
        {c.channelsWaiting ? ` ${c.channelsWaiting} channels are waiting for their first feed check.` : ''}
        {' '}×N = views ÷ the median views of the channel's earlier uploads of the same type, from its public feed (latest 15 uploads).
      </p>
      {rows.length === 0 ? <p className="empty">No video beats its channel's usual by ×{props.min} with these filters.</p> : (
        <ul aria-label="Outliers" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {rows.map((v) => (
            <li key={v.videoId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ position: 'relative' }}>
                <img src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8, background: 'var(--surface-2)' }} />
                <span style={{ position: 'absolute', top: 6, left: 6 }}><Outlier m={v.outlier} /></span>
              </div>
              <a href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{v.title}</a>
              <span className="small muted">{v.channelTitle} · {ago(v.publishedAt)}{v.format === 'short' ? <> · <span>Short</span></> : null}</span>
              <span className="small"><Value m={v.views} format={(n) => `${count(n)} views`} /> · <span className="muted"><Value m={v.channelMedian} format={(n) => `usual ${count(n)}`} /></span></span>
              <span className="small">Views / hour: <Value m={v.vph} format={count} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
