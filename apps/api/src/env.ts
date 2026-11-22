/** Worker bindings. Secrets come from .dev.vars locally and Wrangler secrets in production. */
export interface Env {
  DB: D1Database;
  APP_URL: string;
  SELF_HOSTED?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_KEY: string;
  /** Built web app (apps/web/dist), see wrangler.toml [assets]. */
  ASSETS?: Fetcher;
  /** Optional YouTube search interest via DataForSEO Google Trends; off unless DATAFORSEO_DISPLAY_OK=yes. */
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
  DATAFORSEO_DISPLAY_OK?: string;
  /** Optional YouTube Data API key: competitor @handles and current subscriber counts. */
  YOUTUBE_API_KEY?: string;
  /** Optional R2 bucket for the data pool archive. */
  POOL?: R2Bucket;
  /** Feed fetches per hourly Cron run (default 10 fits Workers Free: ~4 D1 queries each, 50 per invocation). Paid: 45. */
  CRON_FEED_BUDGET?: string;
}

export interface Config {
  appUrl: string;
  /** Normalised origin of appUrl (scheme://host[:port]), used for the request origin check. */
  appOrigin: string;
  selfHosted: boolean;
  secureCookies: boolean;
  googleClientId: string;
  googleClientSecret: string;
  tokenKey: string;
  youtubeApiKey: string | null;
  cronFeedBudget: number;
}

export function parseConfig(env: Env): Config {
  for (const k of ['APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_KEY'] as const) {
    if (!env[k]) throw new Error(`${k} is not set`);
  }
  const appUrl = env.APP_URL.replace(/\/+$/, '');
  let keyBytes = 0;
  try {
    keyBytes = atob(env.TOKEN_KEY).length;
  } catch {
    keyBytes = 0;
  }
  if (keyBytes !== 32) throw new Error('TOKEN_KEY must be 32 bytes (base64). Generate one with: openssl rand -base64 32');
  return {
    appUrl,
    appOrigin: new URL(appUrl).origin,
    selfHosted: env.SELF_HOSTED === 'true',
    secureCookies: appUrl.startsWith('https://'),
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    tokenKey: env.TOKEN_KEY,
    youtubeApiKey: env.YOUTUBE_API_KEY || null,
    cronFeedBudget: Math.min(Math.max(Number(env.CRON_FEED_BUDGET) || 10, 1), 200),
  };
}
