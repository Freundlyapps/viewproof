# Plan 7 — Billing and plan limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator can upgrade to Pro ($10/month) through Stripe Managed Payments, manage payment and invoices in Stripe's portal, cancel in one click (keeping Pro until the period ends) and see every limit with a counter under Settings → Plan & usage. Every limit in research 09 is enforced as a hard limit, never billed as overage.

**Architecture:** Roadmap row 7.
- `plans.ts` becomes the single limits table (research 09, update 2026-11-20). One `usageSummary()` reads every counter for the Plan & usage page.
- Stripe is called by a small raw-`fetch` client (`apps/api/src/billing/stripe.ts`, form-encoded, HTTP Basic, `Stripe-Version: 2026-11-18.endive`). There is no SDK, so it needs no Node crypto in the Worker. It is injected through `Deps.stripe`, so tests use a fake.
- `users.plan` stays the one column every limit reads. Only the webhook (and account delete) changes it: on each subscription-related event the handler fetches the subscription from Stripe and syncs `billing` + `users.plan`. Re-fetching means events arriving out of order or twice are harmless.
- Stripe sends the renewal reminder emails (Dashboard → Billing → Subscriptions → "Upcoming renewals"), because with Managed Payments Stripe/Link is the merchant and sends all customer billing emails. The app shows the renewal or end date.

**Tech Stack:** TypeScript, Hono on Workers, D1, Web Crypto (webhook HMAC), React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-viewproof-design.md`:
- §8 item 8: "Billing: Free and Pro $10 via Stripe Checkout + Customer Portal; one-click cancel in-app; renewal reminder email; visible usage counters."
- §9: "Limits are hard, shown as counters, never billed as overage."
- Q2: "Stripe Managed Payments (Stripe as merchant of record handles VAT/sales tax)."
- Research 09 (private) limits table plus the 2026-11-20 AI update.
- §15: Settings → Plan & usage, as in `docs/ui/prototype-desktop.html` ("This month … resets", "Your plan", "Invoices & payment", "Cancel plan — One click. You keep Pro until …").

Stripe facts (docs.stripe.com, read 2026-11-23):
- Managed Payments is GA. It is enabled per Checkout Session with `managed_payments[enabled]=true` (API ≥ 2025-03-31.basil) plus the Dashboard switch.
- `mode=subscription` is supported. Do not send `automatic_tax`, `tax_id_collection`, `payment_method_types`, `customer_update[*]` or `invoice_creation`.
- The Product needs an allow-listed tax code (`txcd_10103000`, SaaS personal use).
- `current_period_end` now lives on `items.data[].current_period_end`.
- Cancel is `cancel_at_period_end=true`. Flexible billing mode reports it as `cancel_at`.
- Customers can also cancel on link.com, so webhooks are the source of truth.
- Webhook signature: HMAC-SHA256 with the `whsec_` secret over `` `${t}.${rawBody}` ``. Any `v1` may match. Tolerance is 300 s.

## Global Constraints

- **Limits (hosted; self-hosted = no limit for all):**

  | Feature | Free | Pro |
  |---|---|---|
  | Connected channels | 1 | 3 |
  | Competitor channels tracked | 3 | 25 |
  | New paid keyword lookups | 5 / month | 60 / month |
  | Outlier searches | 10 / day | no limit |
  | Included AI quick actions | 20 / month | 500 / month |
  | Included AI coach | 0 | 150 / month |

  - Keyword lookups already in the 30-day cache are free and don't count.
  - The daily abuse caps (`DAILY_ADDS` competitor lookups, MCP 500/day) stay as they are.
  - The outlier limit counts distinct searches per UTC day: repeating the same query is free. MCP calls don't count against it, because MCP has its own daily cap (research 09: "BYO AI key or MCP — unlimited").
- **Downgrades never delete data.** Channels and competitors above the new limit stay readable; only adding more is refused.
- **Limit copy** names the limit and the way out. For a free user on a server with billing it ends with " Upgrade to Pro in Settings → Plan & usage." Otherwise it has no upsell.
- **Billing is optional.** It is on only when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_ID` are all set and `SELF_HOSTED` is not true. When it is off, billing routes answer 404 `{error:'billing_off', message:'Billing is not set up on this server.'}` and the page shows plan and usage without buttons.
- **Plan from status:** `active`, `trialing`, `past_due` → `pro`; anything else (or no subscription) → `free`. Stripe retries a failed renewal, and the page says "Payment failed — update your card in Invoices & payment" while `past_due`.
- **Webhook** `POST /api/billing/webhook`:
  - No cookie and no Origin check. The signature is the credential: a bad signature → 400, a timestamp older than 300 s → 400.
  - Event ids are stored, and a repeat → 200 without work.
  - Unknown event types → 200.
