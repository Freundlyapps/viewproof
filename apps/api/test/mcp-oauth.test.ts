import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { b64url } from '../src/crypto';
import { ACCESS_TTL_S, MAX_CONNECTED_APPS, validRedirect } from '../src/mcp/oauth';
import { APP, addUser, makeDeps, post, readText, sessionCookie } from './helpers';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'a'.repeat(50);
const challengeOf = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));

type App = ReturnType<typeof createApp>;
const register = async (app: App, body: unknown = { client_name: 'Claude', redirect_uris: [REDIRECT] }) =>
  app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const clientId = async (app: App, name = 'Claude') => ((await (await register(app, { client_name: name, redirect_uris: [REDIRECT] })).json()) as { client_id: string }).client_id;
const authQuery = async (client: string, over: Record<string, string> = {}) => new URLSearchParams({
  response_type: 'code', client_id: client, redirect_uri: REDIRECT, code_challenge: await challengeOf(VERIFIER), code_challenge_method: 'S256', state: 'st1', resource: `${APP}/mcp`, ...over,
}).toString();
const token = (app: App, form: Record<string, string>) =>
  app.request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
const mcp = (app: App, access: string) =>
  app.request('/mcp', { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });

/** Consent → code → tokens, as a chat app does it. */
async function connect(app: App, cookie: string, client: string) {
  const allow = await post(app, '/oauth/authorize', cookie, { client_id: client, redirect_uri: REDIRECT, code_challenge: await challengeOf(VERIFIER), state: 'st1', decision: 'allow' });
  expect(allow.status).toBe(302);
  const back = new URL(allow.headers.get('location')!);
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  expect(back.searchParams.get('state')).toBe('st1');
  expect(back.searchParams.get('iss')).toBe(APP);
  const code = back.searchParams.get('code')!;
  const res = await token(app, { grant_type: 'authorization_code', code, client_id: client, redirect_uri: REDIRECT, code_verifier: VERIFIER });
  return { code, res, body: (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; token_type: string; error?: string } };
}

