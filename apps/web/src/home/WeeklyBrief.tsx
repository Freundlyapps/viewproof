import { type Measurement, addDays, describeMetric } from '@viewproof/core';
import { useEffect, useState } from 'react';
import { getJson, isApiError } from '../api';
import { Cite, DataUsed, Failure } from '../ai/Answer';
import { type AiFailure, type AiInfo, type AiItem, type AiMissing, type AiSource, type UsageCount, postAi } from '../ai/types';
import { Badge } from '../ui/Badge';
import { ErrorNote } from '../ui/ErrorNote';
import { fmt } from '../ui/format';

/** JSON of GET /api/agent (apps/api/src/agent/routes.ts). */
export interface AgentChange {
  id: string; videoId: string; beforeTitle: string; proposedTitle: string; why: string; sources: string[];
  status: 'proposed' | 'approved' | 'dismissed' | 'applied' | 'expired'; createdAt: string; approvedAt: string | null;
  appliedOn: string | null; appliedTitle: string | null; check7: Measurement | null; check28: Measurement | null;
}
export interface AgentState {
  settings: { weekly: boolean; lastAttemptAt: string | null; lastError: string | null };
  brief: null | { id: string; createdAt: string; trigger: 'weekly' | 'manual'; ai: AiInfo; tokens: { input: number; output: number }; ideas: AiItem[]; sources: AiSource[]; missing: AiMissing[]; dropped: number };
  changes: AgentChange[];
  usage: UsageCount;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** YouTube Analytics lags about 2 days; the API asks then (agent/checks.ts). */
const readyOn = (applied: string, days: number) => addDays(applied, days - 1 + 2);

function Check(props: { m: Measurement | null; applied: string; days: 7 | 28 }) {
  if (!props.m || props.m.state !== 'measured') {
    return <li className="muted">{props.days}-day check: on {day(readyOn(props.applied, props.days))}, once YouTube has the data.</li>;
  }
  return (
    <li>
      <b>{props.days}-day check</b> <Badge kind="real" />
      <ul className="lines small">
        <li>{describeMetric('Views', props.m.views, props.days)}</li>
        <li>{describeMetric('Views from YouTube search', props.m.searchViews, props.days)}</li>
      </ul>
    </li>
  );
}

function ChangeCard(props: { c: AgentChange; known: Set<string>; onPick: (id: string) => void; act: (id: string, action: 'approve' | 'dismiss') => void; busy: boolean }) {
  const c = props.c;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(c.proposedTitle);
      setCopied(true);
    } catch { /* the title stays visible to copy by hand */ }
  };
  const studio = `https://studio.youtube.com/video/${c.videoId}/edit`;
  return (
    <li className="card stack-s" data-testid={`change-${c.id}`}>
      <div className="small muted">Now: “{c.beforeTitle}”</div>
      <div><b>Suggested:</b> “{c.proposedTitle}” <Badge kind="ai" /></div>
      <p className="small">{c.why} {c.sources.filter((s) => props.known.has(s)).map((s) => <Cite key={s} id={s} onPick={props.onPick} />)}</p>
      {c.status === 'proposed' && (
        <div className="row">
          <button type="button" className="btn" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy title'}</button>
          <button type="button" className="btn pri" disabled={props.busy} onClick={() => props.act(c.id, 'approve')}>I'll use it</button>
          <button type="button" className="btn" disabled={props.busy} onClick={() => props.act(c.id, 'dismiss')}>Dismiss</button>
        </div>
      )}
      {c.status === 'approved' && (
        <div className="stack-s small">
          <p>Change the title in YouTube Studio. ViewProof checks once a day and starts measuring from the first day it sees the new title live.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy title'}</button>
            <a className="btn" href={studio} target="_blank" rel="noopener noreferrer">Open in YouTube Studio</a>
            <button type="button" className="btn" disabled={props.busy} onClick={() => props.act(c.id, 'dismiss')}>Dismiss</button>
          </div>
        </div>
      )}
      {c.status === 'applied' && c.appliedOn && (
        <div className="small">
          <p>Live since {day(c.appliedOn)} as “{c.appliedTitle}”. Compared with the same number of days before, from your YouTube Analytics:</p>
          <ul className="lines"><Check m={c.check7} applied={c.appliedOn} days={7} /><Check m={c.check28} applied={c.appliedOn} days={28} /></ul>
        </div>
      )}
      {c.status === 'dismissed' && <p className="small muted">Dismissed.</p>}
    </li>
  );
}