- **Account delete** cancels an active subscription at Stripe immediately (`DELETE /v1/subscriptions/{id}`) before removing rows. If Stripe refuses, the delete is refused with the reason, so nobody keeps paying for a deleted account.
- **Secrets** come only from `.dev.vars` or Wrangler secrets, never in chat or in git.

## Review Focus

1. **Forged or replayed webhook:** a wrong signature, a missing header, a stale timestamp or a body changed after signing → 400 and no change. The same event delivered twice → one sync.
2. **Cancel on link.com or in the portal:** `customer.subscription.updated` with a cancel date → the page shows "Pro until <date>" and the plan stays Pro. Then `customer.subscription.deleted` → plan becomes free.
3. **Downgrade with more than the free limits:** a user with 3 channels and 10 competitors becomes free. Everything is still listed, and adding one more is refused with the limit copy.
4. **Checkout while already Pro, or with billing off:** 409 "You already have Pro." or 404 `billing_off`. No Stripe call is made.
5. **Title checker over the outlier limit:** a free user past 10 searches still gets the rule checks. Only the outlier comparison says the limit was reached.

---

### Task 1: One limits table and the usage counters

**Files:**
- Create `packages/db/migrations/0012_billing.sql` (both tables for this plan).
- Modify `apps/api/src/plans.ts`, `apps/api/src/routes/keywords.ts`, `apps/api/src/competitors/routes.ts`, `apps/api/src/pool/outliers.ts`, `apps/api/src/routes/account.ts` (export/delete of new tables), `apps/api/src/routes/connect.ts` (copy).
- Create `apps/api/src/usage.ts`.
- Test `apps/api/test/limits.test.ts`; adjust existing keyword/competitor tests that assumed 50/day or 25.

**Interfaces (produces):**
```ts
// 0012_billing.sql
// usage_counts(user_id → users CASCADE, kind TEXT, period TEXT, count INTEGER NOT NULL, PK(user_id, kind, period))   kind: 'keyword' (period YYYY-MM)
// outlier_searches(user_id → users CASCADE, day TEXT, query TEXT, PK(user_id, day, query))
// billing(user_id PK → users CASCADE, customer_id TEXT UNIQUE NOT NULL, subscription_id TEXT, status TEXT, period_end TEXT, cancel_at TEXT, updated_at TEXT NOT NULL)
// stripe_events(id TEXT PK, received_at TEXT NOT NULL)
export type Plan = 'free' | 'pro';
export type LimitKey = 'channels' | 'competitors' | 'keywordLookups' | 'outlierSearches' | 'aiQuick' | 'aiCoach';
export function limitOf(plan: string, selfHosted: boolean, key: LimitKey): number | null; // null = no limit
export function limitMessage(base: string, plan: string, billingOn: boolean): string;   // appends the upgrade line for free+billing
// usage.ts
export interface UsageRow { key: LimitKey; label: string; used: number; limit: number | null; per: 'total' | 'month' | 'day' }
export async function usageSummary(deps: Deps, userId: string): Promise<{ plan: string; month: string; resetsOn: string; rows: UsageRow[] }>;
```
`maxChannels`, `aiLimit` and `mcpLimit` stay as thin wrappers so existing callers don't change.

