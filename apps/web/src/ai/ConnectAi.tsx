import { useEffect, useState } from 'react';
import { getJson, isApiError, sendJson } from '../api';
import { CopyButton } from './QuickActions';

interface TokenInfo { id: string; label: string; createdAt: string; lastUsedAt: string | null; connectedApp: boolean }
interface TokenList { endpoint: string; tokens: TokenInfo[]; usage: { used: number; limit: number | null } }
type Loaded = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: TokenList };

const NAME = 'ViewProof';
const DESCRIPTION = 'Your real YouTube channel numbers, read-only';

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

function List(props: { label: string; rows: TokenInfo[]; empty: string; action: string; onRemove: (id: string) => void }) {
  if (props.rows.length === 0) return <p className="small muted">{props.empty}</p>;
  return (
    <table className="tbl" aria-label={props.label}>
      <thead><tr><th>Name</th><th>Added</th><th>Last used</th><th /></tr></thead>
      <tbody>
        {props.rows.map((t) => (
          <tr key={t.id}><td>{t.label}</td><td>{day(t.createdAt)}</td><td>{t.lastUsedAt ? day(t.lastUsedAt) : 'Never'}</td><td><button type="button" className="btn" onClick={() => props.onRemove(t.id)}>{props.action}</button></td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** Connect AI: use ViewProof's read-only data from ChatGPT, Claude and other AI apps (MCP), by signing in or with a token. */
export function ConnectAi() {
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
  const remove = async (id: string) => {
    const r = await sendJson('DELETE', `/api/mcp/tokens/${id}`);
    if (isApiError(r)) return setError(r.message);
    await load();
  };

  return (
    <section className="screen">
      <div><h1>Connect AI</h1><p className="muted">Use your real ViewProof numbers in ChatGPT, Claude and other AI apps. Your AI app does the writing; ViewProof gives it the data, read-only.</p></div>
      {v.state === 'loading' && <p className="small muted">Loading…</p>}
      {v.state === 'error' && <p className="err-text small">{v.message}</p>}
      {v.state === 'ok' && (
        <>
          <div className="card stack">
            <h2>ChatGPT, Claude and other chat apps</h2>
            <ol className="stack-s">
              <li>In your AI app, add a custom MCP server. In ChatGPT: Plugins → Add → <strong>Add custom MCP server</strong>. In Claude: Settings → Connectors → <strong>Add custom connector</strong>.</li>
              <li>Fill in the form:
                <div className="stack-s">
                  <span className="row small">Name: <code>{NAME}</code><CopyButton text={NAME} /></span>
                  <span className="row small">Description: <code>{DESCRIPTION}</code><CopyButton text={DESCRIPTION} /></span>
                  <span className="row small">Server URL: <code>{v.data.endpoint}</code><CopyButton text={v.data.endpoint} /></span>
                  <span className="row small">Authentication: OAuth (leave the advanced settings as they are)</span>
                  <span className="row small">Icon (optional): <a className="btn" href="/app/connector-icon.png" download="viewproof-icon.png">Download icon</a></span>
                </div>
              </li>
              <li>Click Create or Connect, sign in to ViewProof and click <strong>Allow</strong>.</li>
            </ol>
            <p className="small muted">The app can only read: your channels' numbers, videos and search terms, competitors, outliers and keyword facts. It can't change anything in ViewProof or on YouTube.</p>
            <h3>Connected apps</h3>
            <List label="Connected apps" rows={v.data.tokens.filter((t) => t.connectedApp)} empty="No apps connected yet." action="Disconnect" onRemove={(id) => void remove(id)} />
            <Usage u={v.data.usage} />
          </div>

          <div className="card stack">
            <h2>Developer tools (Claude Code, Cursor, VS Code)</h2>
            <p className="small muted">These apps can also use a token instead of signing in. Create one, then paste the command or config.</p>
            {created && <NewToken token={created} endpoint={v.data.endpoint} />}
            <div className="row">
              <div className="field"><label htmlFor="mcp-label">Name (e.g. the app you use it in)</label><input id="mcp-label" className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} /></div>
              <div><button type="button" className="btn" disabled={busy} onClick={() => void create()}>Create token</button></div>
            </div>
            {error && <p className="err-text small">{error}</p>}
            <List label="MCP tokens" rows={v.data.tokens.filter((t) => !t.connectedApp)} empty="No tokens yet." action="Revoke" onRemove={(id) => void remove(id)} />
          </div>
        </>
      )}
    </section>
  );
}
