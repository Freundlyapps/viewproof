import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { sendJson } from '../api';
import { type AiFailure, type AiStatus, type UsageCount, isFailure, postAi } from '../ai/types';
import { useApi } from '../useApi';

function Meter(props: { label: string; u: UsageCount }) {
  if (props.u.limit === null) return <p className="small">{props.label}: {props.u.used} this month (no limit)</p>;
  const pct = props.u.limit ? Math.min(100, (props.u.used / props.u.limit) * 100) : 100;
  return (
    <div className="stack-s">
      <p className="small">{props.label}: {props.u.used} of {props.u.limit} this month</p>
      <div className={`meter${pct >= 80 ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function KeyForm(props: { status: AiStatus; onSaved: () => void }) {
  const providers = Object.keys(props.status.presets).filter((p) => p !== 'custom' || props.status.customAllowed);
  const [provider, setProvider] = useState(providers[0] ?? 'anthropic');
  const preset = props.status.presets[provider]!;
  const [apiKey, setApiKey] = useState('');
  const [quick, setQuick] = useState(preset.quickModel ?? '');
  const [coach, setCoach] = useState(preset.coachModel ?? '');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiFailure | null>(null);
  useEffect(() => { setQuick(preset.quickModel ?? ''); setCoach(preset.coachModel ?? ''); }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { provider, apiKey: apiKey.trim(), quickModel: quick.trim(), coachModel: coach.trim(), ...(provider === 'custom' ? { baseUrl: baseUrl.trim() } : {}) };
    const r = await postAi<{ ok: true }>('/api/ai/key', body);
    setBusy(false);
    if (isFailure(r)) return setError(r);
    setApiKey('');
    props.onSaved();
  };
  const needModels = !preset.quickModel;
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="field">
        <label htmlFor="ai-provider">Provider</label>
        <select id="ai-provider" className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map((p) => <option key={p} value={p}>{props.status.presets[p]!.label}</option>)}
        </select>
        {preset.note && <p className="small muted">{preset.note}</p>}
      </div>
      {provider === 'custom' && (
        <div className="field">
          <label htmlFor="ai-base">Server address</label>
          <input id="ai-base" className="input" required placeholder="http://localhost:11434/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="ai-key">API key</label>
        <input id="ai-key" className="input" type="password" autoComplete="off" required minLength={8} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </div>
      <div className="grid g-2">
        <div className="field">
          <label htmlFor="ai-quick">Model for quick actions</label>
          <input id="ai-quick" className="input" required={needModels} placeholder="model name from your provider" value={quick} onChange={(e) => setQuick(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ai-coach">Model for Ask AI</label>
          <input id="ai-coach" className="input" required={needModels} placeholder="model name from your provider" value={coach} onChange={(e) => setCoach(e.target.value)} />
        </div>
      </div>
      {error && <p className="err-text" role="alert">{error.message}</p>}
      <div><button className="btn pri" type="submit" disabled={busy}>{busy ? 'Testing your key…' : 'Save and test'}</button></div>
      <p className="note">Your key is stored encrypted and used only for your requests. Remove it at any time.</p>
    </form>
  );
}

/** Settings → AI & apps (plan 6a): included AI, own key (D7), this month's use. */
export function AiSettings() {
  const [version, setVersion] = useState(0);
  const status = useApi<AiStatus>(`/api/ai/status?v=${version}`);
  const refresh = () => setVersion((v) => v + 1);
  if (status.state === 'loading') return <section className="screen"><h1>AI &amp; apps</h1><p className="muted">Loading…</p></section>;
  if (status.state === 'error') return <section className="screen"><h1>AI &amp; apps</h1><p className="err-text">{status.error.message}</p></section>;
  const s = status.data;
  const remove = async () => { await sendJson('DELETE', '/api/ai/key'); refresh(); };
  return (
    <section className="screen">
      <div><p className="small"><Link to="/settings">Settings</Link></p><h1>AI &amp; apps</h1></div>
      <div className="grid g-2">
        <div className="card stack">
          <h2>Included AI</h2>
          {s.included
            ? <p>{s.included.label}: <code>{s.included.quickModel}</code> for quick actions, <code>{s.included.coachModel}</code> for Ask AI.</p>
            : <p className="muted">No AI is included on this server. Add your own key to use AI.</p>}
          {s.own && <p className="small muted">Your own key is in use, so nothing below is counted.</p>}
          <Meter label="Quick actions" u={s.usage.quick} />
          <Meter label="Ask AI" u={s.usage.coach} />
        </div>
        <div className="card stack">
          <h2>Your own key</h2>
          {s.own ? (
            <>
              <p>{s.own.label}, key <code>{s.own.keyHint}</code></p>
              <p className="small muted">Quick actions: <code>{s.own.quickModel}</code> · Ask AI: <code>{s.own.coachModel}</code>{s.own.baseUrl ? ` · ${s.own.baseUrl}` : ''}</p>
              <div><button type="button" className="btn" onClick={() => void remove()}>Remove key</button></div>
            </>
          ) : <KeyForm status={s} onSaved={refresh} />}
        </div>
      </div>
      <div className="card"><h2>MCP server</h2><p className="small muted">Use ViewProof's research tools from Claude, ChatGPT or other AI apps. Coming in the next update.</p></div>
    </section>
  );
}
