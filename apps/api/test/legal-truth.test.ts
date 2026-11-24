// The privacy and terms pages make promises; these tests check the promises against what the server actually does,
// not just that the words are there. A new cookie, scope, pool field or table that the pages don't cover fails here.
import { env } from 'cloudflare:test';
import { POOL_FIELD_LABELS } from '@viewproof/core';
import { dataForSeoProvider, noProvider } from '@viewproof/providers';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { SCOPES, httpGoogleClient } from '../src/google';
import { APP, addUser, channelFixture, fakeLlm, makeDeps, post, readText, sendJsonReq, sessionCookie, signIn } from './helpers';

const page = async (path: string, over: Parameters<typeof makeDeps>[0] = {}, envOver: Parameters<typeof makeDeps>[1] = {}) =>
  readText(await createApp(makeDeps(over, envOver)).request(path));

/** Every row of every app table, as text: what "deleted" and "not stored" have to hold against. */
async function everyRow(): Promise<{ table: string; text: string }[]> {
  const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>()).results;
  const out: { table: string; text: string }[] = [];
  for (const { name } of tables) {
    for (const row of (await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results) out.push({ table: name, text: JSON.stringify(row) });
  }
  return out;
}
const rowsContaining = async (needle: string) => (await everyRow()).filter((r) => r.text.includes(needle)).map((r) => `${r.table}: ${r.text.slice(0, 160)}`);

