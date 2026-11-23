import { type Outliers, checkTitle, normalizeKeyword, titleFacts } from '@viewproof/core';
import { useEffect, useState } from 'react';
import { DataUsed, Failure } from '../ai/Answer';
import { type AiFailure, type QuickResult, isFailure, postAi } from '../ai/types';
import { Outlier } from '../competitors/VideoTable';
import { Badge } from '../ui/Badge';
import { useApi } from '../useApi';
import { Checks } from './Checks';
import { Preview } from './Preview';

/** Titles of niche outliers for the keyword (pool, last 90 days, ×2 or more) and plain counts about them.
 *  Fetched only when asked: each keyword search counts toward the free plan's daily outlier searches. */
export function OutlierTitles(props: { keyword: string }) {
  const q = normalizeKeyword(props.keyword);
  const [asked, setAsked] = useState<string | null>(null);
  const r = useApi<Outliers>(q && asked === q ? `/api/outliers?${new URLSearchParams({ q, days: '90', min: '2' })}` : null);
  if (!q) return null;
  if (asked !== q) return <div><button type="button" className="btn" onClick={() => setAsked(q)}>Compare with outlier titles</button></div>;
  if (r.state === 'loading') return <p className="muted small">Looking for outlier titles…</p>;
  if (r.state === 'error') return <p className="err-text small">{r.error.message}</p>;
  const rows = r.data.rows;
  const facts = titleFacts(rows.map((x) => x.title), q);
  return (
    <div className="stack-s">
      <h3>Outlier titles for "{q}"</h3>
      {facts.ok
        ? <p className="small">{facts.facts.n} titles · median length {facts.facts.medianLength} · {facts.facts.withNumber} with a number · {facts.facts.question} {facts.facts.question === 1 ? 'question' : 'questions'} · {facts.facts.keywordEarly} with the keyword in the first 40 characters</p>
        : <p className="small nodata">No data: {facts.reason}</p>}
      {rows.length > 0 && (
        <ul className="lines small">
          {rows.slice(0, 10).map((x) => <li key={x.videoId}><Outlier m={x.outlier} /> <a href={`https://www.youtube.com/watch?v=${x.videoId}`} target="_blank" rel="noopener noreferrer">{x.title}</a> <span className="muted">· {x.channelTitle}</span></li>)}
        </ul>
      )}
      <p className="note">From videos our network observed in the last 90 days; not all of YouTube.</p>
    </div>
  );
}

/** Optional AI title ideas (labelled AI), through 6a's quick action. */
export function AiTitles(props: { title: string; keyword: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<QuickResult | AiFailure | null>(null);
  const topic = props.keyword.trim() || props.title.trim();
  const run = async () => {
    setBusy(true);
    setR(await postAi<QuickResult>('/api/ai/quick', { action: 'titles', topic, notes: props.title.trim() ? `Current title: ${props.title.trim()}` : '' }));
    setBusy(false);
  };
  return (
    <div className="stack-s">
      <div><button type="button" className="btn" disabled={busy || !topic} onClick={() => void run()}>{busy ? 'Writing…' : 'Suggest titles with AI'}</button></div>
      {r && isFailure(r) && <Failure f={r} />}
      {r && !isFailure(r) && (
        <>
          <ul className="results" aria-label="AI suggestions">
            {r.items.map((it, i) => <li key={i}><div className="row"><Badge kind="ai" /><span className="ai-text">{it.text}</span></div>{it.why && <p className="small muted">{it.why}</p>}</li>)}
          </ul>
          <DataUsed sources={r.sources} missing={r.missing} highlight={null} open={false} />
        </>
      )}
    </div>
  );
}

export function TitleChecker() {
  const [title, setTitle] = useState('');
  const [keyword, setKeyword] = useState('');
  return (
    <div className="card stack">
      <h2>Check a title</h2>
      <div className="grid g-2">
        <div className="field"><label htmlFor="tc-title">Title</label><input id="tc-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="tc-keyword">Keyword</label><input id="tc-keyword" className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div>
      </div>
      {title.trim() && <Checks label="Title checks" checks={checkTitle(title, keyword)} />}
      <Preview title={title} />
      <OutlierTitles keyword={keyword} />
      <AiTitles title={title} keyword={keyword} />
    </div>
  );
}
