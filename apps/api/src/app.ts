import { Hono } from 'hono';
import type { Config } from './env';
import type { GoogleClient } from './google';
import type { YouTubeClient } from './youtube';
import { accountRoutes } from './routes/account';
import { authRoutes } from './routes/auth';
import { channelRoutes } from './routes/channel';
import { connectRoutes } from './routes/connect';
import { readSession } from './session';
import { Home } from './views/Home';

export interface Deps {
  db: D1Database;
  config: Config;
  google: GoogleClient;
  youtube: YouTubeClient;
  now: () => number;
}

function originOf(h: string | undefined): string | null {
  try {
    return h ? new URL(h).origin : null;
  } catch {
    return null;
  }
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  // Forms post with the browser's Origin header; anything else changing state is refused.
  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && originOf(c.req.header('origin')) !== deps.config.appOrigin) {
      return c.text('Request blocked (wrong origin)', 403);
    }
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/', async (c) => c.html(Home({ signedIn: (await readSession(c, deps)) !== null })));
  authRoutes(app, deps);
  connectRoutes(app, deps);
  accountRoutes(app, deps);
  channelRoutes(app, deps);
  return app;
}
