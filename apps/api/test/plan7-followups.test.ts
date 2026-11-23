// Plan 7 follow-ups: the deferred minors from the final review, one test each.
import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import feedXml from '../../../packages/core/test/fixtures/feed-long.xml?raw';
import { createApp } from '../src/app';
import { runCron } from '../src/competitors/cron';
import { syncSubscription } from '../src/billing/sync';
import { APP, addUser, makeDeps, readText, sendJsonReq, sessionCookie } from './helpers';
import { fakeStripe, sub } from './fake-stripe';

const BILLING = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_ID: 'price_x' };
const NOW = Date.parse('2026-11-23T10:00:00Z');
const VERI = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const idN = (n: number) => `UC${String(n).padStart(22, '0')}`;
const feed = (id: string) => feedXml.replaceAll(VERI, id).replaceAll('HnyfMqiRRG1u-2MsSQLbXA', id.slice(2)).replace(/<yt:videoId>([\w-]+)<\/yt:videoId>/g, (_m: string, v: string) => `<yt:videoId>${id.slice(-4)}${v}</yt:videoId>`);
const planOf = async (id: string) => (await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(id).first<{ plan: string }>())!.plan;
const addChannel = (uid: string, ch: string) => env.DB.prepare(
  "INSERT INTO channels (id, user_id, platform, channel_id, title, handle, avatar_url, scopes, refresh_token_enc, status, connected_at, last_verified_at) VALUES (?, ?, 'youtube', ?, ?, NULL, NULL, 'x', 'enc', 'active', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')",
).bind(`row-${ch}`, uid, ch, `Title ${ch}`).run();

describe('competitor limit', () => {
  test('parallel adds cannot take a free user past 3', async () => {
    await addUser('fu-c1');
    const cookie = await sessionCookie('fu-c1');
    const app = createApp(makeDeps({ now: () => NOW, fetchFeed: async (id) => ({ ok: true, xml: feed(id) }) }));
    await Promise.all([1, 2, 3, 4, 5].map((i) => sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(300 + i) })));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM user_competitors WHERE user_id = 'fu-c1'").first<{ n: number }>())!.n).toBe(3);
  }, 60_000);

  test('a user at the limit is refused before any lookup is spent', async () => {
    await addUser('fu-c2');
    const cookie = await sessionCookie('fu-c2');
    let fetched = 0;
    const app = createApp(makeDeps({ now: () => NOW, fetchFeed: async (id) => (fetched++, { ok: true, xml: feed(id) }) }));
    for (let i = 1; i <= 3; i++) await sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(310 + i) });
    fetched = 0;
    const r = await sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(320) });
    expect(r.status).toBe(422);
    expect(fetched).toBe(0);
    expect((await env.DB.prepare("SELECT count FROM competitor_lookups WHERE user_id = 'fu-c2'").first<{ count: number }>())!.count).toBe(3);
  }, 60_000);
});

describe('channel limit copy', () => {
  test('free with billing names the way up; without billing it does not say "upgrade"', async () => {
    const { channelLimitText } = await import('../src/routes/connect');
    expect(channelLimitText(1, 'free', true)).toBe('Your plan allows 1 channel. Remove one first. Upgrade to Pro in Settings → Plan & usage.');
    expect(channelLimitText(1, 'free', false)).toBe('Your plan allows 1 channel. Remove one first.');
    expect(channelLimitText(3, 'pro', true)).toBe('Your plan allows 3 channels. Remove one first.');
  });
});

