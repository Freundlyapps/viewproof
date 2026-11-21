import { Hono } from 'hono';
import type { Config } from './env';
import type { GoogleClient } from './google';

export interface Deps {
  db: D1Database;
  config: Config;
  google: GoogleClient;
  now: () => number;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true }));
  void deps;
  return app;
}
