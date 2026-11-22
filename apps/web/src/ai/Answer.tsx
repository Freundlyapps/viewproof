import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '../ui/Badge';
import type { AiFailure, AiInfo, AiMissing, AiSource, AiUsage } from './types';

const PROV: Record<AiSource['provenance'], string> = { real: 'REAL', public: 'PUBLIC', pool: 'POOL' };

/** A citation chip: clicking highlights that source in the "Data used" list. */
export function Cite(props: { id: string; onPick: (id: string) => void }) {
  return <button type="button" className="chip cite" onClick={() => props.onPick(props.id)}>{props.id}</button>;
}

/** Plain text with [S1] turned into chips; unknown ids stay as text with a warning. Never renders HTML. */
export function CitedText(props: { text: string; known: Set<string>; onPick: (id: string) => void }) {
  const paras = props.text.split(/\n{2,}/);
  return (
    <>
      {paras.map((p, pi) => (
        <p key={pi} className="ai-text">
          {p.split(/(\[S\d{1,2}\])/g).map((part, i) => {
            const m = /^\[(S\d{1,2})\]$/.exec(part);
            if (!m) return <Fragment key={i}>{part}</Fragment>;
            return props.known.has(m[1]!)
              ? <Cite key={i} id={m[1]!} onPick={props.onPick} />
              : <span key={i} className="muted" title="Not one of the sources sent">{part}</span>;
          })}
        </p>
      ))}
    </>
  );
}

/** "Data used": every source with its exact lines, then what wasn't available and why. */
export function DataUsed(props: { sources: AiSource[]; missing: AiMissing[]; highlight: string | null; open?: boolean }) {
  return (
    <details className="data-used" open={props.open ?? !!props.highlight}>
      <summary>Data used ({props.sources.length} {props.sources.length === 1 ? 'source' : 'sources'})</summary>
      <ul className="sources">
        {props.sources.map((s) => (
          <li key={s.id} data-testid={`source-${s.id}`} className={props.highlight === s.id ? 'hl' : ''}>
            <div className="row"><b>{s.id}</b><span>{s.label}</span><span className="muted small">{s.detail}</span>
              {s.provenance === 'real' ? <Badge kind="real" /> : <span className="badge b-est">{PROV[s.provenance]}</span>}</div>
            <ul className="lines small">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </li>
        ))}
      </ul>
      {props.missing.length > 0 && (
        <div className="small"><b>Not available</b>
          <ul className="lines">{props.missing.map((m) => <li key={m.kind}>{m.label}: {m.reason}</li>)}</ul>
        </div>
      )}
    </details>
  );
}

export function sentTo(ai: AiInfo, usage: AiUsage, task: 'quick' | 'coach'): string {
  const u = usage[task];
  const count = ai.via === 'included' && u.limit !== null ? ` · ${u.used} of ${u.limit} this month` : '';
  return `Sent to ${ai.label}, model ${ai.model} · ${ai.via === 'own' ? 'your key' : 'included AI'}${count}`;
}

/** A refusal or failure, with the next step. */
export function Failure(props: { f: AiFailure }): ReactNode {
  const addKey = props.f.error === 'limit' || props.f.error === 'no_ai' || props.f.error === 'key_unreadable' || props.f.error === 'auth';
  return (
    <div className="card err-note" role="alert">
      <p>{props.f.message}</p>
      {addKey && <Link to="/settings/ai">{props.f.error === 'limit' || props.f.error === 'no_ai' ? 'Add your own key' : 'Update your key'}</Link>}
    </div>
  );
}
