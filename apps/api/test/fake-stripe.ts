import type { StripeClient, StripeSub } from '../src/billing/stripe';

export const sub = (over: Partial<StripeSub> = {}): StripeSub => ({
  id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, cancel_at: null,
  items: { data: [{ current_period_end: Date.parse('2026-12-21T12:00:00Z') / 1000 }] }, metadata: {}, ...over,
});

/** A Stripe stand-in: subscriptions live in a map; every call is recorded. */
export function fakeStripe(subs: Record<string, StripeSub> = {}, over: Partial<StripeClient> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec = (method: string, args: unknown[]) => calls.push({ method, args });
  const client: StripeClient = {
    checkout: async (o) => (rec('checkout', [o]), { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
    portal: async (customerId, returnUrl) => (rec('portal', [customerId, returnUrl]), { url: 'https://billing.stripe.com/p/session/test_1' }),
    subscription: async (id) => (rec('subscription', [id]), subs[id] ?? { error: `No such subscription: '${id}'` }),
    setCancelAtPeriodEnd: async (id, on) => {
      rec('setCancelAtPeriodEnd', [id, on]);
      const s = subs[id];
      if (!s) return { error: `No such subscription: '${id}'` };
      subs[id] = { ...s, cancel_at_period_end: on };
      return subs[id]!;
    },
    cancelNow: async (id) => (rec('cancelNow', [id]), subs[id] ? ((subs[id] = { ...subs[id]!, status: 'canceled' }), { ok: true as const }) : { error: `No such subscription: '${id}'` }),
    ...over,
  };
  return { client, calls, subs };
}
