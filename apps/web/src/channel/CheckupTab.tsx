import type { CheckupPart, Measured, VideoCheckup, Videos } from '@viewproof/core';
import { useSearchParams } from 'react-router';
import type { ChannelInfo } from '../api';
import { useApi } from '../useApi';
import { BarList } from '../ui/BarList';
import { Badge } from '../ui/Badge';
import { CtrDays } from '../ui/CtrDays';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { RetentionChart } from './RetentionChart';
import { useRange } from './RangeChips';

const FORMAT: Record<CheckupPart['values'][number]['unit'], (n: number) => string> = {
  count: fmt.count, fraction: fmt.pct, percent: fmt.pct100, seconds: fmt.duration, score: (n) => n.toFixed(2),
};

/** One video's YouTube numbers in six parts, with the channel's beside them where YouTube gives the same measure. */
export function CheckupTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const [params, setParams] = useSearchParams();
  const vids = useApi<Videos>(`/api/channels/${props.channel.id}/videos?range=${range}`);
  const list = vids.state === 'ok' ? vids.data.videos : [];
  const videoId = params.get('video') ?? list[0]?.videoId ?? null;
  const r = useApi<VideoCheckup>(videoId ? `/api/channels/${props.channel.id}/checkup/${videoId}?range=${range}` : null);
  const pick = (id: string) => setParams((p) => { p.set('video', id); return p; });

  return (
    <>
      <div className="card">
        <div className="row between">
          <div><h2 style={{ marginBottom: 4 }}>Video check-up</h2><p className="small muted" style={{ margin: 0 }}>Everything YouTube tells about one video, on one page, with what to look for.</p></div>
          {vids.state === 'ok' && list.length ? (
            <select className="select" aria-label="Video" value={videoId ?? ''} onChange={(e) => pick(e.target.value)}>
              {list.map((v) => <option key={v.videoId} value={v.videoId}>{v.title}</option>)}
            </select>
          ) : null}
        </div>
      </div>
      {vids.state === 'error' ? <ErrorNote error={vids.error} /> : null}
      {vids.state === 'ok' && !list.length ? <p className="empty">No uploads yet.</p> : null}
      {videoId && r.state === 'loading' ? <p className="empty">Checking the video…</p> : null}
      {r.state === 'error' ? <ErrorNote error={r.error} /> : null}
      {r.state === 'ok' ? <Report c={r.data} /> : null}
    </>
  );
}

function Num(props: { m: Measured<number>; unit: CheckupPart['values'][number]['unit'] }) {
  return <Value m={props.m} format={FORMAT[props.unit]} />;
}

function Report(props: { c: VideoCheckup }) {
  const { c } = props;
  return (
    <>
      <div className="card">
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          {c.video.thumbnailUrl ? <img src={c.video.thumbnailUrl} alt="" style={{ width: 160, borderRadius: 8, flex: 'none' }} /> : null}
          <div>
            <h2 style={{ marginBottom: 4 }}>{c.video.title}</h2>
            <div className="small muted" data-testid="checkup-summary">Published {c.video.publishedAt.slice(0, 10)}{c.video.durationSec !== null ? ` · ${fmt.duration(c.video.durationSec)}` : ''} · <Value m={c.views} format={fmt.count} /> views from {c.period.start} to {c.period.end}</div>
          </div>
        </div>
      </div>
      <div className="grid g-2">
        {c.parts.map((p) => (
          <div className="card" key={p.area} data-testid={`part-${p.area}`}>
            <h2>{p.area} <Badge kind="real" /></h2>
            <table>
              <tbody>{p.values.map((v) => (
                <tr key={v.label} style={{ cursor: 'default' }}>
                  <td>{v.label}</td>
                  <td className="num"><b><Num m={v.video} unit={v.unit} /></b>{v.channel ? <div className="small muted">Channel: <Num m={v.channel} unit={v.unit} /></div> : null}</td>
                </tr>
              ))}</tbody>
            </table>
            {p.area === 'Thumbnail & title' && c.ctrByDay.length ? <div style={{ marginTop: 10 }}><div className="small muted">Click-through rate per day (hover for the value)</div><CtrDays days={c.ctrByDay} height={48} /></div> : null}
            <p className="small muted" style={{ marginBottom: 0 }}>{p.guide}</p>
          </div>
        ))}
      </div>
      <div className="grid g-2">
        <div className="card">
          <h2>Where viewers stop watching</h2>
          {c.retention && c.retention.curve.length ? <RetentionChart curve={c.retention.curve} durationSec={c.retention.durationSec} /> : <p className="empty">{c.retention?.note ?? 'No retention data for this video.'}</p>}
        </div>
        <div className="card">
          <h2>Where its views come from</h2>
          {c.sources.length ? <BarList items={c.sources.map((s) => ({ key: s.type, label: s.label, value: s.views, right: `${fmt.count(s.views)} views` }))} /> : <p className="empty">YouTube returned no traffic sources for this video in these dates.</p>}
        </div>
      </div>
      <div className="row"><a className="btn" href={`https://studio.youtube.com/video/${c.video.videoId}/analytics`} target="_blank" rel="noreferrer">Open in YouTube Studio</a><span className="small muted">ViewProof shows YouTube's own numbers and doesn't score them; compare videos by switching above.</span></div>
    </>
  );
}
