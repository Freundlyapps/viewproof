import { Link } from 'react-router';
import type { ChannelInfo } from '../api';
import { TitleChecker } from './TitleChecker';
import { VideoOptimizer } from './VideoOptimizer';

/** Optimize video (spec §8 item 9a, §15): rule-based checks, real search terms, copy into YouTube Studio. */
export function Optimize(props: { channel: ChannelInfo | null }) {
  return (
    <section className="screen">
      <div><h1>Optimize video</h1><p className="muted">Checks use fixed rules you can read; nothing is written to YouTube.</p></div>
      <TitleChecker />
      {props.channel
        ? <VideoOptimizer channel={props.channel} />
        : <div className="card"><h2>Your videos</h2><p className="muted">Connect your channel to check your videos against their real search terms. <Link to="/settings">Settings</Link></p></div>}
    </section>
  );
}
