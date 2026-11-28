import { POOL_FIELD_LABELS } from '@viewproof/core';
import { STATE_TTL_MS } from '../routes/auth';
import { FIRST_WEEK_TTL_MS, REPORT_TTL_MS } from '../routes/channel';
import { KEYWORD_CACHE_MS } from '../routes/keywords';
import { POOL_OBSERVATIONS_KEEP_DAYS } from '../competitors/poll';
import { BRIEF_KEEP_DAYS, CHANGE_KEEP_DAYS } from '../agent/checks';
import { SCOPES } from '../google';
import { SESSION_DAYS } from '../session';
import type { Config } from '../env';
import { Layout } from './Layout';

/** Change when the text below changes. */
const UPDATED = '24 November 2026';
const USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy';
const YT_TERMS = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
/** The revocation page the YouTube API Services Developer Policies (III.A.2) name. */
const GOOGLE_PERMISSIONS = 'https://security.google.com/settings/security/permissions';
const SOURCE = 'https://github.com/Freundlyapps/viewproof';

type Operator = Config['operator'];

/**
 * What the pages describe, taken from how this server actually runs (app.ts builds it), so the text can't claim a
 * service, cookie or pool this server doesn't have.
 */
export interface LegalFacts {
  op: Operator;
  signedIn: boolean;
  billing: boolean;
  selfHosted: boolean;
  /** This server sends looked-up keywords to DataForSEO. */
  dataForSeo: boolean;
  /** This server keeps a daily archive of pool facts (R2 binding present). */
  poolArchive: boolean;
  cookies: { session: string; signIn: string };
}

const hours = (ms: number) => Math.round(ms / 3_600_000);
const days = (ms: number) => Math.round(ms / 86_400_000);
const scopeName = (s: string) => s.replace('https://www.googleapis.com/auth/', '');
const listText = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function Contact(props: { op: Operator }) {
  const who = props.op.name ?? 'the operator of this server';
  return props.op.contact
    ? <p>This server is run by {who}. Contact, also for privacy questions: <a href={`mailto:${props.op.contact}`}>{props.op.contact}</a>. Postal address: see the <a href="/imprint">legal notice</a>.</p>
    : <p>This server is run by {who}. The operator of this server hasn't set a contact address.</p>;
}

