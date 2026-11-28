import type { Measured, Videos } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import { Link, useSearchParams } from 'react-router';
import { useApi } from '../useApi';
import { CoverageNote } from '../ui/CoverageNote';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { useRange } from './RangeChips';

/** When every range column is missing for the same reason, say it once. */
function sameReason(...ms: Measured<number>[]): string | null {
  const r = ms[0]!.kind === 'no_data' ? ms[0]!.reason : null;
  return r !== null && ms.every((m) => m.kind === 'no_data' && m.reason === r) ? r : null;
}

/** A compact cell: a missing value shows a dash with its reason on hover, so a wide table stays readable. */
function Opt(props: { m: Measured<number> | undefined; format: (n: number) => string }) {
  const { m } = props;
  if (!m) return <span className="muted">–</span>;
  if (m.kind === 'no_data') return <span className="muted" title={`No data: ${m.reason}`} data-testid="value">–</span>;
  return <Value m={m} format={props.format} />;
}
const withVideo = (p: URLSearchParams, id: string) => { const q = new URLSearchParams(p); q.set('video', id); return q.toString(); };

export function VideosTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const [params] = useSearchParams();
  const r = useApi<Videos>(`/api/channels/${props.channel.id}/videos?range=${range}`);
  if (r.state === 'loading') return <p className="empty">Loading…</p>;
  if (r.state === 'error') return <ErrorNote error={r.error} />;
  if (r.data.videos.length === 0) return <><CoverageNote c={r.data.coverage} /><p className="empty">No uploads yet.</p></>;
  return (
    <>
    <CoverageNote c={r.data.coverage} />
    <p className="small muted" style={{ margin: 0 }}>Impressions are summed over the days ViewProof has (the last 30 at most). CTR is YouTube's click-through rate for each video's latest day; see the Thumbnails tab for every day. A dash means no data: hover it for the reason.</p>
    <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table>
        <thead><tr><th>Video</th><th className="num">Views</th><th className="num">Watch time</th><th className="num">Avg view</th><th className="num" title="Average share of the video watched">Watched</th><th className="num">Subs gained</th><th className="num">Impressions</th><th className="num" title="YouTube's thumbnail click-through rate on the latest day it has">CTR (latest day)</th><th className="num">Lifetime views</th><th /></tr></thead>
        <tbody>
          {r.data.videos.map((v) => (
            <tr key={v.videoId}>
              <td>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" style={{ width: 72, borderRadius: 6, flex: 'none' }} /> : null}
                  <div><div>{v.title}</div><div className="small muted">{v.publishedAt.slice(0, 10)}{v.durationSec !== null ? ` · ${fmt.duration(v.durationSec)}` : ''}</div></div>
                </div>
              </td>
              {sameReason(v.views, v.watchMinutes, v.averageViewDuration)
                ? <td colSpan={3} className="num"><span className="nodata" data-testid="value">No data: {sameReason(v.views, v.watchMinutes, v.averageViewDuration)}</span></td>
                : <>
                  <td className="num"><Value m={v.views} format={fmt.count} /></td>
                  <td className="num"><Value m={v.watchMinutes} format={fmt.hours} /></td>
                  <td className="num"><Value m={v.averageViewDuration} format={fmt.duration} /></td>
                </>}
              <td className="num"><Opt m={v.averageViewPercentage} format={fmt.pct100} /></td>
              <td className="num"><Opt m={v.subscribersGained} format={fmt.count} /></td>
              <td className="num"><Opt m={v.impressions} format={fmt.count} /></td>
              <td className="num"><Opt m={v.latestCtr} format={fmt.pct} /></td>
              <td className="num"><Value m={v.lifetimeViews} format={fmt.count} /></td>
              <td><Link className="btn pri" to={`/channel/checkup?${withVideo(params, v.videoId)}`}>Check-up</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
