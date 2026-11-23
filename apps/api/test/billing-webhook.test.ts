import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { STRIPE_VERSION, httpStripe, verifyStripeSignature } from '../src/billing/stripe';
import { addUser, makeDeps } from './helpers';
import { fakeStripe, sub } from './fake-stripe';

const SECRET = 'whsec_test_secret';
const BILLING = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_ID: 'price_x' };
const NOW = Date.parse('2026-11-23T10:00:00Z');
const T = Math.floor(NOW / 1000);

async function sign(body: string, t = T, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const event = (id: string, type: string, object: object) => JSON.stringify({ id, type, data: { object } });

function setup(subs = {}) {
  const s = fakeStripe(subs);
  const app = createApp(makeDeps({ now: () => NOW, stripe: s.client }, BILLING));
  const send = async (body: string, header?: string, origin?: string) =>
    app.request('/api/billing/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(header === undefined ? {} : { 'stripe-signature': header }), ...(origin ? { origin } : {}) }, body });
  const deliver = async (body: string) => send(body, `t=${T},v1=${await sign(body)}`);
  return { ...s, app, send, deliver };
}
const planOf = async (id: string) => (await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(id).first<{ plan: string }>())!.plan;
const billingOf = (id: string) => env.DB.prepare('SELECT * FROM billing WHERE user_id = ?').bind(id).first<Record<string, string | null>>();

describe('verifyStripeSignature', () => {
  test('accepts a correct signature; rejects wrong secret, changed body, missing header, stale time', async () => {
    const body = '{"id":"evt_1"}';
    const v1 = await sign(body);
    expect(await verifyStripeSignature(body, `t=${T},v1=${v1}`, SECRET, T)).toBe(true);
    expect(await verifyStripeSignature(body, `t=${T},v1=${await sign(body, T, 'whsec_other')}`, SECRET, T)).toBe(false);
    expect(await verifyStripeSignature('{"id":"evt_2"}', `t=${T},v1=${v1}`, SECRET, T)).toBe(false);
    expect(await verifyStripeSignature(body, undefined, SECRET, T)).toBe(false);
    expect(await verifyStripeSignature(body, `t=${T},v1=${v1}`, SECRET, T + 301)).toBe(false);
    expect(await verifyStripeSignature(body, `v1=${v1}`, SECRET, T)).toBe(false);
  });

  test('any one of several v1 values may match, in any order, with unknown entries', async () => {
    const body = '{"id":"evt_3"}';
    expect(await verifyStripeSignature(body, `v0=abc,v1=${'0'.repeat(64)},t=${T},v1=${await sign(body)},x=1`, SECRET, T)).toBe(true);
  });
});

describe('POST /api/billing/webhook', () => {
  test('a bad or missing signature → 400 and nothing changes', async () => {
    await addUser('bw-0');
    const { send, calls } = setup({ sub_1: sub() });
    const body = event('evt_bad', 'checkout.session.completed', { client_reference_id: 'bw-0', customer: 'cus_1', subscription: 'sub_1' });
    expect((await send(body, `t=${T},v1=${'f'.repeat(64)}`)).status).toBe(400);
    expect((await send(body)).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await planOf('bw-0')).toBe('free');
  });

  test('checkout completed → billing row and Pro; the same event again does no work', async () => {
    await addUser('bw-1');
    const { deliver, calls } = setup({ sub_bw1: sub({ id: 'sub_bw1', customer: 'cus_bw1' }) });
    const body = event('evt_c1', 'checkout.session.completed', { client_reference_id: 'bw-1', customer: 'cus_bw1', subscription: 'sub_bw1' });
    expect((await deliver(body)).status).toBe(200);
    expect(await planOf('bw-1')).toBe('pro');
    expect(await billingOf('bw-1')).toMatchObject({ customer_id: 'cus_bw1', subscription_id: 'sub_bw1', status: 'active', period_end: '2026-12-21T12:00:00.000Z', cancel_at: null });
    expect((await deliver(body)).status).toBe(200);
    expect(calls.filter((c) => c.method === 'subscription')).toHaveLength(1);
  });

  test('cancel at period end keeps Pro with an end date; deleted → free; past_due stays Pro', async () => {
    await addUser('bw-2');
    const subs = { sub_bw2: sub({ id: 'sub_bw2', customer: 'cus_bw2' }) };
    const { deliver } = setup(subs);
    await deliver(event('evt_2a', 'checkout.session.completed', { client_reference_id: 'bw-2', customer: 'cus_bw2', subscription: 'sub_bw2' }));
    subs.sub_bw2 = sub({ id: 'sub_bw2', customer: 'cus_bw2', cancel_at_period_end: true });
    await deliver(event('evt_2b', 'customer.subscription.updated', subs.sub_bw2));
    expect(await planOf('bw-2')).toBe('pro');
    expect((await billingOf('bw-2'))!.cancel_at).toBe('2026-12-21T12:00:00.000Z');
    subs.sub_bw2 = sub({ id: 'sub_bw2', customer: 'cus_bw2', status: 'past_due' });
    await deliver(event('evt_2c', 'invoice.payment_failed', { customer: 'cus_bw2', subscription: 'sub_bw2' }));
    expect(await planOf('bw-2')).toBe('pro');
    expect((await billingOf('bw-2'))!.status).toBe('past_due');
    subs.sub_bw2 = sub({ id: 'sub_bw2', customer: 'cus_bw2', status: 'canceled' });
    await deliver(event('evt_2d', 'customer.subscription.deleted', subs.sub_bw2));
    expect(await planOf('bw-2')).toBe('free');
  });

  test('flexible billing: cancel_at is used as the end date', async () => {
    await addUser('bw-3');
    const at = Date.parse('2026-12-10T00:00:00Z') / 1000;
    const subs = { sub_bw3: sub({ id: 'sub_bw3', customer: 'cus_bw3', cancel_at: at, metadata: { user_id: 'bw-3' } }) };
    const { deliver } = setup(subs);
    await deliver(event('evt_3', 'customer.subscription.created', subs.sub_bw3));
    expect(await billingOf('bw-3')).toMatchObject({ customer_id: 'cus_bw3', cancel_at: '2026-12-10T00:00:00.000Z' });
    expect(await planOf('bw-3')).toBe('pro');
  });

  test('unknown customer without metadata, or an unknown event type → 200 and no change', async () => {
    const { deliver } = setup({ sub_x: sub({ id: 'sub_x', customer: 'cus_nobody' }) });
    expect((await deliver(event('evt_4', 'customer.subscription.updated', sub({ id: 'sub_x', customer: 'cus_nobody' })))).status).toBe(200);
    expect(await env.DB.prepare("SELECT 1 FROM billing WHERE customer_id = 'cus_nobody'").first()).toBeNull();
    expect((await deliver(event('evt_5', 'product.created', {}))).status).toBe(200);
  });

  test('a foreign Origin with no cookie still reaches the handler (the signature is the credential)', async () => {
    const { send } = setup();
    const body = event('evt_6', 'product.created', {});
    expect((await send(body, `t=${T},v1=${await sign(body)}`, 'https://evil.example')).status).toBe(200);
  });

  test('billing off → 404', async () => {
    const app = createApp(makeDeps({ now: () => NOW }));
    const r = await app.request('/api/billing/webhook', { method: 'POST', body: '{}' });
    expect(r.status).toBe(404);
  });
});

describe('httpStripe', () => {
  test('form-encoded, Basic auth, pinned version, managed payments on', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/x' }), { status: 200 });
    }) as unknown as typeof fetch;
    const s = httpStripe(fetchFn, 'sk_test_abc');
    expect(await s.checkout({ priceId: 'price_1', userId: 'u1', email: 'a@example.com', customerId: null, successUrl: 'https://app/s', cancelUrl: 'https://app/c' })).toEqual({ url: 'https://checkout.stripe.com/x' });
    const { url, init } = seen[0]!;
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const h = new Headers(init.headers);
    expect(h.get('authorization')).toBe(`Basic ${btoa('sk_test_abc:')}`);
    expect(h.get('stripe-version')).toBe(STRIPE_VERSION);
    expect(h.get('content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({
      mode: 'subscription', 'line_items[0][price]': 'price_1', 'line_items[0][quantity]': '1', 'managed_payments[enabled]': 'true',
      client_reference_id: 'u1', 'subscription_data[metadata][user_id]': 'u1', customer_email: 'a@example.com', success_url: 'https://app/s', cancel_url: 'https://app/c',
    });
  });

  test('a Stripe error comes back with its message', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { message: 'No such price: price_1' } }), { status: 400 })) as unknown as typeof fetch;
    expect(await httpStripe(fetchFn, 'sk').checkout({ priceId: 'price_1', userId: 'u', email: null, customerId: 'cus_1', successUrl: 's', cancelUrl: 'c' })).toEqual({ error: 'No such price: price_1' });
  });
});
