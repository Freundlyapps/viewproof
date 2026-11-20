# ViewProof — design

Date: 2026-11-20. Status: draft for the owner's approval.
Evidence base: research notes kept privately by the maintainers; numbers in parentheses such as (03) refer to them.

## 1. Intent

An open-source YouTube growth tool that covers everything vidIQ offers that creators actually value, plus the gaps vidIQ and its competitors leave open. Anyone can download and run it free. The owner also runs a hosted version for $10/month.

Why: creators pay $19–49/month for vidIQ, distrust its numbers, resent credit metering and cancellation traps, and already pay for an AI model that does the "AI" part. No serious open-source alternative exists (largest has 38 stars).

How it wins (from 05 and 07):
1. **Outliers, views per hour and competitor tracking at least as good as vidIQ's** — the features creators pay for.
2. **Honest numbers** — every figure says where it comes from; when we don't know, it says "no data". No 0–100 score without its inputs.
3. **Bring your own AI** (Claude, ChatGPT, Gemini, local) and an MCP server — no second AI subscription.
4. **"What should I make next, and why"** — a decision, not a data dump.
5. **Trust** — minimal permissions, no telemetry by default, one-click cancel, price half of vidIQ's entry plan.

## 2. Goals, non-goals, anti-goals

Goals
- G1 Feature parity with vidIQ on: extension scorecard, keyword research, outliers, competitors, trend alerts, daily ideas, channel audit, optimize existing videos, AI writers (title, description, tags, script), best time to post, MCP.
- G2 Fill gaps: transparent data provenance, BYO AI, decision output, bulk edits with preview and undo, outliers + keywords + own analytics in one place.
- G3 One codebase that runs self-hosted and as the hosted $10 service.
- G4 Build a community data pool that compounds over time (the owner's "one year of data" idea).

Non-goals (v1)
- Instagram, TikTok and other platforms (owner, 2026-11-20: YouTube-only first; other platforms maybe later, as a separate decision — keep platform-specific code behind a `platform` field so adding one later doesn't need a rewrite); human coaching; mobile apps (responsive web instead); video clipping; A/B testing (YouTube Studio has it natively).

Anti-goals — failure even if it works
- Showing invented or unlabelled numbers (vidIQ returns volume for nonsense keywords; we must not).
- Collecting data from users' browsers without their clear, revocable consent.
- Credit metering that surprises users; any billing friction on cancel.
- Impersonating YouTube's own web client to read Studio data (vidIQ does; see 06 §7).
- Server-side scraping of YouTube from our own infrastructure.

## 3. Constraints

- **YouTube API policy** (03): metrics derived from API data are forbidden by default (III.E.4.h); non-authorized API data kept ≤ 30 days; scraping forbidden (III.E.6); default quota 10,000 units/day per project and 100 search calls/day. Owner-authorized Analytics data may be kept while consent is active. Exit for long-term stats: the derived-metrics amendment (III.L) after a Google audit.
- **No real YouTube search volume exists anywhere** (04). All numbers are models; ours must be labelled as such.
- **Chrome Web Store user-data policy** (08): prominent in-product disclosure and consent for any collection; not only in a privacy policy.
- **Money**: the Pro plan must stay profitable at every usage limit.
- **Hosting**: Cloudflare for the hosted service.
- **Owner's rule**: real measurements or an explicit null with a reason, never a plausible placeholder.

## 4. Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | **Website-first + open, opt-in extension data network + official sign-in for own channel** | Matches incumbents on data; legal posture same as vidIQ/TubeBuddy for 10 years but done transparently; cold start | **Chosen** by the owner ("the extension is the key to get the YT data", 2026-11-20) |
| B | Official YouTube API only | Fully compliant; quota makes outliers impossible at scale — loses on the feature people pay for | Rejected |
| C | Server-side scraping from our infrastructure | Most data; breaks YouTube terms outright, datacenter IPs blocked, endangers the hosted business | Rejected |

## 5. System overview

One open-source monorepo (AGPL-3.0), TypeScript throughout.

```
apps/
  web/         React + Vite SPA — the main product (dashboard, research, AI)
  api/         Cloudflare Worker (Hono) — REST API, auth, jobs, billing, MCP endpoint
  extension/   Browser extension, Manifest V3 (WXT) — Chrome, Edge, Firefox
packages/
  core/        Shared scoring, parsers, types — runs in browser and Worker
  db/          D1 schema + migrations
  providers/   Data providers (YouTube OAuth APIs, DataForSEO, RSS, LLM adapters)
```

Runtime (hosted): Workers + D1 (accounts, subscriptions, channels, tracked items, cached reports) + R2 (compressed daily snapshots of the pool, NDJSON.gz partitioned by day) + Queues and Cron (scheduled refreshes, alerts) + Durable Objects (job dispatcher for the extension network, per-user rate limiting) + Stripe.

Self-host: the same Worker runs locally under `wrangler dev` (workerd + Miniflare give local D1/R2/KV/Queues), or deploys to the self-hoster's own free/paid Cloudflare account. One command each; documented in README. Self-hosters supply their own Google OAuth client, optional DataForSEO key, optional LLM key. No pool access.

## 6. Data sources and what each may be used for

| Source | Gives | Rules we follow |
|---|---|---|
| S1 YouTube Analytics + Data API via the creator's Google sign-in | Own channel: views, watch time, retention, traffic sources, **top-25 real search terms per video** (`insightTrafficSourceDetail` with `YT_SEARCH`), audience activity; writes for edits | Kept while consent is active, re-check every 30 days, deletion within 7 days on request. Not pooled across users. Not used to build derived metrics beyond what the policy allows. |
| S2 Extension — passive (opt-in) | Public facts on pages the user visits anyway: video/channel ids, title, view/like/comment counts, subscriber count, upload date, duration, search-result order for searches the user made | Off by default. Consent screen before first collection. Visible log. Data goes to the pool. |
| S3 Extension — jobs (opt-in, separate switch) | Server-assigned public-data fetches run in the user's browser: a channel's video list, a search-result page, search suggestions | Only while a YouTube tab is open and the user is active; ≤ 1 job at a time, ≤ 20 jobs/hour per browser; stop on any 403/429/captcha/consent page and back off for 24 h; uses the page's own public requests — never builds Studio auth headers or rewrites Origin; published list of job types; per-user log page; off switch. |
| S4 YouTube RSS feeds | New uploads of tracked channels | Quota-free; polled by Cron. |
| S5 DataForSEO (licensed vendor) | Clickstream keyword volume + 12-month history, YouTube Trends (relative), YouTube top-20 results | Labelled "estimate — clickstream panel, not YouTube data". Cached 30 days and shared across users. **Blocked on a written OK from DataForSEO for end-user display (09 open item).** |
| S6 LLM providers | Text generation | BYO key any time; hosted default cheap model (Haiku 5.5 class) and deeper model (Sonnet 5.5 class) for coach. |

## 7. Scores (all explainable, all deterministic)

Each score is shown with its inputs and formula on hover/tap. Same inputs → same output. If an input is missing, the score is "no data" with the reason.

- **Views per hour (VPH)** = view delta ÷ hours between two observations; marked "since upload (average)" when only one observation exists.
- **Outlier score** = video views ÷ median views of the channel's previous 20 uploads of the same format (long/Short), shown as "×N". Requires ≥ 5 baseline videos, else "no data". Negative outliers (≤ 0.3×) shown too.
- **Keyword report**: estimated volume (S5, labelled) · relative YouTube interest (S5 Trends) · competition = facts about the top-20 results (median views, median channel subs, % from channels under 10k subs, median age) shown as numbers, plus a plain-language summary — no single opaque 0–100 number. A keyword with no data at every source shows "no data", never a number.
- **Your search terms**: real terms from S1 for the creator's own videos — the only true search data, highlighted as such.
- **Video checklist** (title length, description length, tags, chapters, end screen…) — rule-based, each rule visible and editable.

## 8. Features by phase

Phase 1 — "switchable" (everything a vidIQ user needs to move)
1. Extension scorecard on watch, channel and search pages: VPH, outlier ×N, tags (copy), upload age, checklist; toggle per page type; zero slowdown target (renders after page idle).
2. Sign in with Google, connect up to 3 channels (S1): dashboard, channel audit (30/60/90 days), real search terms, best time to post, underperformers.
3. Keyword reports (S5) with related, questions, matching terms; cached pool reports free.
4. Competitors: track 25 channels; uploads via RSS, stats via pool/extension; top videos by views and VPH; growth graphs from snapshots.
5. Outlier finder over the pool: by keyword, niche, channel size, date, format; click-through to the real video; thumbnail grid preview.
6. AI: titles, descriptions, tags, ideas, coach — each answer states which data it used. BYO key; hosted allowances per 09.
7. MCP server exposing the same research tools (read-only in P1).
8. Billing: Free and Pro $10 via Stripe Checkout + Customer Portal; one-click cancel in-app; renewal reminder email; visible usage counters.
9. Data network consent (S2 passive) + "what my browser contributed" page.
9a. Title checker: rule-based checks (length, keyword position, truncation in search/home preview) plus a comparison with titles of niche outliers; shows every reason, no opaque 0–100 score. Optional AI suggestions labelled as AI.
9b. Small real tools (zero data cost): tag extractor page, chapter validator (YouTube's chapter rules), transcript viewer (fetched in the user's own browser by the extension), engagement-rate and watch-time calculators on the user's numbers.
9c. Earnings: own channel = real `estimatedRevenue` from S1. Other channels = a range only, from user-entered RPM or a cited public RPM range, labelled "estimate"; "no data" when neither exists. No single-number guesses.

Phase 2 — compounding data
10. Extension jobs (S3) with dispatcher, throttles and the public job list.
11. Trend alerts (email) on keywords, channels, VPH thresholds.
12. "Next video" engine: combines own search terms, niche outliers, rising keywords and the channel's past performance into 5 ranked ideas, each with the evidence behind it.
13. Niche browser and public channel stats pages (also drives sign-ups via search).
14. Apply for YouTube quota extension and the III.L amendment.
14a. Keyword tracking + rank checker: a video's position for a keyword over time, observed through S3 jobs or the user's own searches; history from the pool.
14b. Trending / Most Viewed by country and category: fastest-gaining videos by VPH from the pool, labelled "videos our network observed".
14c. Free public channel audit page (public data only) — sign-up driver alongside public stats pages.
14d. Subscriber insights (real, from S1 demographics/activity) and comment insights (recent comments via the creator's own authorized access, summarised by AI with the data shown).
14e. Niche finder: competition as facts about top results (§7), RPM as a cited range, outliers in the niche — no viability score without its inputs.
14g. Content calendar and scheduled AI jobs (e.g. weekly "next video" report), from the logged-in app walkthrough (research note 11).
14f. Thumbnail preview: see your thumbnail and title in a mock YouTube home/search grid next to niche competitors.

Non-goals confirmed from the full inventory (research note 10): channel worth calculator (speculative), handle checker (no reliable source), AI video generator, clipping, Instagram/TikTok tools, minute-level real-time bar (no official source). Small AI writers (hooks, channel description, comment drafts, channel names) are prompts inside the AI writer, not separate pages.

Phase 3 — operations
15. Bulk edits (find/replace in descriptions, add links, tags) with preview, diff and one-click revert — after quota extension.
16. Script writer with channel voice profile; optimize existing videos (suggest → review → publish).
17. Canned comment replies, channel backup/export, comment picker (giveaways).
18. Achievements / milestones from the creator's own data.

## 9. Plans and limits

Free / Pro $10 / Self-hosted limits, set so no plan costs more to serve than it earns. Limits are hard, shown as counters, never billed as overage.

## 10. Privacy and trust

- No telemetry by default; optional self-hostable error reporting.
- Extension host permissions: YouTube domains only (+ the configured server).
- All pooled data is public video/channel facts; no viewer identities, no cookies or tokens leave the browser.
- Users can see, export and delete everything stored about them.

## 11. Risks

| Risk | Mitigation |
|---|---|
| YouTube treats extension collection as breaching its terms (08) | Same posture incumbents hold for 10 years, but transparent; no Studio impersonation; throttled; stop on first block signal; product still works for own-channel + vendor data if the network is switched off. |
| Cold start: pool is empty while users are few | Phase 1 features work without the pool (extension local scores, own channel, vendor keyword reports); pool features improve as users join. |
| DataForSEO refuses end-user display | Fall back to Keyword Tool API (YouTube-labelled, $88/mo pooled) or relative-only signals. |
| YouTube markup changes break parsers silently | Parsers in `packages/core` with fixtures; a canary check that fails loudly when a parser returns zero results. |
| API quota | Phase 1 needs ~10 units/user/day; file the extension early. |

## 12. Decisions settled after the builder check (designer's calls — owner may override)

- **D1 Cold start / extension baseline.** The extension's scorecard needs no pool. It reads the current page and the channel's public RSS feed (latest 15 uploads incl. view counts, quota-free). Outlier baseline = median of those 15 (min 5, same format), so "previous 20" in §7 becomes "previous up to 15". With a single observation, VPH shows "average since upload". The pool improves history and coverage; it is never required for the scorecard.
- **D2 Keyword providers behind an interface.** `packages/providers` defines a `KeywordProvider`; the first one built is the no-vendor path (own search terms from S1, top-results facts gathered by the extension, YouTube search-suggestion order seen in the user's own searches). DataForSEO plugs in when its written OK arrives; Keyword Tool API is the second adapter. Self-hosters without a key get the no-vendor path.
- **D3 Self-host packaging.** Two supported ways: `wrangler dev` locally, or a Docker Compose file that runs the same Worker under workerd with local persistence. No separate Node server. Durable Objects, Queues and Cron run locally via Miniflare/workerd.
- **D4 Browsers.** Phase 1: Chrome + Edge (same build). Firefox in Phase 2.
- **D5 Extension auth.** The extension signs in through the website and receives a scoped, revocable API token. Contributions are tied to the account (needed for the "what my browser contributed" page, rate limits and abuse control). Server URL is configurable for self-hosters. No YouTube cookies or tokens ever leave the browser.
- **D6 Pool integrity.** Ingestion checks: schema validation, plausibility (view counts never decrease; bounded growth rates), cross-check against RSS view counts where available, per-account rate limits; values from a single account that disagree with others are quarantined, not served. Accounts with repeated rejected data lose contribution rights.
- **D7 BYO AI keys.** Stored encrypted server-side (per-user key encryption with a Worker secret) so background features (daily ideas, alert summaries) can run; users can choose "browser-only" mode, which disables background AI features. Self-hosters keep keys in their own environment.
- **D9 Channel connect flow** (from the vidIQ walkthrough, research note 11): after Google returns, show avatar, handle, subscribers and channel id and ask "Is this the right channel?"; explain that Google's chooser may show old brand-account names; a removed channel gets a clear "no longer exists — remove it" state, never a re-auth loop.
- **D8 Google OAuth.** Phase 1 uses read-only scopes (YouTube readonly + Analytics readonly), which need Google's sensitive-scope verification. Launch Phase 1 as a closed beta (≤100 test users) while verification runs. Write scopes (bulk edits) come in Phase 3 with the quota extension.

## 13. Left to the builder

Database schema details, UI layout and visual design, test strategy, CI, exact job-dispatch protocol, cache keys, email provider, i18n approach.

## 14. Open questions for the owner

Decided by the owner, 2026-11-20:
- Q1 **Pool:** owner accepts the extension-collection posture (transparent, opt-in, as in §6). Pool data is kept **3 years, compressed** (R2 NDJSON.gz day partitions; objects older than 36 months deleted by a lifecycle rule).
- Q2 **Billing:** **Stripe Managed Payments** (Stripe as merchant of record handles VAT/sales tax).


## 15. UI (owner-approved 2026-11-20)

- Desktop prototype: `docs/ui/prototype-desktop.html` (v2). Fluid full-width layout, collapsible sidebar, light + dark mode.
- Palette: neutral base (light bg `#FAFAF9` / text `#1C1917`; dark bg `#0F1115` / text `#E7E7EA`), accent teal (`#0F766E` light / `#2DD4BF` dark), highlight amber (`#B45309` / `#F59E0B`) for ×N outlier badges, ESTIMATE labels and near-limit meters. Red/green only for losses/gains and errors.
- Navigation: Home · Research (Keywords, Outliers) · My channel (Overview, Videos, Search terms, Earnings) · Optimize video · Competitors · Ask AI · Tools · Settings (Plan & usage, Channels, AI & apps, Extension & data).
- Provenance labels on every number: REAL (teal), ESTIMATE (amber), AI (dashed).
- Phase 1 has no write-to-YouTube button: Optimize offers "Copy all" + "Open in YouTube Studio" (D8).
- Pricing check against vidIQ's credit table (01 §3a): Pro AI allowance ≈ Boost's 2,000–3,000 credits at about half the price; limits in 09 stay as they are.
