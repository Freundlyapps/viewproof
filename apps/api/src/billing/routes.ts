// Plan & usage API (plan 7): status, Stripe Checkout, Stripe's portal, one-click cancel and resume.
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { readSession } from '../session';
import { usageSummary } from '../usage';
import { isFail } from './stripe';
import { syncSubscription } from './sync';
import { BILLING_OFF } from './webhook';

interface BillingRow { customer_id: string; subscription_id: string | null; status: string | null; period_end: string | null; cancel_at: string | null }
export const billingOf = (deps: Deps, userId: string) =>
  deps.db.prepare('SELECT customer_id, subscription_id, status, period_end, cancel_at FROM billing WHERE user_id = ?').bind(userId).first<BillingRow>();

/** Subscriptions Stripe would still charge (account delete cancels these first). */
export const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);

const err = (c: Context, status: 401 | 404 | 409 | 502, error: string, message: string) => c.json({ error, message }, status);

export function billingRoutes(app: Hono, deps: Deps): void {
  const page = `${deps.config.appUrl}/app/settings/plan`;

  async function status(userId: string) {
    const b = await billingOf(deps, userId);
    const usage = await usageSummary(deps, userId);
    return { enabled: !!deps.config.billing, plan: usage.plan, status: b?.status ?? null, periodEnd: b?.period_end ?? null, cancelAt: b?.cancel_at ?? null, usage };
  }

  /** Session user, or a ready error response. */
  async function guard(c: Context): Promise<string | Response> {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, 'signed_out', 'Sign in first.');
    if (!deps.config.billing || !deps.stripe) return c.json(BILLING_OFF, 404);
    return s.userId;
  }

  app.get('/api/billing', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, 'signed_out', 'Sign in first.');
    return c.json(await status(s.userId));
  });

  app.post('/api/billing/checkout', async (c) => {
    const uid = await guard(c);
    if (uid instanceof Response) return uid;
    const u = await deps.db.prepare('SELECT plan, email FROM users WHERE id = ?').bind(uid).first<{ plan: string; email: string | null }>();
    if (u?.plan === 'pro') return err(c, 409, 'already_pro', 'You already have Pro.');
    const b = await billingOf(deps, uid);
    const r = await deps.stripe!.checkout({ priceId: deps.config.billing!.priceId, userId: uid, email: u?.email ?? null, customerId: b?.customer_id ?? null, successUrl: `${page}?checkout=done`, cancelUrl: page });
    return isFail(r) ? err(c, 502, 'stripe_failed', r.error) : c.json({ url: r.url });
  });

  app.post('/api/billing/portal', async (c) => {
    const uid = await guard(c);
    if (uid instanceof Response) return uid;
    const b = await billingOf(deps, uid);
    if (!b) return err(c, 409, 'no_customer', 'You have no payments yet.');
    const r = await deps.stripe!.portal(b.customer_id, page);
    return isFail(r) ? err(c, 502, 'stripe_failed', r.error) : c.json({ url: r.url });
  });

  for (const [path, on] of [['cancel', true], ['resume', false]] as const) {
    app.post(`/api/billing/${path}`, async (c) => {
      const uid = await guard(c);
      if (uid instanceof Response) return uid;
      const b = await billingOf(deps, uid);
      const plan = (await deps.db.prepare('SELECT plan FROM users WHERE id = ?').bind(uid).first<{ plan: string }>())?.plan;
      if (plan !== 'pro') return err(c, 409, 'not_pro', 'You are on the free plan.');
      if (!b?.subscription_id) return err(c, 409, 'no_subscription', 'Your Pro plan has no subscription to change.');
      const sub = await deps.stripe!.setCancelAtPeriodEnd(b.subscription_id, on);
      if (isFail(sub)) return err(c, 502, 'stripe_failed', sub.error);
      // Show the change now; the webhook that follows writes the same values.
      await syncSubscription(deps, sub, uid);
      return c.json(await status(uid));
    });
  }
}
