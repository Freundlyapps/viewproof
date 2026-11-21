import { createApp } from './app';
import { type Env, parseConfig } from './env';
import type { GoogleClient } from './google';

// Task 1: the HTTP Google client arrives in task 3; until then sign-in routes don't exist.
const notYet = (): never => {
  throw new Error('Google client not wired yet');
};
const google: GoogleClient = { authUrl: notYet, exchangeCode: notYet, refresh: notYet, myChannels: notYet, revoke: notYet };

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return createApp({ db: env.DB, config: parseConfig(env), google, now: () => Date.now() }).fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
