import { type Measured, factsSummary, topResultsFacts } from '@viewproof/core';
import { Badge } from '../ui/Badge';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import type { ExtensionAnswer } from './extension';

const DAY_MS = 86_400_000;
const STALE_DAYS = 7;

/** "about 4 years" from days (YouTube's own labels are rounded, so the median is too). */
export function aboutAge(days: number): string {
  if (days < 1) return 'under a day';
  if (days < 60) return `about ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
  if (days < 730) return `about ${Math.round(days / 30)} months`;
  return `about ${Math.round(days / 365)} years`;
}

function Tile(props: { label: string; m: Measured<number>; format: (n: number) => string }) {
  return <div className="card kpi"><div className="l">{props.label}</div><div className="v"><Value m={props.m} format={props.format} /></div></div>;
}

export function TopResults(props: { q: string; ext: ExtensionAnswer | null }) {
  const { q, ext } = props;
  const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const head = <h2>Top results on YouTube <Badge kind="real">REAL · YouTube's page</Badge></h2>;
  if (!ext) return <div className="card">{head}<p className="empty">Asking the extension…</p></div>;
  if (!ext.installed) {
    return <div className="card">{head}<p className="empty">Install the ViewProof extension to read YouTube's top results in your browser.</p></div>;
  }
  const snap = ext.snapshot;
  if (!snap) {
    return (
      <div className="card">{head}
        <p className="empty">Search for "{q}" on YouTube with the extension installed; the facts appear here.</p>
        <a className="btn pri" href={search} target="_blank" rel="noreferrer">Search on YouTube</a>
      </div>
    );
  }
  const f = topResultsFacts(snap.page);
  const ageDays = Math.floor((Date.now() - Date.parse(snap.capturedAt)) / DAY_MS);
  const count = (n: number) => fmt.count(n);
  return (
    <div className="card">
      {head}
      <p className="small muted" style={{ marginTop: -6 }}>Read from YouTube's search page in your browser, {new Date(snap.capturedAt).toLocaleString()}. Only you see this.</p>
      {ageDays >= STALE_DAYS ? <p className="small">Read {ageDays} days ago — <a href={search} target="_blank" rel="noreferrer">search again</a> for fresh facts.</p> : null}
      <div className="grid g-kpi">
        <Tile label="Videos on the first page" m={{ kind: 'value', value: f.videos, formula: "count of videos on YouTube's first results page", inputs: {} }} format={count} />
        <Tile label="Median views" m={f.medianViews} format={count} />
        <Tile label="Median upload age" m={f.medianAgeDays} format={aboutAge} />
        <Tile label="From the last 3 months" m={f.recent} format={count} />
        <Tile label="Under 10k views" m={f.under10kViews} format={count} />
        <Tile label="Different channels" m={{ kind: 'value', value: f.distinctChannels, formula: 'distinct channels among the results', inputs: {} }} format={count} />
      </div>
      {factsSummary(f).length ? <ul>{factsSummary(f).map((s) => <li key={s}>{s}</li>)}</ul> : null}
      <p className="small muted">Channel sizes: {f.channelSizes.kind === 'no_data' ? f.channelSizes.reason : ''}.{f.shortsShelves ? ` YouTube also showed ${f.shortsShelves} Shorts shelves (not counted).` : ''}{snap.page.estimatedResults !== null ? ` YouTube's own estimate: about ${count(snap.page.estimatedResults)} results.` : ''}</p>
      {snap.page.results.length === 0 ? <p className="empty">YouTube showed no videos for this search.</p> : (
        <table aria-label="Top results">
          <thead><tr><th>#</th><th>Video</th><th>Channel</th><th className="num">Views</th><th>Uploaded</th></tr></thead>
          <tbody>
            {snap.page.results.map((r, i) => (
              <tr key={r.videoId}>
                <td>{i + 1}</td>
                <td><div className="row" style={{ gap: 8 }}><img src={`https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`} alt="" width={96} height={54} loading="lazy" /><a href={`https://www.youtube.com/watch?v=${r.videoId}`} target="_blank" rel="noreferrer">{r.title}</a></div></td>
                <td>{r.channelName}</td>
                <td className="num"><Value m={r.views} format={count} /></td>
                <td>{r.live ? 'Live now' : r.ageLabel ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
