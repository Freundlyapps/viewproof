import type { Config } from '../env';
import { Layout } from './Layout';

/** Change when the text below changes. */
const UPDATED = '23 November 2026';
const USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy';
const YT_TERMS = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
const GOOGLE_PERMISSIONS = 'https://myaccount.google.com/permissions';

type Operator = Config['operator'];

function Contact(props: { op: Operator }) {
  const who = props.op.name ?? 'the operator of this server';
  return props.op.contact
    ? <p>This server is run by {who}. Contact: <a href={`mailto:${props.op.contact}`}>{props.op.contact}</a>.</p>
    : <p>This server is run by {who}. The operator of this server hasn't set a contact address.</p>;
}

export function Privacy(props: { op: Operator; signedIn: boolean; billing: boolean }) {
  return (
    <Layout title="Privacy policy" signedIn={props.signedIn}>
      <div class="card">
        <h1>Privacy policy</h1>
        <p class="muted small">Last updated {UPDATED}.</p>
        <Contact op={props.op} />

        <h2>Google and YouTube data</h2>
        <p>When you sign in with Google, ViewProof receives your Google account id, email address and name. When you connect a channel, you give view-only access to it (YouTube Data API, scope <code>youtube.readonly</code>) and to its YouTube Analytics (<code>yt-analytics.readonly</code>, and <code>yt-analytics-monetary.readonly</code> only if you allow revenue). ViewProof can't upload, edit or delete anything on YouTube.</p>
        <p>It uses this data only to show you your own channel's numbers, videos and search terms, and, when you ask, to answer your questions in Ask AI or through your own MCP tokens. It does not sell it, use it for advertising, or use it to train AI models. People don't read it, except with your permission, for security or abuse, or when the law requires it.</p>
        <p>ViewProof's use and transfer of information received from Google APIs to any other app will adhere to the <a href={USER_DATA_POLICY}>Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
        <p>ViewProof uses YouTube API Services. The <a href={YT_TERMS}>YouTube Terms of Service</a> and the <a href={GOOGLE_PRIVACY}>Google Privacy Policy</a> apply.</p>

        <h2>What is stored, and for how long</h2>
        <ul>
          <li>Your Google account id, email, name and plan, until you delete your account.</li>
          <li>Each connected channel's id, title, handle, picture and the permissions you gave. Google's refresh token is stored encrypted (AES-256-GCM) and never appears in exports.</li>
          <li>Answers from YouTube Analytics and the Data API, cached for up to 6 hours (first-week views per video for up to 30 days), deleted when you remove the channel.</li>
          <li>A hash of each login session id; the id itself is a cookie in your browser.</li>
          <li>Competitor channels you track, your own AI key if you add one (encrypted), hashes of your MCP and linked-browser tokens, and counters for your plan's limits. Outlier search words are kept for up to two days to count your daily limit.</li>
          {props.billing ? <li>Your Stripe customer id and subscription status. Payments are handled by Stripe, the merchant of record; ViewProof never sees card details.</li> : null}
        </ul>
        <p>Your questions to Ask AI and its answers are not stored. When you use AI, the data listed in each answer is sent to the AI provider named there (the server's included model, or your own key's provider).</p>
        <h2>Who else receives data</h2>
        <ul>
          <li>The server's hosting provider (Cloudflare for the hosted service) processes every request to deliver it.</li>
          <li>Google and YouTube, to read your channel's data with the access you gave.</li>
          <li>The AI provider named in an answer, only when you use AI.</li>
          <li>If the server uses DataForSEO for YouTube search interest, the keywords you look up (not who you are). Keyword results are shared between users and kept for 30 days.</li>
          {props.billing ? <li>Stripe, for payments.</li> : null}
        </ul>

        <h2>Browser extension and data pool</h2>
        <p>The extension keeps what it reads on YouTube (view counts you saw, your YouTube searches' first result pages, transcripts you open, video lookups) in your browser's <code>chrome.storage.local</code>; the web app reads them on this site's pages without uploading them. It sends nothing to the server unless you opt in to the data pool. Pool uploads carry public video facts (video and channel ids, title, view count, upload time, length), never cookies or watch time. They are sent with your linked browser's token so limits apply, and the facts are stored without any link to your account. Details and a record of everything sent are on the extension's data-sharing page.</p>
        <p>This site sets one cookie, the login session; the app remembers your theme and the channel you last picked in your browser.</p>

        <h2>Your choices</h2>
        <ul>
          <li><strong>Export</strong> what is stored about you as JSON from the Account page (secrets such as tokens and keys are left out).</li>
          <li><strong>Remove</strong> a channel or <strong>delete</strong> your account on the Account page. ViewProof's Google access is revoked and the data is deleted.</li>
          <li>You can also remove ViewProof's access in your <a href={GOOGLE_PERMISSIONS}>Google account permissions</a>.</li>
        </ul>
        <p class="muted small">The source code is public, so you can check all of this: <a href="https://github.com/Freundlyapps/viewproof">github.com/Freundlyapps/viewproof</a>.</p>
      </div>
    </Layout>
  );
}

export function Terms(props: { op: Operator; signedIn: boolean; billing: boolean }) {
  return (
    <Layout title="Terms of service" signedIn={props.signedIn}>
      <div class="card">
        <h1>Terms of service</h1>
        <p class="muted small">Last updated {UPDATED}.</p>
        <Contact op={props.op} />
        <ul>
          <li><strong>YouTube.</strong> ViewProof uses YouTube API Services. By using ViewProof you agree to be bound by the <a href={YT_TERMS}>YouTube Terms of Service</a>.</li>
          <li><strong>What ViewProof does.</strong> It shows YouTube data and estimates, each labelled with its source. Access to your channel is view-only. ViewProof gives no guarantee of results, and its numbers can be late or incomplete when YouTube's are.</li>
          {props.billing ? <li><strong>Plans.</strong> Limits are shown under Settings → Plan & usage and are never billed as overage. Pro renews monthly until you cancel; cancelling keeps Pro until the paid period ends. Deleting your account cancels Pro at once, without a refund for the rest of the period.</li> : null}
          <li><strong>Fair use.</strong> Don't break YouTube's or Google's terms through ViewProof, try to get around limits, send false data to the data pool, or overload the service. Accounts that do may be paused or closed.</li>
          <li><strong>Your data.</strong> See the <a href="/privacy">privacy policy</a>. You can export or delete it at any time.</li>
          <li><strong>No warranty.</strong> ViewProof is open-source software (AGPL-3.0), provided as is. To the extent the law allows, the operator is not liable for indirect losses or lost revenue.</li>
          <li><strong>Changes.</strong> These terms can change; the date above shows the last change.</li>
        </ul>
      </div>
    </Layout>
  );
}