- [ ] Test `limits.test.ts` (RED first):
  - `limitOf` returns the table values, and `null` for every key when self-hosted.
  - Free user: the 4th competitor → 422 "You can track up to 3 channels. Upgrade to Pro in Settings → Plan & usage." (with billing env set). Pro user: 25.
  - Free user: 6th new keyword lookup in a month → 429 with the monthly copy. A cached keyword still answers. The next month resets.
  - Free user: 11th distinct outlier query in a day → 429. Repeating the 1st query → 200. Pro → no limit.
  - Downgrade: a free user with 10 competitors rows lists all 10.
  - `usageSummary` for a free user returns 6 rows with correct used/limit/per, and `resetsOn` = first day of the next month.
- [ ] Implement, run `pnpm --filter api test -- limits keywords competitors outliers` → PASS.
- [ ] Commit `feat(api): one plan-limits table, monthly keyword and daily outlier limits`.

### Task 2: Stripe client and the webhook

**Files:**
- Create `apps/api/src/billing/stripe.ts`, `apps/api/src/billing/webhook.ts`, `apps/api/src/billing/sync.ts`.
- Modify `apps/api/src/env.ts` (STRIPE_* vars, `config.billing`), `apps/api/src/app.ts` (Deps.stripe, Origin exemption for the webhook path, routes), `apps/api/src/index.ts`, `apps/api/.dev.vars.example`.
- Test `apps/api/test/billing-webhook.test.ts`, `apps/api/test/fake-stripe.ts`.

**Interfaces (produces):**
```ts
export const STRIPE_VERSION = '2026-11-18.endive';
export interface StripeSub { id: string; customer: string; status: string; cancel_at_period_end: boolean; cancel_at: number | null; items: { data: { current_period_end: number }[] }; metadata: Record<string, string> }
export interface StripeClient {
  checkout(o: { priceId: string; userId: string; email: string | null; customerId: string | null; successUrl: string; cancelUrl: string }): Promise<{ url: string } | { error: string }>;
  portal(customerId: string, returnUrl: string): Promise<{ url: string } | { error: string }>;
  subscription(id: string): Promise<StripeSub | { error: string }>;
  setCancelAtPeriodEnd(id: string, on: boolean): Promise<StripeSub | { error: string }>;
  cancelNow(id: string): Promise<{ ok: true } | { error: string }>;
}
export function httpStripe(fetchFn: typeof fetch, secretKey: string): StripeClient;
export async function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSec: number): Promise<boolean>;
export async function syncSubscription(deps: Deps, sub: StripeSub, userId?: string): Promise<void>; // writes billing + users.plan
// Config: billing: { secretKey, webhookSecret, priceId } | null
// Deps: stripe: StripeClient | null
```
- Checkout params:
  - `mode=subscription`, `line_items[0][price]`, `line_items[0][quantity]=1`, `managed_payments[enabled]=true`.
  - `client_reference_id=userId`, `subscription_data[metadata][user_id]=userId`.
  - `customer` when known, else `customer_email` when known.
  - `success_url` = `${appUrl}/app/settings/plan?checkout=done`, `cancel_url` = `${appUrl}/app/settings/plan`.
- Errors carry Stripe's `error.message` (≤ 200 chars).
- The webhook handles these events: `checkout.session.completed` (save customer, then fetch the subscription), `customer.subscription.created|updated|deleted`, `invoice.paid` and `invoice.payment_failed` (fetch the subscription by id). The user comes from the billing row's `customer_id`, else from `metadata.user_id` or `client_reference_id`.
- `period_end` = max of `items.data[].current_period_end`, as ISO. `cancel_at` = the `cancel_at` timestamp, else `period_end` when `cancel_at_period_end`, else null.

- [ ] Tests (RED first):
  - A signature made with Web Crypto over a sample body verifies. A wrong secret, a changed body, a missing header or a timestamp older than 300 s fails. A header with two `v1` values, one right, passes.
  - A `checkout.session.completed` event → billing row with customer and subscription, and `users.plan='pro'`.
  - The same event id again → no second fetch.
  - `customer.subscription.updated` with `cancel_at_period_end` → plan pro, `cancel_at` set.
  - `customer.subscription.deleted` (fake returns status `canceled`) → plan free.
  - `past_due` stays pro. An event for an unknown customer with no metadata → 200, no change.
  - The webhook path with a foreign Origin and no cookie still reaches the handler.
  - `httpStripe` sends form-encoded bodies with Basic auth and `Stripe-Version`, and includes `managed_payments[enabled]=true` (asserted with a fake fetch).
