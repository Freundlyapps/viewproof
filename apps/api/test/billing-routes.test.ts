import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { APP, addUser, makeDeps, sendJsonReq, sessionCookie } from './helpers';
import { fakeStripe, sub } from './fake-stripe';

const BILLING = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_ID: 'price_x' };
const NOW = Date.parse('2026-11-23T10:00:00Z');

async function proUser(id: string, subs: Record<string, ReturnType<typeof sub>>) {
  await addUser(id, 'pro');
  subs[`sub_${id}`] = sub({ id: `sub_${id}`, customer: `cus_${id}` });
  await env.DB.prepare("INSERT INTO billing (user_id, customer_id, subscription_id, status, period_end, cancel_at, updated_at) VALUES (?, ?, ?, 'active', '2026-12-21T12:00:00.000Z', NULL, '2026-11-21T00:00:00Z')")
    .bind(id, `cus_${id}`, `sub_${id}`).run();
  return sessionCookie(id);
}
function setup(subs: Record<string, ReturnType<typeof sub>> = {}, over = {}) {
  const s = fakeStripe(subs, over);
  return { ...s, app: createApp(makeDeps({ now: () => NOW, stripe: s.client }, BILLING)) };
}

describe('billing routes', () => {
  test('signed out → 401', async () => {
    const { app } = setup();
    expect((await app.request('/api/billing')).status).toBe(401);
    expect((await sendJsonReq(app, 'POST', '/api/billing/checkout', '')).status).toBe(401);
  });

  test('billing off: GET says so with usage; every POST → 404 billing_off', async () => {
    await addUser('br-off');
    const cookie = await sessionCookie('br-off');
    const app = createApp(makeDeps({ now: () => NOW }));
    const g = await (await app.request('/api/billing', { headers: { cookie } })).json<{ enabled: boolean; plan: string; usage: { rows: unknown[] } }>();
    expect(g).toMatchObject({ enabled: false, plan: 'free', status: null, periodEnd: null, cancelAt: null });
    expect(g.usage.rows).toHaveLength(6);
    for (const p of ['checkout', 'portal', 'cancel', 'resume']) {
      const r = await sendJsonReq(app, 'POST', `/api/billing/${p}`, cookie);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'billing_off', message: 'Billing is not set up on this server.' });
    }
  });

  test('checkout for a free user returns the Stripe url; Pro gets 409 and no call', async () => {
    await addUser('br-1');
    const subs = {};
    const { app, calls } = setup(subs);
    const r = await sendJsonReq(app, 'POST', '/api/billing/checkout', await sessionCookie('br-1'));
    expect(await r.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(calls[0]).toEqual({ method: 'checkout', args: [{ priceId: 'price_x', userId: 'br-1', email: 'br-1@example.com', customerId: null, successUrl: `${APP}/app/settings/plan?checkout=done`, cancelUrl: `${APP}/app/settings/plan` }] });
    const pro = await proUser('br-2', subs);
    const r2 = await sendJsonReq(app, 'POST', '/api/billing/checkout', pro);
    expect(r2.status).toBe(409);
    expect(await r2.json()).toEqual({ error: 'already_pro', message: 'You already have Pro.' });
    expect(calls).toHaveLength(1);
  });

  test('a returning customer checks out with their customer id', async () => {
    await addUser('br-3');
    await env.DB.prepare("INSERT INTO billing (user_id, customer_id, subscription_id, status, updated_at) VALUES ('br-3', 'cus_br3', 'sub_old', 'canceled', '2026-11-01T00:00:00Z')").run();
    const { app, calls } = setup();
    await sendJsonReq(app, 'POST', '/api/billing/checkout', await sessionCookie('br-3'));
    expect((calls[0]!.args[0] as { customerId: string }).customerId).toBe('cus_br3');
  });

  test('portal: needs a customer; returns the Stripe url', async () => {
    await addUser('br-4');
    const subs = {};
    const { app, calls } = setup(subs);
    const r = await sendJsonReq(app, 'POST', '/api/billing/portal', await sessionCookie('br-4'));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'no_customer', message: 'You have no payments yet.' });
    const pro = await proUser('br-5', subs);
    expect(await (await sendJsonReq(app, 'POST', '/api/billing/portal', pro)).json()).toEqual({ url: 'https://billing.stripe.com/p/session/test_1' });
    expect(calls[0]).toEqual({ method: 'portal', args: ['cus_br-5', `${APP}/app/settings/plan`] });
  });

  test('one-click cancel keeps Pro until the period end; resume clears it; free → 409', async () => {
    const subs: Record<string, ReturnType<typeof sub>> = {};
    const { app, calls } = setup(subs);
    const cookie = await proUser('br-6', subs);
    const c = await sendJsonReq(app, 'POST', '/api/billing/cancel', cookie);
    expect(c.status).toBe(200);
    expect(await c.json()).toMatchObject({ enabled: true, plan: 'pro', status: 'active', periodEnd: '2026-12-21T12:00:00.000Z', cancelAt: '2026-12-21T12:00:00.000Z' });
    expect(calls.at(-1)).toEqual({ method: 'setCancelAtPeriodEnd', args: ['sub_br-6', true] });
    const g = await (await app.request('/api/billing', { headers: { cookie } })).json();
    expect(g).toMatchObject({ cancelAt: '2026-12-21T12:00:00.000Z' });
    const r = await (await sendJsonReq(app, 'POST', '/api/billing/resume', cookie)).json();
    expect(r).toMatchObject({ plan: 'pro', cancelAt: null });
    await addUser('br-7');
    const f = await sendJsonReq(app, 'POST', '/api/billing/cancel', await sessionCookie('br-7'));
    expect(f.status).toBe(409);
    expect(await f.json()).toEqual({ error: 'not_pro', message: 'You are on the free plan.' });
  });

  test('a Stripe error → 502 with its message', async () => {
    await addUser('br-8');
    const { app } = setup({}, { checkout: async () => ({ error: 'No such price: price_x' }) });
    const r = await sendJsonReq(app, 'POST', '/api/billing/checkout', await sessionCookie('br-8'));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: 'stripe_failed', message: 'No such price: price_x' });
  });
});

