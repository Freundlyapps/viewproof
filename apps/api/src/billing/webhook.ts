// POST /api/billing/webhook (plan 7). No cookie, no Origin check: the Stripe signature is the credential.
// Every subscription-related event re-reads the subscription from Stripe, so duplicates and out-of-order delivery are harmless.
import type { Hono } from 'hono';
import type { Deps } from '../app';
import { isFail, verifyStripeSignature } from './stripe';
import { syncSubscription } from './sync';

export const BILLING_OFF = { error: 'billing_off', message: 'Billing is not set up on this server.' } as const;
type Obj = Record<string, unknown>;
const str = (x: unknown) => (typeof x === 'string' ? x : null);

/** The subscription id an event is about, and a user-id hint from our own fields. */
function subscriptionOf(type: string, o: Obj): { id: string | null; hint: string | null } {
  if (type === 'checkout.session.completed') return { id: str(o.subscription), hint: str(o.client_reference_id) };
  if (type.startsWith('customer.subscription.')) return { id: str(o.id), hint: str((o.metadata as Obj | undefined)?.user_id) };
  if (type === 'invoice.paid' || type === 'invoice.payment_failed') {
    const parent = (o.parent as Obj | undefined)?.subscription_details as Obj | undefined;
    return { id: str(o.subscription) ?? str(parent?.subscription), hint: null };
  }
  return { id: null, hint: null };
}

export function billingWebhook(app: Hono, deps: Deps): void {
  app.post('/api/billing/webhook', async (c) => {
    const billing = deps.config.billing;
    if (!billing || !deps.stripe) return c.json(BILLING_OFF, 404);
    const raw = await c.req.text();
    if (!(await verifyStripeSignature(raw, c.req.header('stripe-signature'), billing.webhookSecret, Math.floor(deps.now() / 1000)))) {
      return c.json({ error: 'bad_request', message: 'Bad signature.' }, 400);
    }
    let ev: { id?: unknown; type?: unknown; data?: { object?: Obj } };
    try {
      ev = JSON.parse(raw);
    } catch {
      return c.json({ error: 'bad_request', message: 'Not JSON.' }, 400);
    }
    const id = str(ev.id);
    const type = str(ev.type) ?? '';
    const o = ev.data?.object ?? {};
    if (!id) return c.json({ error: 'bad_request', message: 'No event id.' }, 400);
    const { id: subId, hint } = subscriptionOf(type, o);
    if (!subId) return c.json({ received: true });
    if (await deps.db.prepare('SELECT 1 FROM stripe_events WHERE id = ?').bind(id).first()) return c.json({ received: true, duplicate: true });
    const sub = await deps.stripe.subscription(subId);
    // Stripe retries on 5xx, so a failed read is retried later rather than lost.
    if (isFail(sub)) return c.json({ error: 'stripe_failed', message: sub.error }, 502);
    await syncSubscription(deps, sub, hint);
    await deps.db.prepare('INSERT OR IGNORE INTO stripe_events (id, received_at) VALUES (?, ?)').bind(id, new Date(deps.now()).toISOString()).run();
    return c.json({ received: true });
  });
}
