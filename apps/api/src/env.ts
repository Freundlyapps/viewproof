/** Worker bindings. Secrets come from .dev.vars locally and Wrangler secrets in production. */
export interface Env {
  DB: D1Database;
  APP_URL: string;
  SELF_HOSTED?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_KEY: string;
}

export interface Config {
  appUrl: string;
  selfHosted: boolean;
  secureCookies: boolean;
  googleClientId: string;
  googleClientSecret: string;
  tokenKey: string;
}

export function parseConfig(env: Env): Config {
  for (const k of ['APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_KEY'] as const) {
    if (!env[k]) throw new Error(`${k} is not set`);
  }
  const appUrl = env.APP_URL.replace(/\/+$/, '');
  return {
    appUrl,
    selfHosted: env.SELF_HOSTED === 'true',
    secureCookies: appUrl.startsWith('https://'),
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    tokenKey: env.TOKEN_KEY,
  };
}