describe('account delete and export with billing', () => {
  const del = (app: ReturnType<typeof createApp>, cookie: string) =>
    app.request('/account/delete', { method: 'POST', headers: { origin: APP, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=delete' });

  test('delete cancels an active subscription at Stripe first', async () => {
    const subs: Record<string, ReturnType<typeof sub>> = {};
    const { app, calls } = setup(subs);
    const cookie = await proUser('bd-1', subs);
    const exp = await (await app.request('/account/export', { headers: { cookie } })).json<{ billing: unknown; usageCounts: unknown[] }>();
    expect(exp.billing).toEqual({ status: 'active', periodEnd: '2026-12-21T12:00:00.000Z', cancelAt: null });
    expect(exp.usageCounts).toEqual([]);
    expect((await del(app, cookie)).status).toBe(200);
    expect(calls.at(-1)).toEqual({ method: 'cancelNow', args: ['sub_bd-1'] });
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE id = 'bd-1'").first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM billing WHERE user_id = 'bd-1'").first()).toBeNull();
  });

  test('if Stripe refuses, the account is not deleted and the reason is shown', async () => {
    const subs: Record<string, ReturnType<typeof sub>> = {};
    const { app } = setup(subs, { cancelNow: async () => ({ error: 'Stripe is down' }) });
    const cookie = await proUser('bd-2', subs);
    const r = await del(app, cookie);
    expect(r.status).toBe(502);
    expect(await r.text()).toContain('Stripe is down');
    expect(await env.DB.prepare("SELECT 1 FROM users WHERE id = 'bd-2'").first()).not.toBeNull();
  });

  test('a canceled subscription needs no Stripe call', async () => {
    const { app, calls } = setup();
    await addUser('bd-3');
    await env.DB.prepare("INSERT INTO billing (user_id, customer_id, subscription_id, status, updated_at) VALUES ('bd-3', 'cus_bd3', 'sub_bd3', 'canceled', '2026-11-01T00:00:00Z')").run();
    expect((await del(app, await sessionCookie('bd-3'))).status).toBe(200);
    expect(calls).toHaveLength(0);
  });
});