export function Privacy(f: LegalFacts) {
  const [youtube, analytics] = SCOPES.channel.map(scopeName);
  return (
    <Layout title="Privacy policy" signedIn={f.signedIn}>
      <div class="card">
        <h1>Privacy policy</h1>
        <p class="muted small">Last updated {UPDATED}.</p>
        <Contact op={f.op} />
        {f.selfHosted ? <p>This is a self-hosted ViewProof server. Its operator, not the team behind viewproof.app, decides how it is run and is responsible for the data on it.</p> : null}

        <h2>Google and YouTube data</h2>
        <p>When you sign in with Google, ViewProof receives your Google account id, email address and name. When you connect a channel, you give view-only access to it (YouTube Data API, scope <code>{youtube}</code>) and to its YouTube Analytics (<code>{analytics}</code>, and <code>{scopeName(SCOPES.revenue)}</code> only if you allow revenue). ViewProof can't upload, edit or delete anything on YouTube.</p>
        <p>It uses this data only to show you your own channel's numbers, videos and search terms, and, when you ask, to answer your questions in Ask AI or in AI apps you connect yourself (MCP). It does not sell it, use it for advertising, or use it to train AI models. People don't read it, except with your permission, for security or abuse, or when the law requires it.</p>
        <p>ViewProof's use and transfer of information received from Google APIs to any other app will adhere to the <a href={USER_DATA_POLICY}>Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
        <p>ViewProof uses YouTube API Services. The <a href={YT_TERMS}>YouTube Terms of Service</a> and the <a href={GOOGLE_PRIVACY}>Google Privacy Policy</a> apply.</p>

        <h2>What is stored, and for how long</h2>
        <ul>
          <li>Your Google account id, email, name and plan, until you delete your account.</li>
          <li>Each connected channel's id, title, handle, picture and the permissions you gave. Google's refresh token is stored encrypted (AES-256-GCM) and never appears in exports.</li>
          <li>Answers from YouTube Analytics and the Data API, cached for up to {hours(REPORT_TTL_MS)} hours (first-week views per video for up to {days(FIRST_WEEK_TTL_MS)} days), deleted when you remove the channel.</li>
          <li>A hash of each login session id; the id itself is a cookie in your browser.</li>
          <li>Competitor channels you track, your own AI key if you add one (encrypted), hashes of your MCP and linked-browser tokens, the AI apps you connect (the name each app gives itself and its return address), and counters for your plan's limits. Outlier search words are kept for up to two days to count your daily limit.</li>
          <li>If you use the weekly brief: each brief (the data it was given, its ideas, the model and its token counts) for {BRIEF_KEEP_DAYS} days; title changes it suggested, with your videos' old and new titles and the before/after view counts from YouTube Analytics, until {CHANGE_KEEP_DAYS} days after the last check. All of it is deleted when you remove the channel.</li>
          <li>Token counts of AI answers, summed per month and model, with no link to your account (to know what the AI costs).</li>
          {f.billing ? <li>Your Stripe customer id and subscription status. Payments are handled by Stripe, the merchant of record; ViewProof never sees card details.</li> : null}
        </ul>
        <p>Your questions to Ask AI and its answers are not stored. The weekly brief runs only when you start it or switch it on, and it never changes anything on your channel. When you use AI, the data listed in each answer is sent to the AI provider named there (the server's included model, or your own key's provider).</p>

        <h2>Who else receives data</h2>
        <ul>
          <li>{f.selfHosted ? 'The hosting provider this server\'s operator chose' : 'Cloudflare, which hosts this service'} processes every request to deliver it.</li>
          <li>Google and YouTube, to read your channel's data with the access you gave.</li>
          <li>The AI provider named in an answer, only when you use AI.</li>
          {f.dataForSeo ? <li>DataForSEO, for YouTube search interest: the keywords you look up (not who you are). Keyword results are shared between users and kept for {days(KEYWORD_CACHE_MS)} days.</li> : null}
          {f.billing ? <li>Stripe, for payments.</li> : null}
        </ul>
        <p>Some of these providers process data outside the EU, including in the USA.</p>

        <h2>Browser extension{f.selfHosted ? '' : ' and data pool'}</h2>
        <p>The extension keeps what it reads on YouTube (view counts you saw, your YouTube searches' first result pages, transcripts you open, video lookups) in your browser's extension storage (<code>chrome.storage.local</code>). For its numbers it also asks YouTube itself for public data (a channel's public feed, YouTube's search suggestions for the keyword you research, and the watch page of a video you look up on the Tools page), always without your YouTube cookies.</p>
        {f.selfHosted
          ? <p>The extension from the Chrome Web Store and Edge Add-ons never sends anything to this server: it only works with viewproof.app. Only a copy built with this server's address (see the source code) can hand its data to this server's pages, and it uploads to this server's own data pool only if you opt in. That pool is separate from viewproof.app's; the uploads are described below.</p>
          : <p>On this site's pages, the web app reads what the extension kept without uploading it. The extension sends nothing to the server unless you opt in to the data pool.</p>}
        <p>Pool uploads carry public video facts ({listText(Object.values(POOL_FIELD_LABELS))}), never cookies, your searches or watch time. Because they come from pages you open, they show which public videos were seen and when (stored to the hour). They are sent with your linked browser's token so limits apply, and the facts are stored without any link to your account: view counts for {POOL_OBSERVATIONS_KEEP_DAYS} days{f.poolArchive ? ', and in a daily archive for up to 36 months' : ''}. You can stop at any time by unlinking the browser in Settings → Extension & data, and the extension's data-sharing page shows everything it sent.</p>

        <h2>Cookies and browser storage</h2>
        <ul>
          <li><code>{f.cookies.session}</code>: keeps you signed in, for up to {SESSION_DAYS} days or until you sign out.</li>
          <li><code>{f.cookies.signIn}</code>: checks that a Google sign-in returning to this site is the one you started. Set when you start signing in, removed when you return, at most {Math.round(STATE_TTL_MS / 60_000)} minutes.</li>
          <li>Your browser's local storage keeps your light or dark theme and the channel you last picked.</li>
        </ul>
        <p>All of these are needed for the site to work; there are no tracking or advertising cookies.</p>

        <h2>Why ViewProof may use this data</h2>
        <ul>
          <li>To provide the service you signed up for (your account, connected channels, limits{f.billing ? ', your plan' : ''}): GDPR Art. 6(1)(b).</li>
          <li>Your consent, which you can withdraw at any time: the Google permissions you grant (including revenue) and data pool uploads: Art. 6(1)(a).</li>
          <li>Keeping the service secure and preventing abuse (login checks, rate limits, pausing bad uploads): legitimate interest, Art. 6(1)(f).</li>
        </ul>

        <h2>Your choices and rights</h2>
        <ul>
          <li><strong>Export</strong> what is stored about you as JSON from the Account page (secrets such as tokens and keys are left out).</li>
          <li><strong>Remove</strong> a channel or <strong>delete</strong> your account on the Account page. ViewProof's Google access is revoked and the data is deleted at once.</li>
          <li>You can also remove ViewProof's access in your <a href={GOOGLE_PERMISSIONS}>Google account permissions</a>.</li>
          <li>Under the GDPR you can ask for access, correction, deletion, restriction or a copy of your data, and object to processing based on legitimate interest{f.op.contact ? <>; write to <a href={`mailto:${f.op.contact}`}>{f.op.contact}</a></> : null}. You can also complain to a data protection authority, for example the one where you live.</li>
        </ul>
        <p class="muted small">The source code is public, so you can check all of this: <a href={SOURCE}>github.com/Freundlyapps/viewproof</a>.</p>
      </div>
    </Layout>
  );
}

export function Terms(f: LegalFacts) {
  return (
    <Layout title="Terms of service" signedIn={f.signedIn}>
      <div class="card">
        <h1>Terms of service</h1>
        <p class="muted small">Last updated {UPDATED}.</p>
        <Contact op={f.op} />
        <ul>
          <li><strong>YouTube.</strong> ViewProof uses YouTube API Services. By using ViewProof you agree to be bound by the <a href={YT_TERMS}>YouTube Terms of Service</a>.</li>
          <li><strong>What ViewProof does.</strong> It shows YouTube data and estimates, each labelled with its source. Access to your channel is view-only. ViewProof gives no guarantee of results, and its numbers can be late or incomplete when YouTube's are.</li>
          {f.billing ? <li><strong>Plans.</strong> Limits are shown under Settings → Plan & usage and are never billed as overage. Pro renews monthly until you cancel; cancelling keeps Pro until the paid period ends. Deleting your account cancels Pro at once, without a refund for the rest of the period.</li> : null}
          <li><strong>Fair use.</strong> Don't break YouTube's or Google's terms through ViewProof, try to get around limits, send false data to the data pool, or overload the service. Accounts that do may be paused or closed.</li>
          <li><strong>Your data.</strong> See the <a href="/privacy">privacy policy</a>. You can export or delete it at any time.</li>
          <li><strong>No warranty.</strong> ViewProof is open-source software (AGPL-3.0), provided as is. To the extent the law allows, the operator is not liable for indirect losses or lost revenue.</li>
          <li><strong>Changes.</strong> These terms can change; the date above shows the last change.</li>
        </ul>
      </div>
    </Layout>
  );
}

/** Legal notice (Impressum, § 5 DDG): who runs this server and how to reach them. */
export function Imprint(f: LegalFacts) {
  const lines = f.op.address?.split('\n').map((l) => l.trim()).filter(Boolean) ?? [];
  return (
    <Layout title="Legal notice" signedIn={f.signedIn}>
      <div class="card">
        <h1>Legal notice</h1>
        <p>{f.op.name ?? "The operator of this server hasn't set a name."}</p>
        {lines.length
          ? <p>{lines.flatMap((l, i) => (i === 0 ? [l] : [<br />, l]))}</p>
          : <p>The operator of this server hasn't set a postal address.</p>}
        {f.op.contact
          ? <p>Email: <a href={`mailto:${f.op.contact}`}>{f.op.contact}</a></p>
          : <p>The operator of this server hasn't set a contact address.</p>}
        <p class="muted small">ViewProof is open-source software; the people who wrote it don't run this server unless named above.</p>
      </div>
    </Layout>
  );
}
