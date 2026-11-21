import type { Videos } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import { useApi } from '../useApi';
import { CoverageNote } from '../ui/CoverageNote';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { Value } from '../ui/Value';
import { useRange } from './RangeChips';

export function VideosTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const r = useApi<Videos>(`/api/channels/${props.channel.id}/videos?range=${range}`);
  if (r.state === 'loading') return <p className="empty">Loading…</p>;
  if (r.state === 'error') return <ErrorNote error={r.error} />;
  if (r.data.videos.length === 0) return <><CoverageNote c={r.data.coverage} /><p className="empty">No uploads yet.</p></>;
  return (
    <>
    <CoverageNote c={r.data.coverage} />
    <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table>
        <thead><tr><th>Video</th><th className="num">Views</th><th className="num">Watch time</th><th className="num">Avg view</th><th className="num">Lifetime views</th><th /></tr></thead>
        <tbody>
          {r.data.videos.map((v) => (
            <tr key={v.videoId}>
              <td>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  {v.thumbnailUrl ? <img src={v.thumbnailUrl} alt="" style={{ width: 72, borderRadius: 6, flex: 'none' }} /> : null}
                  <div><div>{v.title}</div><div className="small muted">{v.publishedAt.slice(0, 10)}{v.durationSec !== null ? ` · ${fmt.duration(v.durationSec)}` : ''}</div></div>
                </div>
              </td>
              <td className="num"><Value m={v.views} format={fmt.count} /></td>
              <td className="num"><Value m={v.watchMinutes} format={fmt.hours} /></td>
              <td className="num"><Value m={v.averageViewDuration} format={fmt.duration} /></td>
              <td className="num"><Value m={v.lifetimeViews} format={fmt.count} /></td>
              <td><a className="btn" href={`https://studio.youtube.com/video/${v.videoId}/analytics`} target="_blank" rel="noreferrer">Open in Studio</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
