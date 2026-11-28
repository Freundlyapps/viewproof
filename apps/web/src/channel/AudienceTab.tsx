import type { Audience } from '@viewproof/core';
import type { ChannelInfo } from '../api';
import { useApi } from '../useApi';
import { BarList } from '../ui/BarList';
import { Badge } from '../ui/Badge';
import { CoverageNote } from '../ui/CoverageNote';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';
import { useRange } from './RangeChips';

/** Who watches: countries, devices, age and gender. */
export function AudienceTab(props: { channel: ChannelInfo }) {
  const [range] = useRange();
  const r = useApi<Audience>(`/api/channels/${props.channel.id}/audience?range=${range}`);
  if (r.state === 'loading') return <p className="empty">Loading…</p>;
  if (r.state === 'error') return <ErrorNote error={r.error} />;
  const a = r.data;
  return (
    <>
      <CoverageNote c={a.coverage} />
      <div className="grid g-2">
        <div className="card">
          <h2>Countries <Badge kind="real" /></h2>
          <p className="small muted" style={{ marginTop: -6 }}>Your top 10 countries by views.</p>
          {a.countriesNote ? <p className="empty">{a.countriesNote}</p> : <BarList testId="country-bars" items={a.countries.map((c) => ({ key: c.key, label: c.label, value: c.views, right: `${fmt.count(c.views)} views` }))} />}
        </div>
        <div className="card">
          <h2>Devices <Badge kind="real" /></h2>
          <p className="small muted" style={{ marginTop: -6 }}>What people watch on. Mostly phones? Make text and faces big enough for a small screen.</p>
          {a.devicesNote ? <p className="empty">{a.devicesNote}</p> : <BarList testId="device-bars" items={a.devices.map((d) => ({ key: d.key, label: d.label, value: d.views, right: `${fmt.count(d.views)} views` }))} />}
        </div>
      </div>
      <div className="card">
        <h2>Age and gender <Badge kind="real">signed-in viewers</Badge></h2>
        <p className="small muted" style={{ marginTop: -6 }}>YouTube's percentage of your signed-in viewers in each group.</p>
        {a.ageGenderNote ? <p className="empty">{a.ageGenderNote}</p> : (
          <table>
            <thead><tr><th>Age</th><th className="num">Female</th><th className="num">Male</th><th className="num">Other</th></tr></thead>
            <tbody>{a.ageGender.map((g) => (
              <tr key={g.ageGroup}><td>{g.ageGroup}</td><td className="num">{fmt.pct100(g.female)}</td><td className="num">{fmt.pct100(g.male)}</td><td className="num">{fmt.pct100(g.other)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="hint small muted">YouTube doesn't give these to any app, so ViewProof can't show them: {a.notAvailable.join(', ')}. You can see them in YouTube Studio.</div>
    </>
  );
}
