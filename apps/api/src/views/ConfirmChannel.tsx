import type { PendingConnectionRow } from '@viewproof/db';
import { Layout } from './Layout';

const num = new Intl.NumberFormat('en-US');
const plural = (n: number, word: string) => `${num.format(n)} ${word}${n === 1 ? '' : 's'}`;

export function ConfirmChannel(props: { p: PendingConnectionRow; revenue: boolean }) {
  const { p } = props;
  return (
    <Layout title="Is this the right channel?" signedIn>
      <div class="card">
        <p class="muted small">Step 2 of 2</p>
        <h1>Is this the right channel?</h1>
        <div class="item">
          {p.avatar_url ? <img class="av" src={p.avatar_url} alt="" /> : <div class="av" />}
          <div>
            <b>{p.title || 'Untitled channel'}</b>
            <div class="muted small">
              {[p.handle, p.subscriber_count === null ? 'Subscriber count hidden' : plural(p.subscriber_count, 'subscriber'),
                p.video_count === null ? 'Video count not shown' : plural(p.video_count, 'video')].filter(Boolean).join(' · ')}
            </div>
            <div class="muted small">Channel ID {p.channel_id}</div>
          </div>
        </div>
        <div class="note">
          Not the one? Google's list sometimes shows a channel's old name. Go back and pick the account in the same position as in your YouTube channel list.
        </div>
        <p class="muted small">Revenue: {props.revenue ? 'included (view only)' : 'not included'}. ViewProof can only view your channel; it can't upload, edit or delete anything.</p>
        <div class="row">
          <form method="post" action="/connect/cancel"><input type="hidden" name="id" value={p.id} /><button class="btn" type="submit">Pick another</button></form>
          <form method="post" action="/connect/confirm"><input type="hidden" name="id" value={p.id} /><button class="btn pri" type="submit">Yes, connect</button></form>
        </div>
      </div>
    </Layout>
  );
}