- [ ] Implement, run `pnpm --filter api test -- billing` → PASS.
- [ ] Commit `feat(api): Stripe client and verified webhook that keeps the plan in sync`.

### Task 3: Billing routes, account delete and export

**Files:**
- Create `apps/api/src/billing/routes.ts`.
- Modify `apps/api/src/routes/account.ts`, `apps/api/src/app.ts`.
- Test `apps/api/test/billing-routes.test.ts`.

**Interfaces (produces):**
```ts
// GET  /api/billing → { enabled: boolean, plan, status: string|null, periodEnd: string|null, cancelAt: string|null, usage: usageSummary(...) }
// POST /api/billing/checkout → 200 {url} | 404 billing_off | 409 {error:'already_pro', message:'You already have Pro.'} | 502 {error:'stripe_failed', message}
// POST /api/billing/portal   → 200 {url} | 404 billing_off | 409 {error:'no_customer', message:'You have no payments yet.'}
// POST /api/billing/cancel   → 200 GET-shape (cancel_at_period_end=true, synced) | 409 {error:'not_pro', message:'You are on the free plan.'}
// POST /api/billing/resume   → 200 GET-shape (false) | 409 not_pro
```
- [ ] Tests (RED first):
  - Signed out → 401.
  - With billing off: GET has `enabled:false` plus usage, and every POST → 404 `billing_off`.
  - Checkout for a free user calls the fake with the user id and email and returns its url. Pro → 409, with no call.
  - Portal without a billing row → 409.
  - Cancel → fake `setCancelAtPeriodEnd(id,true)`, and GET then shows `cancelAt`. Resume clears it.
  - A Stripe error → 502 with its message.
  - Account delete with an active subscription calls `cancelNow` and deletes the user. If `cancelNow` fails, the delete is refused with the reason and the user stays.
  - Export includes `billing` {status, periodEnd, cancelAt} and `usageCounts`.
- [ ] Implement, run `pnpm --filter api test -- billing account` → PASS.
- [ ] Commit `feat(api): checkout, portal, one-click cancel and resume`.

### Task 4: Settings → Plan & usage

**Files:**
- Create `apps/web/src/settings/PlanSettings.tsx`.
- Modify `apps/web/src/Settings.tsx` (route `plan` and card link), `apps/web/src/optimize/TitleChecker.tsx` (show the limit message in place of the comparison if needed), `README.md` (Billing section: Stripe setup with Managed Payments, the tax code, webhook events, "Upcoming renewals" email switch, local test with `stripe listen`), `.dev.vars.example`.
- Test `apps/web/test/plan.test.tsx`.

UI (prototype pane "Plan & usage"):
- **"This month"** card with a "resets <d Mon>" note. Each row is "<label>: N of L <per>" with a meter (warn ≥ 80%), or "N (no limit)". Below it the note: "When you hit a limit, we tell you. You can add your own AI key to keep going. No surprise charges."
- **"Your plan"** card shows Free and Pro side by side.
  - A free user sees "Upgrade to Pro — $10/month". It POSTs checkout, then `window.location.assign(url)`.
  - A Pro user sees "Renews <date>" or "Pro until <date>". The buttons are "Invoices & payment" (portal) and "Cancel plan" (one click) with "One click. You keep Pro until <date>."
  - After cancelling, the user sees "Resume Pro".
  - When `past_due`: callout "Payment failed — update your card in Invoices & payment."
  - On `?checkout=done` while still free: "Payment received. Pro turns on as soon as Stripe confirms it." The page refetches once after 3 s.
  - With billing off: "Billing isn't set up on this server." and no buttons.

- [ ] Tests (RED first):
  - The free user's meters and the upgrade button. Clicking it posts to checkout and assigns the location (stubbed).
  - A Pro user with a renew date, where cancel posts and then shows "Pro until … / Resume Pro".
  - The `past_due` callout.
  - Billing off: no buttons.
  - A server error shows its message.
- [ ] Implement, run `pnpm --filter web test` → PASS. Rebuild, and check `/app/settings/plan` on the dev server.
- [ ] Commit `feat(web): Settings → Plan & usage`.
