import type { ChannelRow, UserRow } from '@viewproof/db';
import { Layout } from './Layout';

const STATUS = {
  active: { label: 'Active', cls: 'badge ok' },
  reconnect: { label: 'Reconnect needed', cls: 'badge warn' },
  gone: { label: 'No longer exists', cls: 'badge warn' },
} as const;

/** Brand-channel logins get an internal Google address (…@pages.plusgoogle.com); show the name instead. */
function who(user: UserRow): string {
  const brand = user.email?.endsWith('@pages.plusgoogle.com') ?? false;
  if (user.email && !brand) return user.email;
  return user.name ? `Signed in as ${user.name}` : 'Signed in with Google';
}

export function Account(props: { user: UserRow; channels: ChannelRow[]; max: number; selfHosted: boolean; byHand?: boolean; connected?: string }) {
  const { user, channels, max } = props;
  const usage = props.selfHosted ? 'Self-hosted · no limits' : `${user.plan === 'pro' ? 'Pro' : 'Free'} plan · ${channels.length} of ${max} channel${max === 1 ? '' : 's'}`;
  return (
    <Layout title="Your account" signedIn>
      <div class="card">
        <h1>Your account</h1>
        <p class="muted small">{who(user)} · {usage}</p>
        {props.connected ? <div class="note">Connected ✓ You can check or remove it here any time.</div> : null}
        {props.byHand ? <div class="note">Channel removed. Its stored Google access couldn't be read, so please remove ViewProof by hand at myaccount.google.com/connections.</div> : null}

        {channels.length === 0 ? <p>No channel connected yet.</p> : null}
        {channels.map((ch) => (
          <div class="item">
            {ch.avatar_url ? <img class="av" src={ch.avatar_url} alt="" /> : <div class="av" />}
            <div style="flex:1;min-width:0">
              <b>{ch.title || ch.channel_id}</b> <span class={STATUS[ch.status].cls}>{STATUS[ch.status].label}</span>
              <div class="muted small">{[ch.handle, ch.channel_id].filter(Boolean).join(' · ')}</div>
              {ch.status_reason ? <div class="muted small">{ch.status_reason}</div> : null}
            </div>
            <div class="row">
              {ch.status === 'active' ? (
                <form method="post" action={`/channels/${ch.id}/check`}><button class="btn" type="submit">Check now</button></form>
              ) : null}
              {ch.status === 'reconnect' ? (
                <a class="btn pri" href={`/auth/google/start?choose=1${ch.scopes.includes('yt-analytics-monetary') ? '&revenue=1' : ''}`}>Reconnect</a>
              ) : null}
              <form method="post" action={`/channels/${ch.id}/remove`}><button class="btn danger" type="submit">Remove</button></form>
            </div>
          </div>
        ))}

        {channels.length < max ? (
          <form method="get" action="/auth/google/start" class="row" style="margin-top:16px">
            <input type="hidden" name="choose" value="1" />
            <label class="small"><input type="checkbox" name="revenue" value="1" /> Also show my revenue (optional, view only)</label>
            <button class="btn pri" type="submit">+ Connect a channel</button>
          </form>
        ) : null}

        <p class="muted small">ViewProof only asks to view your channel and analytics. It can't upload, edit or delete anything.</p>
      </div>

      <div class="card" style="margin-top:16px">
        <h1>Your data</h1>
        <div class="row">
          <a class="btn" href="/account/export">Export my data</a>
          <form method="post" action="/auth/logout"><button class="btn" type="submit">Sign out</button></form>
        </div>
        <form method="post" action="/account/delete" class="row" style="margin-top:16px">
          <input name="confirm" placeholder='Type "delete"' style="padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text)" />
          <button class="btn danger" type="submit">Delete account</button>
        </form>
        <p class="muted small">Deleting removes your account, your channels and Google's access for ViewProof. It can't be undone.</p>
      </div>
    </Layout>
  );
}
