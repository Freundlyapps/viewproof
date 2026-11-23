// Keeps billing + users.plan in step with a Stripe subscription (plan 7). users.plan is what every limit reads.
import type { Deps } from '../app';
import type { StripeSub } from './stripe';

/** Statuses that keep Pro. past_due keeps it while Stripe retries the card; the page asks for a new one. */
const PRO_STATUSES = new Set(['active', 'trialing', 'past_due']);
/** Subscriptions Stripe would still charge. */
export const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);
const iso = (sec: number) => new Date(sec * 1000).toISOString();

export function periodEndOf(sub: StripeSub): string | null {
  const ends = (sub.items?.data ?? []).map((i) => i.current_period_end).filter((n) => typeof n === 'number');
  return ends.length ? iso(Math.max(...ends)) : null;
}
/** When Pro ends if nothing changes: cancel_at (flexible billing) or the period end when cancel_at_period_end. */
export function cancelAtOf(sub: StripeSub): string | null {
  if (typeof sub.cancel_at === 'number') return iso(sub.cancel_at);
  return sub.cancel_at_period_end ? periodEndOf(sub) : null;
}

/** The user a subscription belongs to: our billing row for its customer, else the user id we put in its metadata. */
export async function userForCustomer(deps: Deps, customerId: string, hint?: string | null): Promise<string | null> {
  const row = await deps.db.prepare('SELECT user_id FROM billing WHERE customer_id = ?').bind(customerId).first<{ user_id: string }>();
  if (row) return row.user_id;
  if (!hint) return null;
  return (await deps.db.prepare('SELECT id FROM users WHERE id = ?').bind(hint).first<{ id: string }>())?.id ?? null;
}

export async function syncSubscription(deps: Deps, sub: StripeSub, userIdHint?: string | null): Promise<boolean> {
  // Another product sold on the same Stripe account is not ViewProof Pro.
  const priceId = deps.config.billing?.priceId;
  if (priceId && !(sub.items?.data ?? []).some((i) => i.price?.id === priceId)) return false;
  const userId = await userForCustomer(deps, sub.customer, userIdHint ?? sub.metadata?.user_id);
  if (!userId) return false;
  // A late event about an older, ended subscription must not replace the one still running.
  const cur = await deps.db.prepare('SELECT subscription_id, status FROM billing WHERE user_id = ?').bind(userId).first<{ subscription_id: string | null; status: string | null }>();
  if (cur?.subscription_id && cur.subscription_id !== sub.id && LIVE_STATUSES.has(cur.status ?? '') && !LIVE_STATUSES.has(sub.status)) return false;
  const now = new Date(deps.now()).toISOString();
  const plan = PRO_STATUSES.has(sub.status) ? 'pro' : 'free';
  await deps.db.batch([
    deps.db.prepare(
      `INSERT INTO billing (user_id, customer_id, subscription_id, status, period_end, cancel_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET customer_id = excluded.customer_id, subscription_id = excluded.subscription_id, status = excluded.status,
         period_end = excluded.period_end, cancel_at = excluded.cancel_at, updated_at = excluded.updated_at`,
    ).bind(userId, sub.customer, sub.id, sub.status, periodEndOf(sub), cancelAtOf(sub), now),
    deps.db.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, userId),
  ]);
  return true;
}