describe('privacy page claims are true', () => {
  test('every cookie the site sets is named on the page', async () => {
    const s = await signIn({ sub: 'lt-cookies' });
    const start = await s.app.request('/auth/google/start');
    const names = new Set<string>();
    for (const res of [start, s.callback, await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId })]) {
      for (const c of res.headers.getSetCookie()) names.add(c.slice(0, c.indexOf('=')));
    }
    expect(names.size).toBeGreaterThan(1);
    const html = await page('/privacy');
    for (const n of names) expect(html, n).toContain(`<code>${n}</code>`);
  });

  test('every Google scope the app can request is named on the page', async () => {
    const html = await page('/privacy');
    const google = httpGoogleClient(fetch, { clientId: 'c', clientSecret: 's', redirectUri: `${APP}/auth/google/callback` });
    const start = await createApp(makeDeps({ google })).request('/auth/google/start?choose=1&revenue=1');
    const requested = new URL(start.headers.get('location')!).searchParams.get('scope')!.split(' ');
    for (const s of new Set([...requested, ...SCOPES.channel, SCOPES.revenue])) {
      if (['openid', 'email', 'profile'].includes(s)) continue;
      expect(html, s).toContain(`<code>${s.replace('https://www.googleapis.com/auth/', '')}</code>`);
    }
  });

  test('every field a pool upload carries is named on the page', async () => {
    const html = await page('/privacy');
    for (const label of Object.values(POOL_FIELD_LABELS)) expect(html, label).toContain(label);
  });

  test('a pool upload is stored without anything that leads back to the account', async () => {
    const s = await signIn({ sub: 'lt-pool', channel: channelFixture({ channelId: 'UClegaltruthpoolxxxxxxxx' }) });
    const app = createApp(makeDeps());
    const r = await app.request('/api/pool/tokens', { method: 'POST', headers: { cookie: s.cookie, origin: APP, 'content-type': 'application/json' }, body: '{}' });
    const { token, browser } = await r.json<{ token: string; browser: { id: string } }>();
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    const sent = await app.request('/api/pool/contribute', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, observations: [{ videoId: 'ltpoolvid01', channelId: 'UCltpoolchannelxxxxxxxxx', title: 'Pool', views: 5, publishedAt: '2026-11-01T00:00:00.000Z', ageDays: null, durationSec: 60, format: 'long', source: 'watch', observedAt }] }),
    });
    expect((await sent.json<{ accepted: number }>()).accepted).toBe(1);
    const user = (await env.DB.prepare("SELECT id FROM users WHERE google_sub = 'lt-pool'").first<{ id: string }>())!.id;
    const facts = (await everyRow()).filter((x) => x.text.includes('ltpoolvid01'));
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) for (const id of [user, browser.id, token, 'lt-pool']) expect(f.text, f.table).not.toContain(id);
  });

  test('deleting the account leaves nothing that names the user, in any table', async () => {
    const s = await signIn({ sub: 'lt-delete', channel: channelFixture({ channelId: 'UClegaltruthdeletexxxxxx' }) });
    await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
    const app = createApp(makeDeps());
    await app.request('/api/pool/tokens', { method: 'POST', headers: { cookie: s.cookie, origin: APP, 'content-type': 'application/json' }, body: '{}' });
    const user = (await env.DB.prepare("SELECT id, email FROM users WHERE google_sub = 'lt-delete'").first<{ id: string; email: string }>())!;
    // Reachable through normal use: too many rejected uploads pause the account, and an outlier search is counted.
    await env.DB.prepare("INSERT INTO pool_suspensions (user_id, until) VALUES (?, '2099-01-01T00:00:00Z')").bind(user.id).run();
    await env.DB.prepare("INSERT INTO outlier_searches (user_id, day, query) VALUES (?, '2026-11-24', 'q')").bind(user.id).run();
    expect((await rowsContaining(user.id)).length).toBeGreaterThan(3);
    const del = await post(app, '/account/delete', s.cookie, { confirm: 'delete' });
    expect(del.status).toBeLessThan(400);
    for (const needle of [user.id, user.email, 'lt-delete', 'UClegaltruthdeletexxxxxx']) expect(await rowsContaining(needle), needle).toEqual([]);
  });

  test('Ask AI questions and answers are not stored', async () => {
    const id = `lt-ai-${Math.random().toString(36).slice(2, 8)}`;
    await addUser(id, 'pro');
    await env.DB.prepare("INSERT INTO channels (id, user_id, channel_id, title, scopes, refresh_token_enc, status, connected_at, last_verified_at) VALUES (?, ?, ?, 'Mine', 's', 'x', 'active', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')")
      .bind(`ch-${id}`, id, `UC${id}`).run();
    const f = fakeLlm(() => 'ANSWER-zq81-never-stored');
    const app = createApp(makeDeps({ llm: f.llm }, { AI_API_KEY: 'sk-included' } as never));
    const res = await sendJsonReq(app, 'POST', '/api/ai/ask', await sessionCookie(id), { channel: `ch-${id}`, messages: [{ role: 'user', content: 'QUESTION-zq81-never-stored' }] });
    expect(f.requests.length, await res.text()).toBeGreaterThan(0);
    expect(await rowsContaining('zq81')).toEqual([]);
  });

  test('the server operator, hosting and pool text follow how this server is set up', async () => {
    const hosted = await page('/privacy', {}, { SELF_HOSTED: 'false' });
    expect(hosted).toContain('Cloudflare');
    expect(hosted).toContain('opt in to the data pool');
    const self = await page('/privacy', {}, { SELF_HOSTED: 'true' });
    expect(self).not.toContain('Cloudflare');
    expect(self).not.toContain('opt in to the data pool');
    expect(self).toContain('The extension from the Chrome Web Store and Edge Add-ons never sends anything to this server');
  });

  test('DataForSEO is named only when this server uses it', async () => {
    expect(await page('/privacy', { keywords: noProvider('off') })).not.toContain('DataForSEO');
    expect(await page('/privacy', { keywords: dataForSeoProvider(fetch, { login: 'l', password: 'p' }) })).toContain('DataForSEO');
  });

  test('Stripe is named only when billing is on', async () => {
    expect(await page('/privacy')).not.toContain('Stripe');
  });

  test('the revocation link is the one YouTube API Services policy names', async () => {
    expect(await page('/privacy')).toContain('href="https://security.google.com/settings/security/permissions"');
  });

  test('legal notice: operator name, address and email when set; says what is missing otherwise', async () => {
    const set = await page('/imprint', {}, { OPERATOR_NAME: 'Example GmbH', OPERATOR_ADDRESS: 'Musterstr. 1\n12345 Berlin\nGermany', CONTACT_EMAIL: 'hi@example.com' } as never);
    expect(set).toContain('Example GmbH');
    expect(set).toContain('Musterstr. 1<br/>12345 Berlin<br/>Germany');
    expect(set).toContain('href="mailto:hi@example.com"');
    const unset = await page('/imprint');
    expect(unset).toContain("The operator of this server hasn't set a postal address.");
  });

  test('every server page links privacy, terms and legal notice', async () => {
    for (const path of ['/', '/privacy', '/terms', '/imprint']) {
      const html = await page(path);
      for (const href of ['/privacy', '/terms', '/imprint']) expect(html, `${path} → ${href}`).toContain(`href="${href}"`);
    }
  });
});
