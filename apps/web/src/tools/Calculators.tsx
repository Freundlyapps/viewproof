import { avgViewDuration, clock, engagementRate, parseCount, parseDecimal, parseTimestamp, watchTime } from '@viewproof/core';
import { useState } from 'react';

const show = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function Field(props: { id: string; label: string; value: string; set: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} className="input" inputMode="decimal" value={props.value} onChange={(e) => props.set(e.target.value)} />
    </div>
  );
}

/** Result line once every field has something in it; otherwise nothing. */
function Out(props: { filled: boolean; r: { ok: true; text: string } | { ok: false; reason: string } }) {
  if (!props.filled) return null;
  return props.r.ok ? <p className="num"><strong>{props.r.text}</strong></p> : <p className="nodata">{props.r.reason}</p>;
}

/**
 * Calculators on numbers the user types (spec 9b). They never take values from YouTube's API:
 * YouTube's developer policy forbids ViewProof deriving metrics from API data.
 */
export function Calculators() {
  const [er, setEr] = useState({ views: '', likes: '', comments: '' });
  const [wt, setWt] = useState({ views: '', avg: '' });
  const [avd, setAvd] = useState({ views: '', hours: '' });

  const erR = engagementRate({ views: parseCount(er.views), likes: parseCount(er.likes), comments: parseCount(er.comments) });
  const avgSec = parseTimestamp(wt.avg);
  const wtR = avgSec === null ? { ok: false as const, reason: 'Write the average view duration as m:ss.' } : watchTime({ views: parseCount(wt.views), avgSec });
  const hours = parseDecimal(avd.hours);
  const avdR = Number.isNaN(hours) ? { ok: false as const, reason: 'Write the watch time as a plain number, like 1000 or 2.5.' } : avgViewDuration({ views: parseCount(avd.views), hours });

  return (
    <div className="stack">
      <p className="muted small">Your numbers: type them in from YouTube Studio. Nothing is sent anywhere. Counts may use 1.000 or 1,000; hours may use 2,5 or 2.5.</p>
      <div className="card stack-s">
        <h2>Engagement rate</h2>
        <Field id="er-views" label="Views" value={er.views} set={(v) => setEr({ ...er, views: v })} />
        <Field id="er-likes" label="Likes" value={er.likes} set={(v) => setEr({ ...er, likes: v })} />
        <Field id="er-comments" label="Comments" value={er.comments} set={(v) => setEr({ ...er, comments: v })} />
        <Out filled={!!(er.views && er.likes && er.comments)} r={erR.ok ? { ok: true, text: `Engagement rate: ${show(erR.percent)}%` } : erR} />
        <p className="note">(likes + comments) ÷ views × 100.</p>
      </div>
      <div className="card stack-s">
        <h2>Watch time</h2>
        <Field id="wt-views" label="Views" value={wt.views} set={(v) => setWt({ ...wt, views: v })} />
        <Field id="wt-avg" label="Average view duration (m:ss)" value={wt.avg} set={(v) => setWt({ ...wt, avg: v })} />
        <Out filled={!!(wt.views && wt.avg)} r={wtR.ok ? { ok: true, text: `Watch time: ${show(wtR.hours)} hours` } : wtR} />
        <p className="note">views × average view duration.</p>
      </div>
      <div className="card stack-s">
        <h2>Average view duration</h2>
        <Field id="avd-views" label="Views" value={avd.views} set={(v) => setAvd({ ...avd, views: v })} />
        <Field id="avd-hours" label="Watch time (hours)" value={avd.hours} set={(v) => setAvd({ ...avd, hours: v })} />
        <Out filled={!!(avd.views && avd.hours)} r={avdR.ok ? { ok: true, text: `Average view duration: ${clock(avdR.seconds)}` } : avdR} />
        <p className="note">watch time ÷ views.</p>
      </div>
    </div>
  );
}