export function WeeklyBrief() {
  const [s, setS] = useState<AgentState | null>(null);
  const [loadErr, setLoadErr] = useState<{ error: string; message: string } | null>(null);
  const [fail, setFail] = useState<AiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [hl, setHl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getJson<AgentState>('/api/agent').then((r) => {
      if (!live) return;
      if (isApiError(r)) setLoadErr(r);
      else setS(r);
    });
    return () => { live = false; };
  }, []);

  const send = async (path: string, body: unknown) => {
    setBusy(true);
    setFail(null);
    const r = await postAi<AgentState>(path, body);
    setBusy(false);
    if ('error' in r && typeof r.error === 'string' && !('settings' in r)) setFail(r as AiFailure);
    else setS(r as AgentState);
  };

  if (loadErr) return <div className="card"><h2>What to make next</h2><ErrorNote error={loadErr as never} /></div>;
  if (!s) return <div className="card"><h2>What to make next</h2><p className="empty">Loading…</p></div>;

  const b = s.brief;
  const known = new Set(b?.sources.map((x) => x.id) ?? []);
  const open = s.changes.filter((c) => c.status !== 'dismissed');
  const left = s.usage.limit === null ? null : Math.max(s.usage.limit - s.usage.used, 0);
  return (
    <div className="card stack" data-testid="weekly-brief">
      <h2>What to make next <Badge kind="ai" /></h2>
      <div className="row small">
        <label><input type="checkbox" checked={s.settings.weekly} disabled={busy} onChange={(e) => void send('/api/agent/settings', { weekly: e.target.checked })} /> Make a brief every week</label>
        <button type="button" className="btn" disabled={busy} onClick={() => void send('/api/agent/brief', {})}>{busy ? 'Working…' : 'Make one now'}</button>
        {s.usage.limit === 0 ? <span className="muted">Included with Pro, or with your own AI key on any plan</span>
          : left !== null && <span className="muted">{left} of {s.usage.limit} left this month</span>}
      </div>
      {s.settings.weekly && s.settings.lastError && <p className="small err-note">The last weekly brief failed: {s.settings.lastError}</p>}
      {fail && <Failure f={fail} />}
      {!b ? (
        <p className="empty">No brief yet. A brief reads your last 28 and 90 days, your search terms, your competitors' uploads and recent outliers, then suggests 5 videos and better titles for videos below your usual. Every number it gives is checked against that data.</p>
      ) : (
        <>
          <ol className="stack-s">
            {b.ideas.map((i, n) => (
              <li key={n}><b>{i.text}</b>
                <p className="small">{i.why} {i.sources.map((x) => <Cite key={x} id={x} onPick={setHl} />)}</p></li>
            ))}
          </ol>
          {b.dropped > 0 && <p className="small muted">{b.dropped} {b.dropped === 1 ? 'suggestion was' : 'suggestions were'} removed because {b.dropped === 1 ? 'it' : 'they'} gave numbers that aren't in your data.</p>}
          <p className="small muted">Made {day(b.createdAt)} by {b.ai.label}, model {b.ai.model} · {b.ai.via === 'own' ? 'your key' : 'included AI'} · {fmt.count(b.tokens.input + b.tokens.output)} tokens</p>
          <DataUsed sources={b.sources} missing={b.missing} highlight={hl} />
        </>
      )}
      {open.length > 0 && (
        <div className="stack-s">
          <h3>Better titles for videos below your usual</h3>
          <p className="small muted">ViewProof never edits your channel. You change the title in YouTube Studio; ViewProof then shows your views before and after, from your own Analytics.</p>
          <ul className="stack-s" style={{ listStyle: "none", padding: 0 }}>{open.map((c) => <ChangeCard key={c.id} c={c} known={known} onPick={setHl} busy={busy} act={(id, action) => void send(`/api/agent/changes/${id}`, { action })} />)}</ul>
        </div>
      )}
    </div>
  );
}
