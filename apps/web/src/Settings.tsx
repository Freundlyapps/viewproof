import { Link, useParams } from 'react-router';
import { ExtensionData } from './settings/ExtensionData';

export function Settings() {
  const rest = useParams()['*'] ?? '';
  if (rest === 'extension') return <ExtensionData />;
  return (
    <section className="screen">
      <div><h1>Settings</h1></div>
      <div className="grid g-2">
        <div className="card"><h2>Channels</h2><p className="small muted">Connect, check, reconnect or remove channels; export or delete your data.</p><a className="btn" href="/account">Manage channels</a></div>
        <div className="card"><h2>Plan &amp; usage <span className="later">soon</span></h2><p className="small muted">Your plan, limits and usage counters.</p></div>
        <div className="card"><h2>AI &amp; apps <span className="later">soon</span></h2><p className="small muted">Included AI or your own key, and the MCP server.</p></div>
        <div className="card"><h2>Extension &amp; data</h2><p className="small muted">Link this browser to the data pool and see what it shared.</p><Link className="btn" to="/settings/extension">Extension &amp; data</Link></div>
      </div>
    </section>
  );
}
