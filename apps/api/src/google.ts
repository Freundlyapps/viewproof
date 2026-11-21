/** Google OAuth + YouTube channel access. Implemented in plan 2 task 3. */
export const SCOPES = {
  signIn: ['openid', 'email', 'profile'],
  channel: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'],
  revenue: 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
} as const;

export interface TokenSet {
  refreshToken: string | null;
  accessToken: string;
  scopes: string[];
  idClaims: { sub: string; email?: string; name?: string };
}

export interface MyChannel {
  channelId: string;
  title: string;
  handle: string | null;
  avatarUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
}

export type GoogleError = { kind: 'revoked' } | { kind: 'failed'; reason: string };

export interface GoogleClient {
  /** consent=false only for a plain returning sign-in: Google then skips the permission screen it already has. */
  authUrl(a: { state: string; challenge: string; wantRevenue: boolean; chooseAccount: boolean; consent: boolean }): string;
  exchangeCode(code: string, verifier: string): Promise<TokenSet | GoogleError>;
  refresh(refreshToken: string): Promise<{ accessToken: string } | GoogleError>;
  myChannels(accessToken: string): Promise<MyChannel[] | GoogleError>;
  revoke(token: string): Promise<void>;
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet%2Cstatistics&mine=true';

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | undefined => (x && typeof x === 'object' ? (x as Json) : undefined);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);
const count = (x: unknown): number | null => (typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : null);
const errText = (e: unknown) => (e instanceof Error ? e.message : 'network error');

/**
 * Reads claims from the ID token without checking its signature. Allowed because it comes straight
 * from Google's token endpoint over HTTPS, authenticated with our client secret:
 * https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo
 */
function idClaims(idToken: string | undefined): TokenSet['idClaims'] | null {
  const part = idToken?.split('.')[1];
  if (!part) return null;
  try {
    const c = obj(JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))));
    const sub = str(c?.sub);
    return sub ? { sub, ...(str(c?.email) ? { email: str(c?.email) } : {}), ...(str(c?.name) ? { name: str(c?.name) } : {}) } : null;
  } catch {
    return null;
  }
}

export function httpGoogleClient(
  fetch: typeof globalThis.fetch,
  cfg: { clientId: string; clientSecret: string; redirectUri: string },
): GoogleClient {
  const postToken = async (params: Record<string, string>): Promise<{ status: number; body: Json | undefined }> => {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }).toString(),
    });
    return { status: res.status, body: obj(await res.json().catch(() => undefined)) };
  };

  return {
    authUrl({ state, challenge, wantRevenue, chooseAccount, consent }) {
      const scopes = [...SCOPES.signIn, ...SCOPES.channel, ...(wantRevenue ? [SCOPES.revenue] : [])];
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',
        include_granted_scopes: 'false',
        prompt: !consent ? 'select_account' : chooseAccount ? 'consent select_account' : 'consent',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return `${AUTH_URL}?${q}`;
    },

    async exchangeCode(code, verifier) {
      try {
        const { status, body } = await postToken({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri });
        if (body?.error === 'invalid_grant') return { kind: 'failed', reason: 'The sign-in code expired or was already used' };
        if (status !== 200 || !body) return { kind: 'failed', reason: `HTTP ${status}` };
        const accessToken = str(body.access_token);
        const claims = idClaims(str(body.id_token));
        if (!accessToken || !claims) return { kind: 'failed', reason: 'Google response had no access or ID token' };
        return { accessToken, refreshToken: str(body.refresh_token) ?? null, scopes: (str(body.scope) ?? '').split(' ').filter(Boolean), idClaims: claims };
      } catch (e) {
        return { kind: 'failed', reason: errText(e) };
      }
    },

    async refresh(refreshToken) {
      try {
        const { status, body } = await postToken({ refresh_token: refreshToken, grant_type: 'refresh_token' });
        if (body?.error === 'invalid_grant') return { kind: 'revoked' };
        const accessToken = str(body?.access_token);
        if (status !== 200 || !accessToken) return { kind: 'failed', reason: `HTTP ${status}` };
        return { accessToken };
      } catch (e) {
        return { kind: 'failed', reason: errText(e) };
      }
    },

    async myChannels(accessToken) {
      try {
        const res = await fetch(CHANNELS_URL, { headers: { authorization: `Bearer ${accessToken}` } });
        if (res.status === 401) return { kind: 'revoked' };
        if (!res.ok) return { kind: 'failed', reason: `HTTP ${res.status}` };
        const items = (obj(await res.json())?.items as unknown[] | undefined) ?? [];
        return items.flatMap((raw): MyChannel[] => {
          const it = obj(raw);
          const id = str(it?.id);
          if (!it || !id) return [];
          const sn = obj(it.snippet);
          const st = obj(it.statistics);
          return [{
            channelId: id,
            title: str(sn?.title) ?? '',
            handle: str(sn?.customUrl) ?? null,
            avatarUrl: str(obj(obj(sn?.thumbnails)?.default)?.url) ?? null,
            subscriberCount: st?.hiddenSubscriberCount === true ? null : count(st?.subscriberCount),
            videoCount: count(st?.videoCount),
          }];
        });
      } catch (e) {
        return { kind: 'failed', reason: errText(e) };
      }
    },

    async revoke(token) {
      try {
        await fetch(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() });
      } catch {
        // Best effort: the user can also remove access at myaccount.google.com.
      }
    },
  };
}
