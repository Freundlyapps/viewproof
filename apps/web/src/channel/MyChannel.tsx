import { NavLink, useParams, useSearchParams } from 'react-router';
import type { ChannelInfo } from '../api';
import { AudienceTab } from './AudienceTab';
import { CheckupTab } from './CheckupTab';
import { EarningsTab } from './EarningsTab';
import { OverviewTab } from './Overview';
import { RangeChips } from './RangeChips';
import { SearchTermsTab } from './SearchTermsTab';
import { ThumbnailsTab } from './ThumbnailsTab';
import { TrafficTab } from './TrafficTab';
import { VideosTab } from './VideosTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'videos', label: 'Videos' },
  { id: 'checkup', label: 'Video check-up' },
  { id: 'thumbnails', label: 'Thumbnails' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'audience', label: 'Audience' },
  { id: 'search-terms', label: 'Search terms' },
  { id: 'earnings', label: 'Earnings' },
] as const;

export function MyChannel(props: { channel: ChannelInfo }) {
  const { tab = 'overview' } = useParams();
  const [params] = useSearchParams();
  const q = params.toString() ? `?${params}` : '';
  return (
    <section className="screen">
      <div className="row between">
        <div><h1>My channel</h1><p className="sub">From YouTube Analytics, view-only access.</p></div>
        <RangeChips />
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/channel/${t.id}${q}`} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' on' : ''}`}>{t.label}</NavLink>
        ))}
      </div>
      {tab === 'videos' ? <VideosTab channel={props.channel} />
        : tab === 'checkup' ? <CheckupTab channel={props.channel} />
        : tab === 'thumbnails' ? <ThumbnailsTab channel={props.channel} />
        : tab === 'traffic' ? <TrafficTab channel={props.channel} />
        : tab === 'audience' ? <AudienceTab channel={props.channel} />
        : tab === 'search-terms' ? <SearchTermsTab channel={props.channel} />
        : tab === 'earnings' ? <EarningsTab channel={props.channel} />
        : <OverviewTab channel={props.channel} />}
    </section>
  );
}
