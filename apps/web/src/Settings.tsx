export function Settings() {
  return (
    <section className="screen">
      <div><h1>Settings</h1></div>
      <div className="grid g-2">
        <div className="card"><h2>Channels</h2><p className="small muted">Connect, check, reconnect or remove channels; export or delete your data.</p><a className="btn" href="/account">Manage channels</a></div>
        <div className="card"><h2>Plan &amp; usage <span className="later">soon</span></h2><p className="small muted">Your plan, limits and usage counters.</p></div>
        <div className="card"><h2>AI &amp; apps <span className="later">soon</span></h2><p className="small muted">Included AI or your own key, and the MCP server.</p></div>
        <div className="card"><h2>Extension &amp; data <span className="later">soon</span></h2><p className="small muted">Browser extension sign-in and what your browser shared.</p></div>
      </div>
    </section>
  );
}
