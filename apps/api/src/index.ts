import { createApp } from './app';
import type { FeedResult } from './competitors/poll';
import { type Env, parseConfig } from './env';
import { httpGoogleClient } from './google';
import { type TokenStore, memoizeRefresh } from './token-memo';
import { httpYouTubeClient } from './youtube';
import { keywordProviderFor } from './keyword-provider';

/** Access tokens reused across requests in this isolate (see token-memo). */
const TOKENS: TokenStore = new Map();

/** A channel's public RSS feed, no cookies. */
async function fetchFeed(channelId: string): Promise<FeedResult> {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, { headers: { accept: 'application/atom+xml' } });
    return res.ok ? { ok: true, xml: await res.text() } : { ok: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'network error' };
  }
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const config = parseConfig(env);
    const google = memoizeRefresh(httpGoogleClient((input, init) => fetch(input, init), {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: `${config.appUrl}/auth/google/callback`,
    }), TOKENS, () => Date.now());
    return createApp({ db: env.DB, config, google, youtube: httpYouTubeClient((input, init) => fetch(input, init)), keywords: keywordProviderFor(env, (input, init) => fetch(input, init)), fetchFeed, now: () => Date.now(), assets: env.ASSETS }).fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
