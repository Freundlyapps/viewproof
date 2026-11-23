// Final-review fixes for plan 7 (one test per finding).
import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { KeywordTrends } from '@viewproof/core';
import type { KeywordProvider } from '@viewproof/providers';
import { createApp } from '../src/app';
import { syncSubscription } from '../src/billing/sync';
import { APP, addUser, makeDeps, sendJsonReq, sessionCookie } from './helpers';
import { fakeStripe, sub } from './fake-stripe';

const BILLING = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_ID: 'price_x' };
const NOW = Date.parse('2026-11-23T10:00:00Z');
const planOf = async (id: string) => (await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(id).first<{ plan: string }>())!.plan;
const row = (uid: string, cus: string, subId: string, status: string) =>
  env.DB.prepare('INSERT INTO billing (user_id, customer_id, subscription_id, status, updated_at) VALUES (?, ?, ?, ?, ?)').bind(uid, cus, subId, status, '2026-11-20T00:00:00Z').run();

describe('critical: more than one subscription per user', () => {
  test('a late event for an old, ended subscription does not overwrite the live one', async () => {
    await addUser('rv-1', 'pro');
    await row('rv-1', 'cus_rv1b', 'sub_new', 'active');
    const deps = makeDeps({ now: () => NOW });
    await syncSubscription(deps, sub({ id: 'sub_old', customer: 'cus_rv1a', status: 'canceled', metadata: { user_id: 'rv-1' } }), 'rv-1');
    expect(await planOf('rv-1')).toBe('pro');
    expect(await env.DB.prepare("SELECT subscription_id, status FROM billing WHERE user_id = 'rv-1'").first()).toEqual({ subscription_id: 'sub_new', status: 'active' });
  });

  test('checkout is refused while a subscription is still live at Stripe, even on the free plan (unpaid)', async () => {
    await addUser('rv-2');
    await row('rv-2', 'cus_rv2', 'sub_rv2', 'unpaid');
    const s = fakeStripe();
    const app = createApp(makeDeps({ now: () => NOW, stripe: s.client }, BILLING));
    const r = await sendJsonReq(app, 'POST', '/api/billing/checkout', await sessionCookie('rv-2'));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'live_subscription', message: 'Your subscription is still open at Stripe. Settle or cancel it in Invoices & payment first.' });
    expect(s.calls).toHaveLength(0);
  });

  test('back from Checkout: confirm syncs at once from the session, only for its own user', async () => {
    await addUser('rv-3');
    await addUser('rv-3x');
    const subs = { sub_rv3: sub({ id: 'sub_rv3', customer: 'cus_rv3' }) };
    const s = fakeStripe(subs, {}, { cs_rv3: { client_reference_id: 'rv-3', customer: 'cus_rv3', subscription: 'sub_rv3' } });
    const app = createApp(makeDeps({ now: () => NOW, stripe: s.client }, BILLING));
    const other = await sendJsonReq(app, 'POST', '/api/billing/confirm', await sessionCookie('rv-3x'), { sessionId: 'cs_rv3' });
    expect(other.status).toBe(409);
    expect(await planOf('rv-3x')).toBe('free');
    const r = await sendJsonReq(app, 'POST', '/api/billing/confirm', await sessionCookie('rv-3'), { sessionId: 'cs_rv3' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ plan: 'pro', status: 'active' });
    expect(await planOf('rv-3')).toBe('pro');
  });

  test('checkout success url carries the session id placeholder', async () => {
    await addUser('rv-4');
    const s = fakeStripe();
    const app = createApp(makeDeps({ now: () => NOW, stripe: s.client }, BILLING));
    await sendJsonReq(app, 'POST', '/api/billing/checkout', await sessionCookie('rv-4'));
    expect((s.calls[0]!.args[0] as { successUrl: string }).successUrl).toBe(`${APP}/app/settings/plan?checkout=done&session_id={CHECKOUT_SESSION_ID}`);
  });

  test('account delete cancels every live subscription of the user, not only the stored one', async () => {
    await addUser('rv-5', 'pro');
    await row('rv-5', 'cus_rv5b', 'sub_rv5b', 'active');
    const subs = {
      sub_rv5a: sub({ id: 'sub_rv5a', customer: 'cus_rv5a', metadata: { user_id: 'rv-5' } }),
      sub_rv5b: sub({ id: 'sub_rv5b', customer: 'cus_rv5b', metadata: { user_id: 'rv-5' } }),
      sub_rv5c: sub({ id: 'sub_rv5c', customer: 'cus_rv5a', status: 'canceled', metadata: { user_id: 'rv-5' } }),
    };
    const s = fakeStripe(subs);
    const app = createApp(makeDeps({ now: () => NOW, stripe: s.client }, BILLING));
    const cookie = await sessionCookie('rv-5');
    const del = await app.request('/account/delete', { method: 'POST', headers: { origin: APP, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=delete' });
    expect(del.status).toBe(200);
    expect(s.calls.filter((c) => c.method === 'cancelNow').map((c) => c.args[0]).sort()).toEqual(['sub_rv5a', 'sub_rv5b']);
  });
});

describe('important: counting only what the person asked for', () => {
  test('a failed vendor lookup does not use up the monthly keyword limit', async () => {
    await addUser('rv-6');
    const failing: KeywordProvider = { name: 'fake', trends: async () => ({ status: 'failed', reason: 'DataForSEO: timeout.' }) as KeywordTrends };
    const { keywordTrends } = await import('../src/routes/keywords');
    const deps = makeDeps({ keywords: failing, now: () => NOW });
    for (let i = 0; i < 7; i++) expect('limit' in (await keywordTrends(deps, 'rv-6', `f${i}`, 'US'))).toBe(false);
    expect(await env.DB.prepare("SELECT count FROM usage_counts WHERE user_id = 'rv-6'").first<{ count: number }>()).toEqual({ count: 0 });
  });

  test('outlier browsing without a keyword is not counted', async () => {
    await addUser('rv-7');
    const cookie = await sessionCookie('rv-7');
    const app = createApp(makeDeps({ now: () => NOW }, BILLING));
    const filters = ['', '?format=long', '?days=7', '?days=90', '?size=small', '?min=3', '?min=5', '?format=short', '?days=365', '?size=large', '?min=10', '?size=medium'];
    for (const f of filters) expect((await app.request(`/api/outliers${f}`, { headers: { cookie } })).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outlier_searches WHERE user_id = 'rv-7'").first<{ n: number }>()).toEqual({ n: 0 });
  });
});
