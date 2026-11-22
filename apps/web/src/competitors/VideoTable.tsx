import type { CompetitorVideo, Measured } from '@viewproof/core';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { ago } from './format';

export type SortKey = 'new' | 'views' | 'vph' | 'outlier';
const num = (m: Measured<number>) => (m.kind === 'value' ? m.value : -Infinity);

export function sortVideos<T extends CompetitorVideo>(list: T[], by: SortKey): T[] {
  const out = [...list];
  if (by === 'new') return out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return out.sort((a, b) => num(b[by]) - num(a[by]));
}

/** ×N, amber (spec §15); "No data: reason" otherwise. */
export function Outlier(props: { m: Measured<number> }) {
  const { m } = props;
  if (m.kind === 'no_data') return <span className="nodata">No data: {m.reason}</span>;
  return <span className="badge b-est" title={`Source: ${m.formula}`}>×{m.value}</span>;
}

export function SortChips(props: { by: SortKey; set: (k: SortKey) => void }) {
  const opts: [SortKey, string][] = [['new', 'Newest'], ['views', 'Views'], ['vph', 'VPH'], ['outlier', '×N']];
  return (
    <div className="row" style={{ gap: 6 }}>
      {opts.map(([k, label]) => <button key={k} type="button" className={`chip${props.by === k ? ' on' : ''}`} aria-pressed={props.by === k} onClick={() => props.set(k)}>{label}</button>)}
    </div>
  );
}

/** Uploads with views (public feed), views per hour and ×N. `channel` adds a channel column; `onHistory` a views-over-time button. */
export function VideoTable(props: { label: string; videos: (CompetitorVideo & { channelTitle?: string })[]; channel?: boolean; onHistory?: (v: CompetitorVideo) => void }) {
  const count = (n: number) => fmt.count(n);
  return (
    <table aria-label={props.label}>
      <thead><tr><th>Video</th>{props.channel ? <th>Channel</th> : null}<th>Uploaded</th><th className="num">Views</th><th className="num">Views / hour</th><th>×N</th>{props.onHistory ? <th /> : null}</tr></thead>
      <tbody>
        {props.videos.map((v) => (
          <tr key={v.videoId}>
            <td><div className="row" style={{ gap: 8 }}>
              <img src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" width={96} height={54} loading="lazy" />
              <a href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noreferrer">{v.title}</a>
              {v.format === 'short' ? <span className="small muted">Short</span> : null}
            </div></td>
            {props.channel ? <td>{v.channelTitle}</td> : null}
            <td title={new Date(v.publishedAt).toLocaleString()}>{ago(v.publishedAt)}</td>
            <td className="num"><Value m={v.views} format={count} /></td>
            <td className="num"><Value m={v.vph} format={count} /></td>
            <td><Outlier m={v.outlier} /></td>
            {props.onHistory ? <td><button type="button" className="btn" aria-label={`Views over time: ${v.title}`} onClick={() => props.onHistory!(v)}>Views over time</button></td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
