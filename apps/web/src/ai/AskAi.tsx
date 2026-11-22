import { useState } from 'react';
import { Badge } from '../ui/Badge';
import { CitedText, DataUsed, Failure, sentTo } from './Answer';
import { QuickActions } from './QuickActions';
import { type AiFailure, type AskResult, isFailure, postAi } from './types';

type Turn = { role: 'user'; content: string } | { role: 'assistant'; content: string; result: AskResult };

function AnswerTurn(props: { r: AskResult }) {
  const [hl, setHl] = useState<string | null>(null);
  const known = new Set(props.r.sources.map((s) => s.id));
  return (
    <div className="turn ai">
      <Badge kind="ai" />
      <CitedText text={props.r.answer} known={known} onPick={setHl} />
      <DataUsed sources={props.r.sources} missing={props.r.missing} highlight={hl} />
      <p className="note">{sentTo(props.r.ai, props.r.usage, 'coach')}</p>
    </div>
  );
}

/** Ask AI (spec §8 item 6): quick actions plus a conversation; every answer lists the data it used. */
export function AskAi(props: { channel: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AiFailure | null>(null);

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setFailure(null);
    const history = [...turns.map((t) => ({ role: t.role, content: t.content })), { role: 'user' as const, content: q }].slice(-19);
    // History must start with the user's message.
    const messages = history[0]?.role === 'assistant' ? history.slice(1) : history;
    const r = await postAi<AskResult>('/api/ai/ask', { messages, ...(props.channel ? { channel: props.channel } : {}) });
    if (isFailure(r)) setFailure(r);
    else {
      setTurns((t) => [...t, { role: 'user', content: q }, { role: 'assistant', content: r.answer, result: r }]);
      setText('');
    }
    setBusy(false);
  };

  return (
    <section className="screen">
      <div><h1>Ask AI</h1><p className="muted">Answers use your real data and say which data they used.</p></div>
      <QuickActions channel={props.channel} />
      <div className="card">
        <h2>Ask about your channel</h2>
        <div className="stack">
          {turns.map((t, i) => (t.role === 'user'
            ? <div key={i} className="turn me"><p className="ai-text">{t.content}</p></div>
            : <AnswerTurn key={i} r={t.result} />))}
          {failure && <Failure f={failure} />}
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <label htmlFor="ai-ask" className="sr-only">Ask about your channel</label>
            <textarea id="ai-ask" className="input" rows={3} maxLength={4000} value={text} placeholder="What should my next video be about, and why?"
              onChange={(e) => setText(e.target.value)} />
            <div><button className="btn pri" type="submit" disabled={busy || !text.trim()}>{busy ? 'Thinking…' : 'Send'}</button></div>
          </form>
        </div>
      </div>
    </section>
  );
}
