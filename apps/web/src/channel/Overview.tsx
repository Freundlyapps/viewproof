import { type Overview as OverviewData, type UploadTimes, type Videos, needsAttention } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import { useApi } from '../useApi';
import { Badge } from '../ui/Badge';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { Attention } from './Attention';
import { BestTime } from './BestTime';
import { DailyChart } from './DailyChart';
import { Kpi } from './Kpi';
import { useRange } from './RangeChips';

export function Kpis(props: { data: OverviewData }) {
  const { totals, range } = props.data;
  return (
    <div className="grid g-kpi">
      <Kpi id="kpi-views" label="Views" pair={totals.views} range={range} format={fmt.count} />
      <Kpi id="kpi-watch" label="Watch time" pair={totals.watchMinutes} range={range} format={fmt.hours} />
      <Kpi id="kpi-avg" label="Average view duration" pair={totals.averageViewDuration} range={range} format={fmt.duration} />
      <Kpi id="kpi-subs" label="Subscribers gained" pair={totals.subscribersGained} range={range} format={fmt.count} />
      <Kpi id="kpi-lost" label="Subscribers lost" pair={totals.subscribersLost} range={range} format={fmt.count} />
    </div>
  );
}

export function AttentionCard(props: { channel: ChannelInfo; dataThrough: string | null }) {
  const vids = useApi<Videos>(`/api/channels/${props.channel.id}/videos`);
  const lastUploadAt = vids.state === 'ok' ? vids.data.videos[0]?.publishedAt ?? null : null;
  return (
    <div className="card">
      <h2>Needs attention</h2>
      {vids.state === 'loading' ? <p className="empty">Loading…</p> : null}
      {vids.state === 'error' ? <ErrorNote error={vids.error} /> : null}
      {vids.state === 'ok' ? (
        <Attention items={needsAttention({
          status: props.channel.status, statusReason: props.channel.statusReason, lastUploadAt,
          todayIso: new Date().toISOString().slice(0, 10), dataThrough: props.dataThrough,
          revenue: props.channel.revenueAccess ? 'granted' : 'not_granted',
        })} />
      ) : null}
    </div>
  );
}

export function OverviewTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const ov = useApi<OverviewData>(`/api/channels/${props.channel.id}/overview?range=${range}`);
  const times = useApi<UploadTimes>(`/api/channels/${props.channel.id}/upload-times`);
  if (ov.state === 'loading') return <p className="empty">Loading…</p>;
  if (ov.state === 'error') return <ErrorNote error={ov.error} />;
  return (
    <>
      <Kpis data={ov.data} />
      <div className="card"><h2>Views per day <Badge kind="real" /></h2><DailyChart daily={ov.data.daily} dataThrough={ov.data.dataThrough} /></div>
      <div className="grid g-2">
        <div className="card">
          <h2>When you post <Badge kind="real">your uploads</Badge></h2>
          {times.state === 'loading' ? <p className="empty">Loading…</p> : null}
          {times.state === 'error' ? <ErrorNote error={times.error} /> : null}
          {times.state === 'ok' ? <BestTime youtubeChannelId={props.channel.channelId} data={times.data} /> : null}
        </div>
        <AttentionCard channel={props.channel} dataThrough={ov.data.dataThrough} />
      </div>
    </>
  );
}
