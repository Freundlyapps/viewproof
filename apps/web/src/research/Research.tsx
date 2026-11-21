import { NavLink, useParams } from 'react-router';
import type { ChannelInfo } from '../api';
import { KeywordPage } from './KeywordReport';

const OUTLIERS = "Videos that beat their channel's usual views in your niche, from the shared data pool (next plan).";

/** Research (spec §15): Keywords now, Outliers later. */
export function Research(props: { channel: ChannelInfo | null }) {
  const { tab = 'keywords' } = useParams();
  return (
    <section className="screen">
      <div><h1>Research</h1><p className="sub">Every number says where it comes from.</p></div>
      <div className="tabs" role="tablist">
        <NavLink to="/research/keywords" role="tab" aria-selected={tab === 'keywords'} className={`tab${tab === 'keywords' ? ' on' : ''}`}>Keywords</NavLink>
        <NavLink to="/research/outliers" role="tab" aria-selected={tab === 'outliers'} className={`tab${tab === 'outliers' ? ' on' : ''}`}>Outliers (soon)</NavLink>
      </div>
      {tab === 'outliers'
        ? <div className="card"><p className="sub">Not built yet</p><p style={{ margin: 0 }}>{OUTLIERS}</p></div>
        : <KeywordPage channel={props.channel} />}
    </section>
  );
}
