import { vi } from 'vitest';

type Handler = unknown | ((url: URL) => Response | unknown);
/**
 * Replace fetch: each key is a path prefix ("/api/me"); value is a JSON body, a Response, or a function of the URL.
 * Returns the list of requested URLs (path + query).
 */
export function mockApi(routes: Record<string, Handler>): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost:8787');
    seen.push(url.pathname + url.search);
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.pathname.startsWith(k));
    if (key === undefined) return new Response(JSON.stringify({ error: 'not_found', message: 'no mock' }), { status: 404 });
    const h = routes[key];
    const out = typeof h === 'function' ? (h as (u: URL) => unknown)(url) : h;
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return seen;
}

export const ME = { id: 'u1', email: 'me@example.com', name: 'Me', plan: 'free', maxChannels: 1 };
export const channel = (over: Record<string, unknown> = {}) => ({
  id: 'row1', platform: 'youtube', channelId: 'UCaaa', title: 'Quiet Hands Pottery', handle: '@quiethands', avatarUrl: null,
  status: 'active', statusReason: null, connectedAt: '2026-11-01T00:00:00Z', lastVerifiedAt: '2026-11-21T00:00:00Z', ...over,
});
export const signedOut = () => new Response(JSON.stringify({ error: 'signed_out' }), { status: 401 });
