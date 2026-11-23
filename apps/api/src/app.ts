import { aiKeyRoutes } from './ai/keys';
import { aiRoutes } from './ai/routes';
import { mcpTokenRoutes } from './mcp/tokens';
import { mcpRoutes } from './mcp/routes';
import type { StripeClient } from './billing/stripe';
import { billingWebhook } from './billing/webhook';
import { billingRoutes } from './billing/routes';
import type { LlmClient, LlmProviderId } from '@viewproof/providers';
import { Hono } from 'hono';
import type { Config } from './env';
import type { GoogleClient } from './google';
import type { YouTubeClient } from './youtube';
import type { FeedResult } from './competitors/poll';
import type { ChannelStatsClient } from './competitors/stats';
import { competitorRoutes } from './competitors/routes';
import { poolRoutes } from './pool/routes';
import { outlierRoutes } from './pool/outliers';
import type { KeywordProvider } from '@viewproof/providers';
import { keywordRoutes } from './routes/keywords';
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
  /** Optional keyword trends (vendor or "off"). */
  keywords: KeywordProvider;
  /** A channel's public RSS feed (S4). */
  fetchFeed: (channelId: string) => Promise<FeedResult>;
  /** Data API counts for other channels (key or user token). */
  channelStats: ChannelStatsClient;
  /** R2 bucket for the pool archive; absent on servers without one. */
  pool?: R2Bucket;
  now: () => number;
  /** Builds an LLM client (spec S6); tests pass a fake. */
  llm: (o: { provider: LlmProviderId; apiKey: string; model: string; baseUrl?: string | null }) => LlmClient;
  /** Stripe (plan 7); null when billing is off. Tests pass a fake. */
  stripe: StripeClient | null;
  /** Built web app (Workers Static Assets binding); absent when not configured. */
  assets?: { fetch(req: Request): Promise<Response> };
}

const NO_BUILD = 'The web app is not built yet. Run: pnpm --filter web build';

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
    // The pool contribution route takes no cookie: its bearer token is the credential (sent by the extension).
    // The Stripe webhook is signed; its signature is the credential.
    const bearerOnly = c.req.path === '/api/pool/contribute' || c.req.path === '/api/billing/webhook';
    // MCP clients (CLI apps) send no Origin; a browser's Origin must be ours (DNS rebinding rule). Its bearer token is the credential.
    if (c.req.path === '/mcp') {
      const o = c.req.header('origin');
      if (o !== undefined && originOf(o) !== deps.config.appOrigin) return c.text('Request blocked (wrong origin)', 403);
      return next();
    }
    if (!bearerOnly && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && originOf(c.req.header('origin')) !== deps.config.appOrigin) {
      return c.text('Request blocked (wrong origin)', 403);
    }
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/', async (c) => ((await readSession(c, deps)) ? c.redirect('/app', 302) : c.html(Home({ signedIn: false }))));

  // The React app (apps/web, built to apps/web/dist/app). Unknown /app paths are app routes → index.html;
  // missing files stay 404 so a broken build is visible.
  app.get('/app/*', async (c) => serveApp(c.req.raw, c.req.path));
  app.get('/app', async (c) => serveApp(c.req.raw, c.req.path));
  async function serveApp(req: Request, path: string): Promise<Response> {
    if (!deps.assets) return new Response(NO_BUILD, { status: 503 });
    if (path !== '/app' && path !== '/app/') {
      const file = await deps.assets.fetch(req);
      // A path naming a file (has an extension) that isn't there is a 404; only app routes get index.html.
      if (file.ok || path.startsWith('/app/assets/') || /\.[^/]+$/.test(path)) return file;
    }
    const index = await deps.assets.fetch(new Request(new URL('/app/index.html', req.url)));
    return index.ok ? index : new Response(NO_BUILD, { status: 503 });
  }
  authRoutes(app, deps);
  connectRoutes(app, deps);
  accountRoutes(app, deps);
  channelRoutes(app, deps);
  keywordRoutes(app, deps);
  competitorRoutes(app, deps);
  poolRoutes(app, deps);
  outlierRoutes(app, deps);
  aiKeyRoutes(app, deps);
  aiRoutes(app, deps);
  mcpTokenRoutes(app, deps);
  billingWebhook(app, deps);
  billingRoutes(app, deps);
  mcpRoutes(app, deps);
  return app;
}
