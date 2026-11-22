import { NavLink, useParams } from 'react-router';
import type { ChannelInfo } from '../api';
import { KeywordPage } from './KeywordReport';
import { OutliersPage } from './Outliers';

/** Research (spec §15): Keywords and Outliers. */
export function Research(props: { channel: ChannelInfo | null }) {
  const { tab = 'keywords' } = useParams();
  return (
    <section className="screen">
      <div><h1>Research</h1><p className="sub">Every number says where it comes from.</p></div>
      <div className="tabs" role="tablist">
        <NavLink to="/research/keywords" role="tab" aria-selected={tab === 'keywords'} className={`tab${tab === 'keywords' ? ' on' : ''}`}>Keywords</NavLink>
        <NavLink to="/research/outliers" role="tab" aria-selected={tab === 'outliers'} className={`tab${tab === 'outliers' ? ' on' : ''}`}>Outliers</NavLink>
      </div>
      {tab === 'outliers' ? <OutliersPage /> : <KeywordPage channel={props.channel} />}
    </section>
  );
}
