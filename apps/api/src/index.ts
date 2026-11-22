import { llmClient } from '@viewproof/providers';
import { createApp } from './app';
import type { FeedResult } from './competitors/poll';
import { runCron } from './competitors/cron';
import { httpChannelStats } from './competitors/stats';
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

function depsFor(env: Env) {
  const config = parseConfig(env);
  const google = memoizeRefresh(httpGoogleClient((input, init) => fetch(input, init), {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: `${config.appUrl}/auth/google/callback`,
  }), TOKENS, () => Date.now());
  return { db: env.DB, config, google, youtube: httpYouTubeClient((input, init) => fetch(input, init)), keywords: keywordProviderFor(env, (input, init) => fetch(input, init)), fetchFeed, channelStats: httpChannelStats((input, init) => fetch(input, init)), llm: (o: Parameters<typeof llmClient>[0]) => llmClient({ ...o, fetchFn: (input, init) => fetch(input, init) }), now: () => Date.now(), assets: env.ASSETS, pool: env.POOL };
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return createApp(depsFor(env)).fetch(req, env, ctx);
  },
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(depsFor(env), new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
