import { createApp } from './app';
import { type Env, parseConfig } from './env';
import { httpGoogleClient } from './google';
import { httpYouTubeClient } from './youtube';

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const config = parseConfig(env);
    const google = httpGoogleClient((input, init) => fetch(input, init), {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: `${config.appUrl}/auth/google/callback`,
    });
    return createApp({ db: env.DB, config, google, youtube: httpYouTubeClient((input, init) => fetch(input, init)), now: () => Date.now() }).fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
