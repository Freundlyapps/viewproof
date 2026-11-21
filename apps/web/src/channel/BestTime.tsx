import { type UploadTimes, uploadGrid } from '@viewproof/core';
import { fmt, weekdayTime } from '../ui/format';

/**
 * "When you post": counts of the creator's own uploads per weekday × 4 h, plus each upload's first-week views.
 * YouTube's API has no "when your viewers are online" data, so we link to Studio's chart instead of guessing.
 */
export function BestTime(props: { youtubeChannelId: string; data: UploadTimes }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const grid = uploadGrid(props.data.uploads, tz);
  const max = Math.max(1, ...grid.counts.flat());
  const sorted = [...props.data.uploads].sort((a, b) =>
    (b.firstWeekViews.kind === 'value' ? b.firstWeekViews.value : -1) - (a.firstWeekViews.kind === 'value' ? a.firstWeekViews.value : -1));
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `40px repeat(${grid.blocks.length},1fr)`, gap: 3, fontSize: '.75rem' }} aria-label="Your uploads by weekday and time">
        <span />
        {grid.blocks.map((b) => <span key={b} className="muted" style={{ textAlign: 'center' }}>{b}</span>)}
        {grid.days.map((d, di) => [
          <span key={d} className="muted">{d}</span>,
          ...grid.counts[di]!.map((n, bi) => (
            <span key={`${d}${bi}`} title={`${n} upload${n === 1 ? '' : 's'}`} style={{ height: 18, borderRadius: 3, background: n ? `color-mix(in srgb,var(--accent) ${Math.round((n / max) * 100)}%,var(--surface-2))` : 'var(--surface-2)' }} />
          )),
        ])}
      </div>
      <p className="small muted" style={{ margin: '10px 0' }}>
        Shaded by how many of your last {props.data.uploads.length} uploads (10+ days old) you posted then, in your time zone. YouTube's API doesn't share when your viewers are online. YouTube Studio shows it:{' '}
        <a href={`https://studio.youtube.com/channel/${props.youtubeChannelId}/analytics/tab-audience/period-default`} target="_blank" rel="noreferrer">Open the audience chart in YouTube Studio</a>
      </p>
      {sorted.length === 0 ? <p className="empty">No uploads older than 10 days yet.</p> : null}
      {sorted.slice(0, 5).map((u) => (
        <div className="small" data-testid="upload-time" key={u.videoId} style={{ padding: '4px 0' }}>
          <b>{u.title}</b> · {weekdayTime(u.publishedAt)} · {u.firstWeekViews.kind === 'value' ? `${fmt.count(u.firstWeekViews.value)} first-week views` : <span className="nodata">{u.firstWeekViews.reason}</span>}
        </div>
      ))}
    </div>
  );
}
