import { useEffect, useState } from 'react';
import { getJson, isApiError, sendJson } from '../api';
import { CopyButton } from '../ai/QuickActions';

interface TokenInfo { id: string; label: string; createdAt: string; lastUsedAt: string | null }
interface TokenList { endpoint: string; tokens: TokenInfo[]; usage: { used: number; limit: number | null } }
type Loaded = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: TokenList };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function Usage(props: { u: TokenList['usage'] }) {
  if (props.u.limit === null) return <p className="small">Tool calls today: {props.u.used} (no limit)</p>;
  const pct = props.u.limit ? Math.min(100, (props.u.used / props.u.limit) * 100) : 100;
  return (
    <div className="stack-s">
      <p className="small">Tool calls today: {props.u.used} / {props.u.limit}</p>
      <div className={`meter${pct >= 80 ? ' warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function NewToken(props: { token: string; endpoint: string }) {
  const cli = `claude mcp add --transport http viewproof ${props.endpoint} --header "Authorization: Bearer ${props.token}"`;
  const json = JSON.stringify({ mcpServers: { viewproof: { type: 'http', url: props.endpoint, headers: { Authorization: `Bearer ${props.token}` } } } }, null, 2);
  return (
    <div className="callout stack-s">
      <p><strong>Copy this token now; it won't be shown again.</strong></p>
      <div className="row"><code className="wrap">{props.token}</code><CopyButton text={props.token} /></div>
      <p className="small">Claude Code:</p>
      <div className="row"><code className="wrap">{cli}</code><CopyButton text={cli} /></div>
      <p className="small">JSON config (Cursor, VS Code and others):</p>
      <div className="row"><pre className="wrap" data-testid="mcp-json">{json}</pre><CopyButton text={json} /></div>
    </div>
  );
}

/** Settings → MCP server: bearer tokens for using ViewProof's read-only research tools from an AI app (plan 6c). */
export function McpSettings() {
  const [v, setV] = useState<Loaded>({ state: 'loading' });
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const load = async () => {
    const r = await getJson<TokenList>('/api/mcp/tokens');
    setV(isApiError(r) ? { state: 'error', message: r.message } : { state: 'ok', data: r });
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    const r = await sendJson<{ token: string }>('POST', '/api/mcp/tokens', { label: label.trim() });
    setBusy(false);
    if (r === null || isApiError(r)) return setError(r?.message ?? 'Something went wrong.');
    setCreated(r.token);
    setLabel('');
    await load();
  };
  const revoke = async (id: string) => {
    const r = await sendJson('DELETE', `/api/mcp/tokens/${id}`);
    if (isApiError(r)) return setError(r.message);
    await load();
  };

  return (
    <div className="card stack">
      <h2>MCP server</h2>
      <p className="small muted">Use ViewProof's research data (read-only) from AI apps that support MCP, such as Claude Code, Cursor or VS Code. Your AI app does the writing; ViewProof gives it your real numbers.</p>
      {v.state === 'loading' && <p className="small muted">Loading…</p>}
      {v.state === 'error' && <p className="err-text small">{v.message}</p>}
      {v.state === 'ok' && (
        <>
          <div className="row"><span className="small">Server address: <code>{v.data.endpoint}</code></span><CopyButton text={v.data.endpoint} /></div>
          <Usage u={v.data.usage} />
          {created && <NewToken token={created} endpoint={v.data.endpoint} />}
          <div className="row">
            <div className="field"><label htmlFor="mcp-label">Name (e.g. the app you use it in)</label><input id="mcp-label" className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} /></div>
            <div><button type="button" className="btn" disabled={busy} onClick={() => void create()}>Create token</button></div>
          </div>
          {error && <p className="err-text small">{error}</p>}
          {v.data.tokens.length === 0 ? <p className="small muted">No tokens yet.</p> : (
            <table className="tbl" aria-label="MCP tokens">
              <thead><tr><th>Name</th><th>Created</th><th>Last used</th><th /></tr></thead>
              <tbody>
                {v.data.tokens.map((t) => (
                  <tr key={t.id}><td>{t.label}</td><td>{day(t.createdAt)}</td><td>{t.lastUsedAt ? day(t.lastUsedAt) : 'Never'}</td><td><button type="button" className="btn" onClick={() => void revoke(t.id)}>Revoke</button></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
