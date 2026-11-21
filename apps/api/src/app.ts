import { Hono } from 'hono';
import type { Config } from './env';
import type { GoogleClient } from './google';
import { accountRoutes } from './routes/account';
import { authRoutes } from './routes/auth';
import { connectRoutes } from './routes/connect';

export interface Deps {
  db: D1Database;
  config: Config;
  google: GoogleClient;
  now: () => number;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  // Forms post with the browser's Origin header; anything else changing state is refused.
  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== deps.config.appUrl) {
      return c.text('Request blocked (wrong origin)', 403);
    }
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));
  authRoutes(app, deps);
  connectRoutes(app, deps);
  accountRoutes(app, deps);
  return app;
}
