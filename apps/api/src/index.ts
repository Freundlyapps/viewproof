import { createApp } from './app';
import { type Env, parseConfig } from './env';
import { httpGoogleClient } from './google';
import { type TokenStore, memoizeRefresh } from './token-memo';
import { httpYouTubeClient } from './youtube';
import { keywordProviderFor } from './keyword-provider';

/** Access tokens reused across requests in this isolate (see token-memo). */
const TOKENS: TokenStore = new Map();

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const config = parseConfig(env);
    const google = memoizeRefresh(httpGoogleClient((input, init) => fetch(input, init), {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: `${config.appUrl}/auth/google/callback`,
    }), TOKENS, () => Date.now());
    return createApp({ db: env.DB, config, google, youtube: httpYouTubeClient((input, init) => fetch(input, init)), keywords: keywordProviderFor(env, (input, init) => fetch(input, init)), now: () => Date.now(), assets: env.ASSETS }).fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
