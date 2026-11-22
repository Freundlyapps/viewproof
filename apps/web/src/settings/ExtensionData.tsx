import type { PoolBrowser } from '@viewproof/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { isApiError, sendJson } from '../api';
import { ago } from '../competitors/format';
import { extensionInstalled, linkExtension } from '../research/extension';
import { useApi } from '../useApi';

/** A readable default name for this browser, e.g. "Chrome on Windows". */
function browserLabel(): string {
  const ua = navigator.userAgent;
  const name = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${name} on ${os}` : name;
}

/** Settings → Extension & data (plan 5b): link this browser to the data pool, see and unlink linked browsers. */
export function ExtensionData() {
  const [version, setVersion] = useState(0);
  const list = useApi<PoolBrowser[]>(`/api/pool/browsers?v=${version}`);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linkThis = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (!(await extensionInstalled())) return setNote('Install the ViewProof extension in this browser first, then reload this page.');
      const r = await sendJson<{ token: string }>('POST', '/api/pool/tokens', { label: browserLabel() });
      if (isApiError(r) || !r) return setNote(isApiError(r) ? r.message ?? r.error : 'The server did not answer.');
      const ok = await linkExtension(r.token);
      setNote(ok
        ? 'Linked. The extension opened its data-sharing page: agree there to start sharing. Nothing is sent before you do.'
        : 'The extension did not confirm. Reload this page and try again.');
      setVersion((x) => x + 1);
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (id: string) => {
    const r = await sendJson('DELETE', `/api/pool/browsers/${encodeURIComponent(id)}`);
    if (isApiError(r)) setNote(r.message ?? r.error);
    setVersion((x) => x + 1);
  };

  return (
    <section className="screen">
      <Link to="/settings" className="small">← Settings</Link>
      <div><h1>Extension &amp; data</h1><p className="sub">Share public video facts from YouTube pages you open, so Outliers can find videos in your niche. Off unless you agree.</p></div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>What is shared</h2>
        <ul>
          <li>Sent: video and channel ids, title, view count, upload time or age, length, Short or long.</li>
          <li>Never sent: who you are on YouTube, cookies, what you watch for how long, or the words you type into YouTube's search box (the facts of the results you see are sent).</li>
          <li>Stored without your name, by the day or hour only: the server keeps how many items each linked browser sent per day, never which.</li>
          <li>Every item your browser sent is listed on the extension's own data-sharing page, where you can also stop.</li>
        </ul>
        <button type="button" className="btn pri" onClick={() => void linkThis()} disabled={busy}>Link this browser</button>
        {note ? <p role="status" className="small" style={{ marginBottom: 0 }}>{note}</p> : null}
      </div>
      {list.state === 'loading' ? <p className="empty">Loading…</p> : list.state === 'error' ? <p className="empty">{list.error.message}</p> : list.data.length === 0 ? (
        <div className="card"><p className="empty">No browser is linked.</p></div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table aria-label="Linked browsers">
            <thead><tr><th>Browser</th><th>Linked</th><th>Last sent (day)</th><th className="num">Accepted today</th><th className="num">Rejected today</th><th className="num">Accepted in total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}</td>
                  <td>{new Date(b.createdAt).toLocaleDateString()}</td>
                  <td>{b.lastUsedAt ? new Date(b.lastUsedAt).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '—'}</td>
                  <td className="num">{b.acceptedToday}</td>
                  <td className="num">{b.rejectedToday}</td>
                  <td className="num">{b.acceptedTotal}</td>
                  <td>{b.status === 'suspended' ? <span className="nodata">Paused: too much data was rejected</span> : 'Active'}</td>
                  <td><button type="button" className="btn" onClick={() => void unlink(b.id)}>Unlink</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
