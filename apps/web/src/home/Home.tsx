import type { Overview, SearchTerms } from '@viewproof/core';
import { Link } from 'react-router';
import type { ChannelInfo } from '../api';
import { AttentionCard, Kpis } from '../channel/Overview';
import { useApi } from '../useApi';
import { Badge } from '../ui/Badge';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { WeeklyBrief } from './WeeklyBrief';

export function HomePage(props: { channel: ChannelInfo }) {
  const id = props.channel.id;
  const ov = useApi<Overview>(`/api/channels/${id}/overview?range=28d`);
  const terms = useApi<SearchTerms>(`/api/channels/${id}/search-terms?range=28d`);
  return (
    <section className="screen">
      <div><h1>Welcome back</h1><p className="sub">{props.channel.title ?? 'Your channel'}, last 28 days, from YouTube Analytics.</p></div>
      {ov.state === 'loading' ? <p className="empty">Loading…</p> : ov.state === 'error' ? <ErrorNote error={ov.error} /> : <Kpis data={ov.data} />}
      <div className="grid g-2">
        <div className="card">
          <h2>Search terms bringing you viewers <Badge kind="real" /><Link className="more" to="/channel/search-terms">All →</Link></h2>
          {terms.state === 'loading' ? <p className="empty">Loading…</p> : null}
          {terms.state === 'error' ? <ErrorNote error={terms.error} /> : null}
          {terms.state === 'ok' && terms.data.terms.length === 0 ? <p className="empty">{terms.data.note}</p> : null}
          {terms.state === 'ok' && terms.data.terms.length > 0 ? (
            <table><thead><tr><th>Term</th><th className="num">Views 28d</th></tr></thead>
              <tbody>{terms.data.terms.slice(0, 5).map((t) => <tr key={t.term}><td>{t.term}</td><td className="num">{fmt.count(t.views)}</td></tr>)}</tbody></table>
          ) : null}
        </div>
        <AttentionCard channel={props.channel} dataThrough={ov.state === 'ok' ? ov.data.dataThrough : null} />
      </div>
      <WeeklyBrief />
    </section>
  );
}
