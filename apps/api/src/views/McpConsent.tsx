import { Layout } from './Layout';

/** Hidden fields that carry the app's request through the consent form unchanged. */
export interface ConsentRequest { client_id: string; redirect_uri: string; code_challenge: string; state: string }

/** "Allow <app> to read your ViewProof data?" The app's name is what it says it is, so the page says where it sends you. */
export function McpConsent(props: { appName: string; redirectHost: string; req: ConsentRequest }) {
  const hidden = Object.entries(props.req).map(([k, v]) => <input type="hidden" name={k} value={v} />);
  return (
    <Layout title="Connect an AI app" signedIn>
      <div class="card">
        <h1>Allow “{props.appName}” to read your ViewProof data?</h1>
        <p class="muted small">This app calls itself “{props.appName}”. After you choose, you go back to <b>{props.redirectHost}</b>. Only allow it if you just started connecting ViewProof there.</p>
        <p>It can <b>read</b> what you see in ViewProof: your channels' numbers, videos and search terms, your tracked competitors, outliers and keyword facts. It cannot change anything in ViewProof or on YouTube.</p>
        <p class="muted small">Its questions count toward your daily MCP limit. You can disconnect it at any time in ViewProof under Connect AI.</p>
        <div class="row">
          <form method="post" action="/oauth/authorize">{hidden}<input type="hidden" name="decision" value="deny" /><button class="btn" type="submit">Cancel</button></form>
          <form method="post" action="/oauth/authorize">{hidden}<input type="hidden" name="decision" value="allow" /><button class="btn pri" type="submit">Allow</button></form>
        </div>
      </div>
    </Layout>
  );
}