describe('MCP sign-in for chat apps (OAuth)', () => {
  it('publishes discovery metadata, and /mcp points to it on 401', async () => {
    const app = createApp(makeDeps());
    const pr = (await (await app.request('/.well-known/oauth-protected-resource')).json()) as Record<string, unknown>;
    expect(pr).toMatchObject({ resource: `${APP}/mcp`, authorization_servers: [APP] });
    const as = (await (await app.request('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(as).toMatchObject({ issuer: APP, authorization_endpoint: `${APP}/oauth/authorize`, token_endpoint: `${APP}/oauth/token`, registration_endpoint: `${APP}/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    const res = await mcp(app, 'nope');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${APP}/.well-known/oauth-protected-resource"`);
  });

  it('registers public clients with exact, safe return addresses only', async () => {
    const app = createApp(makeDeps());
    const ok = await register(app);
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' });
    for (const bad of [[], ['http://evil.example/cb'], ['javascript:alert(1)'], ['https://x.example/cb#frag']]) {
      expect((await register(app, { redirect_uris: bad })).status).toBe(400);
    }
    expect(validRedirect('http://127.0.0.1:3000/cb')).toBe(true);
    expect(validRedirect('cursor://anysphere.cursor-retrieval/oauth/cb')).toBe(true);
    expect(validRedirect('data:text/html,hi')).toBe(false);
  });

  it('never redirects to an unregistered address; other errors go back to the app', async () => {
    const app = createApp(makeDeps());
    const client = await clientId(app);
    const wrong = await app.request(`/oauth/authorize?${await authQuery(client, { redirect_uri: 'https://evil.example/cb' })}`);
    expect(wrong.status).toBe(400);
    expect(await readText(wrong)).toContain('Wrong return address');
    const noPkce = await app.request(`/oauth/authorize?${await authQuery(client, { code_challenge_method: 'plain' })}`);
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
  });

  it('signed out: asks to sign in, then /account sends the browser back to the consent page', async () => {
    await addUser('oa1');
    const app = createApp(makeDeps());
    const client = await clientId(app);
    const path = `/oauth/authorize?${await authQuery(client)}`;
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(await readText(res)).toContain('Sign in to ViewProof');
    const ret = res.headers.getSetCookie().find((c) => c.startsWith('vp_mcp_return='))!.split(';')[0]!;
    const back = await app.request('/account', { headers: { cookie: `${await sessionCookie('oa1')}; ${ret}` } });
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe(path);
  });

  it('signed in: shows the consent page with the app name and where it returns to', async () => {
    await addUser('oa2');
    const app = createApp(makeDeps());
    const client = await clientId(app, 'Claude <b>x</b>');
    const res = await app.request(`/oauth/authorize?${await authQuery(client)}`, { headers: { cookie: await sessionCookie('oa2') } });
    const html = await res.text(); // raw: the app's name must arrive escaped
    expect(html).toContain('Allow “Claude &lt;b&gt;x&lt;/b&gt;” to read your ViewProof data?');
    expect(html).toContain('<b>claude.ai</b>');
  });

  it('Cancel returns access_denied and makes no code', async () => {
    await addUser('oa3');
    const app = createApp(makeDeps());
    const client = await clientId(app);
    const res = await post(app, '/oauth/authorize', await sessionCookie('oa3'), { client_id: client, redirect_uri: REDIRECT, code_challenge: await challengeOf(VERIFIER), state: 's', decision: 'deny' });
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_codes WHERE client_id = ?').bind(client).first<{ n: number }>())!.n).toBe(0);
  });

  it('Allow → code → tokens that work on /mcp; the code works once and needs the right verifier', async () => {
    await addUser('oa4');
    const app = createApp(makeDeps());
    const client = await clientId(app);
    const cookie = await sessionCookie('oa4');
    const { code, body } = await connect(app, cookie, client);
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: ACCESS_TTL_S });
    expect((await mcp(app, body.access_token)).status).toBe(200);
    expect(((await (await token(app, { grant_type: 'authorization_code', code, client_id: client, redirect_uri: REDIRECT, code_verifier: VERIFIER })).json()) as { error: string }).error).toBe('invalid_grant');

    const second = await post(app, '/oauth/authorize', cookie, { client_id: client, redirect_uri: REDIRECT, code_challenge: await challengeOf(VERIFIER), state: 's', decision: 'allow' });
    const code2 = new URL(second.headers.get('location')!).searchParams.get('code')!;
    const wrong = await token(app, { grant_type: 'authorization_code', code: code2, client_id: client, redirect_uri: REDIRECT, code_verifier: 'b'.repeat(50) });
    expect(wrong.status).toBe(400);
  });

  it('access tokens expire; refresh rotates both tokens and the old refresh token stops working', async () => {
    await addUser('oa5');
    let now = Date.parse('2026-11-28T10:00:00Z');
    const app = createApp(makeDeps({ now: () => now }));
    const client = await clientId(app);
    const { body } = await connect(app, await sessionCookie('oa5'), client);
    now += (ACCESS_TTL_S + 1) * 1000;
    expect((await mcp(app, body.access_token)).status).toBe(401);
    const r = (await (await token(app, { grant_type: 'refresh_token', refresh_token: body.refresh_token, client_id: client })).json()) as { access_token: string; refresh_token: string };
    expect(r.refresh_token).not.toBe(body.refresh_token);
    expect((await mcp(app, r.access_token)).status).toBe(200);
    expect((await token(app, { grant_type: 'refresh_token', refresh_token: body.refresh_token })).status).toBe(400);
  });

  it('connected apps are listed apart from tokens, do not use up the token limit, and can be disconnected', async () => {
    await addUser('oa6');
    const app = createApp(makeDeps());
    const cookie = await sessionCookie('oa6');
    const client = await clientId(app);
    const { body } = await connect(app, cookie, client);
    const list = (await (await app.request('/api/mcp/tokens', { headers: { cookie } })).json()) as { tokens: { id: string; label: string; connectedApp: boolean }[] };
    expect(list.tokens).toEqual([expect.objectContaining({ label: 'Claude', connectedApp: true })]);
    const del = await app.request(`/api/mcp/tokens/${list.tokens[0]!.id}`, { method: 'DELETE', headers: { origin: APP, cookie } });
    expect(del.status).toBe(204);
    expect((await mcp(app, body.access_token)).status).toBe(401);
    expect((await token(app, { grant_type: 'refresh_token', refresh_token: body.refresh_token })).status).toBe(400);
  });

  it(`keeps at most ${MAX_CONNECTED_APPS} connected apps, and one per app`, async () => {
    await addUser('oa7');
    const app = createApp(makeDeps());
    const cookie = await sessionCookie('oa7');
    const client = await clientId(app);
    await connect(app, cookie, client);
    await connect(app, cookie, client);
    const n = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_tokens WHERE user_id = ?').bind('oa7').first<{ n: number }>())!.n;
    expect(await n()).toBe(1);
    for (let i = 0; i < MAX_CONNECTED_APPS + 2; i++) await connect(app, cookie, await clientId(app, `App ${i}`));
    expect(await n()).toBe(MAX_CONNECTED_APPS);
  });

  it('the token endpoint takes no cookie and works without an Origin; register and token answer CORS', async () => {
    const app = createApp(makeDeps());
    const res = await app.request('/oauth/token', { method: 'POST', headers: { origin: 'https://claude.ai', 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=nope' });
    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_grant_type');
  });
});
