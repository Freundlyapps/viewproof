// Stripe over plain fetch (plan 7): form-encoded bodies, HTTP Basic auth, pinned API version. No SDK, so no Node crypto.
export const STRIPE_VERSION = '2026-11-18.endive';
const API = 'https://api.stripe.com/v1';

export interface StripeSub {
  id: string; customer: string; status: string; cancel_at_period_end: boolean; cancel_at: number | null;
  items: { data: { current_period_end: number; price?: { id: string } }[] }; metadata: Record<string, string>;
}
export type StripeFail = { error: string };
export interface CheckoutInput { priceId: string; userId: string; email: string | null; customerId: string | null; successUrl: string; cancelUrl: string }
export interface StripeClient {
  checkout(o: CheckoutInput): Promise<{ url: string } | StripeFail>;
  portal(customerId: string, returnUrl: string): Promise<{ url: string } | StripeFail>;
  subscription(id: string): Promise<StripeSub | StripeFail>;
  setCancelAtPeriodEnd(id: string, on: boolean): Promise<StripeSub | StripeFail>;
  cancelNow(id: string): Promise<{ ok: true } | StripeFail>;
  checkoutSession(id: string): Promise<CheckoutSession | StripeFail>;
  /** Every subscription Stripe has with our user id in its metadata (search API; may lag about a minute). */
  subscriptionsOf(userId: string): Promise<StripeSub[] | StripeFail>;
}
export interface CheckoutSession { client_reference_id: string | null; customer: string | null; subscription: string | null }

export const isFail = (x: object): x is StripeFail => 'error' in x && typeof (x as StripeFail).error === 'string';

export function httpStripe(fetchFn: typeof fetch, secretKey: string): StripeClient {
  async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, form?: Record<string, string>): Promise<T | StripeFail> {
    try {
      const res = await fetchFn(`${API}${path}`, {
        method,
        headers: { authorization: `Basic ${btoa(`${secretKey}:`)}`, 'stripe-version': STRIPE_VERSION, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        ...(form ? { body: new URLSearchParams(form).toString() } : {}),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) return { error: (body?.error?.message ?? `Stripe answered HTTP ${res.status}`).slice(0, 200) };
      return body as T;
    } catch (e) {
      return { error: `Couldn't reach Stripe (${e instanceof Error ? e.message : 'network error'})`.slice(0, 200) };
    }
  }
  return {
    async checkout(o) {
      const form: Record<string, string> = {
        mode: 'subscription', 'line_items[0][price]': o.priceId, 'line_items[0][quantity]': '1', 'managed_payments[enabled]': 'true',
        client_reference_id: o.userId, 'subscription_data[metadata][user_id]': o.userId,
      };
      if (o.customerId) form.customer = o.customerId;
      else if (o.email) form.customer_email = o.email;
      form.success_url = o.successUrl;
      form.cancel_url = o.cancelUrl;
      const r = await call<{ url: string }>('POST', '/checkout/sessions', form);
      return isFail(r) ? r : { url: r.url };
    },
    async portal(customerId, returnUrl) {
      const r = await call<{ url: string }>('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
      return isFail(r) ? r : { url: r.url };
    },
    subscription: (id) => call<StripeSub>('GET', `/subscriptions/${encodeURIComponent(id)}`),
    setCancelAtPeriodEnd: (id, on) => call<StripeSub>('POST', `/subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: String(on) }),
    async checkoutSession(id) {
      const r = await call<CheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
      return isFail(r) ? r : { client_reference_id: r.client_reference_id ?? null, customer: r.customer ?? null, subscription: r.subscription ?? null };
    },
    async subscriptionsOf(userId) {
      const q = new URLSearchParams({ query: `metadata['user_id']:'${userId.replace(/['\\]/g, '')}'`, limit: '100' });
      const r = await call<{ data: StripeSub[] }>('GET', `/subscriptions/search?${q}`);
      return isFail(r) ? r : r.data;
    },
    async cancelNow(id) {
      const r = await call<StripeSub>('DELETE', `/subscriptions/${encodeURIComponent(id)}`);
      return isFail(r) ? r : { ok: true };
    },
  };
}

const TOLERANCE_S = 300;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Stripe-Signature check (docs.stripe.com/webhooks, "verify manually"): HMAC-SHA256 of `${t}.${body}`; any v1 may match; ±300 s. */
export async function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSec: number): Promise<boolean> {
  if (!header) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = /^\d+$/.test(v) ? Number(v) : null;
    else if (k === 'v1') sigs.push(v.toLowerCase());
  }
  if (t === null || !sigs.length) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`)));
  const match = sigs.some((s) => s.length === expected.length && constantTimeEqual(s, expected));
  return match && Math.abs(nowSec - t) <= TOLERANCE_S;
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