describe('billing', () => {
  test('a subscription for another price on the same Stripe account does not change the plan', async () => {
    await addUser('fu-b1');
    await syncSubscription(makeDeps({ now: () => NOW }, BILLING), sub({ id: 'sub_other', customer: 'cus_fub1', metadata: { user_id: 'fu-b1' }, items: { data: [{ current_period_end: 1800000000, price: { id: 'price_other_app' } }] } }), 'fu-b1');
    expect(await planOf('fu-b1')).toBe('free');
    expect(await env.DB.prepare("SELECT 1 FROM billing WHERE user_id = 'fu-b1'").first()).toBeNull();
  });

  test('a stored customer Stripe no longer knows: checkout retries with the email', async () => {
    await addUser('fu-b2');
    await env.DB.prepare("INSERT INTO billing (user_id, customer_id, subscription_id, status, updated_at) VALUES ('fu-b2', 'cus_gone', 'sub_x', 'canceled', '2026-11-01T00:00:00Z')").run();
    const seen: (string | null)[] = [];
    const s = fakeStripe({}, { checkout: async (o) => (seen.push(o.customerId), o.customerId ? { error: "No such customer: 'cus_gone'" } : { url: 'https://checkout.stripe.com/c/pay/cs_ok' }) });
    const app = createApp(makeDeps({ now: () => NOW, stripe: s.client }, BILLING));
    const r = await sendJsonReq(app, 'POST', '/api/billing/checkout', await sessionCookie('fu-b2'));
    expect(await r.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_ok' });
    expect(seen).toEqual(['cus_gone', null]);
  });

  test('the account page warns a Pro user that deleting ends the paid time without a refund', async () => {
    await addUser('fu-b3', 'pro');
    await env.DB.prepare("INSERT INTO billing (user_id, customer_id, subscription_id, status, period_end, updated_at) VALUES ('fu-b3', 'cus_fub3', 'sub_fub3', 'active', '2026-12-21T12:00:00.000Z', '2026-11-01T00:00:00Z')").run();
    const app = createApp(makeDeps({ now: () => NOW, stripe: fakeStripe().client }, BILLING));
    const html = await readText(await app.request('/account', { headers: { cookie: await sessionCookie('fu-b3') } }));
    expect(html).toContain('Deleting also cancels your Pro subscription at once. The rest of the paid period (until 21 Dec 2026) is not refunded.');
  });

  test('processed Stripe events older than 30 days are pruned by the hourly Cron', async () => {
    await env.DB.prepare("INSERT INTO stripe_events (id, received_at) VALUES ('evt_old', '2026-10-01T00:00:00Z'), ('evt_new', '2026-11-20T00:00:00Z')").run();
    await runCron(makeDeps({ now: () => NOW }), new Date(NOW));
    expect((await env.DB.prepare("SELECT id FROM stripe_events WHERE id IN ('evt_old', 'evt_new')").all<{ id: string }>()).results.map((r) => r.id)).toEqual(['evt_new']);
  }, 60_000);

  test('a stale read written after a cancel is corrected by the next event (every change at Stripe sends one)', async () => {
    await addUser('fu-b4', 'pro');
    const subs = { sub_fub4: sub({ id: 'sub_fub4', customer: 'cus_fub4', metadata: { user_id: 'fu-b4' } }) };
    const s = fakeStripe(subs);
    const deps = makeDeps({ now: () => NOW, stripe: s.client }, BILLING);
    await syncSubscription(deps, subs.sub_fub4, 'fu-b4');
    const app = createApp(deps);
    await sendJsonReq(app, 'POST', '/api/billing/cancel', await sessionCookie('fu-b4'));
    await syncSubscription(deps, sub({ id: 'sub_fub4', customer: 'cus_fub4' }), 'fu-b4'); // a webhook that read before the cancel
    expect((await env.DB.prepare("SELECT cancel_at FROM billing WHERE user_id = 'fu-b4'").first<{ cancel_at: string | null }>())!.cancel_at).toBeNull();
    const fresh = await s.client.subscription('sub_fub4');
    await syncSubscription(deps, fresh as typeof subs.sub_fub4, 'fu-b4'); // customer.subscription.updated for the cancel re-reads
    expect((await env.DB.prepare("SELECT cancel_at FROM billing WHERE user_id = 'fu-b4'").first<{ cancel_at: string | null }>())!.cancel_at).toBe('2026-12-21T12:00:00.000Z');
  });
});

describe('downgrade keeps channels', () => {
  test('a Pro user with 3 channels who becomes free still sees all 3, and usage shows 3 of 1', async () => {
    await addUser('fu-d1', 'pro');
    for (const ch of ['UCfud1aaaaaaaaaaaaaaaaaa', 'UCfud1bbbbbbbbbbbbbbbbbb', 'UCfud1cccccccccccccccccc']) await addChannel('fu-d1', ch);
    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = 'fu-d1'").run();
    const app = createApp(makeDeps({ now: () => NOW }));
    const cookie = await sessionCookie('fu-d1');
    expect(await (await app.request('/api/channels', { headers: { cookie } })).json<unknown[]>()).toHaveLength(3);
    const b = await (await app.request('/api/billing', { headers: { cookie } })).json<{ usage: { rows: { key: string; used: number; limit: number }[] } }>();
    expect(b.usage.rows.find((r) => r.key === 'channels')).toMatchObject({ used: 3, limit: 1 });
  });
});

void APP;
