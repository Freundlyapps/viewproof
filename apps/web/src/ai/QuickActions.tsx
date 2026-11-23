import { useState } from 'react';
import { Badge } from '../ui/Badge';
import { Cite, DataUsed, Failure, sentTo } from './Answer';
import { type AiFailure, type QuickResult, isFailure, postAi } from './types';

type Action = 'titles' | 'description' | 'tags' | 'ideas';
const ACTIONS: { id: Action; label: string; topicOptional?: boolean }[] = [
  { id: 'titles', label: 'Titles' },
  { id: 'description', label: 'Description' },
  { id: 'tags', label: 'Tags' },
  { id: 'ideas', label: 'Video ideas', topicOptional: true },
];

export function CopyButton(props: { text: string }) {
  const [state, setState] = useState<'no' | 'yes' | 'failed'>('no');
  return (
    <button type="button" className="btn" title={state === 'failed' ? 'Select the text and copy it yourself' : undefined} onClick={async () => {
      try {
        if (!navigator.clipboard) throw new Error('no clipboard');
        await navigator.clipboard.writeText(props.text);
        setState('yes');
        setTimeout(() => setState('no'), 1500);
      } catch {
        setState('failed');
      }
    }}>{state === 'yes' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy'}</button>
  );
}

export function QuickActions(props: { channel: string | null }) {
  const [action, setAction] = useState<Action | null>(null);
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuickResult | AiFailure | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  const current = ACTIONS.find((a) => a.id === action);

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setHl(null);
    const r = await postAi<QuickResult>('/api/ai/quick', { action, topic: topic.trim(), notes: notes.trim(), ...(props.channel ? { channel: props.channel } : {}) });
    setResult(r);
    setBusy(false);
  };

  return (
    <div className="card">
      <h2>Quick actions</h2>
      <div className="row">
        {ACTIONS.map((a) => (
          <button key={a.id} type="button" className={`chip${action === a.id ? ' on' : ''}`} aria-pressed={action === a.id}
            onClick={() => { setAction(a.id); setResult(null); }}>{a.label}</button>
        ))}
      </div>
      {current && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <div className="field">
            <label htmlFor="ai-topic">Topic or keyword{current.topicOptional ? ' (optional)' : ''}</label>
            <input id="ai-topic" className="input" value={topic} maxLength={200} required={!current.topicOptional} onChange={(e) => setTopic(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ai-notes">Notes (optional)</label>
            <input id="ai-notes" className="input" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div><button className="btn pri" type="submit" disabled={busy}>{busy ? 'Writing…' : 'Write'}</button></div>
        </form>
      )}
      {result && isFailure(result) && <Failure f={result} />}
      {result && !isFailure(result) && (
        <div className="stack">
          {action === 'tags' ? (
            <ul className="results" aria-label="Results">
              <li><div className="row"><Badge kind="ai" /><span className="ai-text">{result.items.map((i) => i.text).join(', ')}</span><CopyButton text={result.items.map((i) => i.text).join(', ')} /></div></li>
            </ul>
          ) : (
            <ul className="results" aria-label="Results">
              {result.items.map((it, i) => (
                <li key={i}>
                  <div className="row"><Badge kind="ai" /><span className="ai-text">{it.text}</span><CopyButton text={it.text} /></div>
                  {(it.why || it.sources.length > 0) && (
                    <div className="row small muted">{it.why}{it.sources.map((s) => <Cite key={s} id={s} onPick={setHl} />)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <DataUsed sources={result.sources} missing={result.missing} highlight={hl} />
          <p className="note">{sentTo(result.ai, result.usage, 'quick')}</p>
        </div>
      )}
    </div>
  );
}
