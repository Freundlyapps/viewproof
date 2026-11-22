# Data pool + Outliers (plan 5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People who opt in let their extension share the public facts of videos they see on YouTube. The server checks them, keeps them, and uses them to find videos that beat their channel's usual views: Research → Outliers.

**Architecture:** Roadmap row 5 is split three ways: 5a competitors (merged), **5b pool + Outliers (this plan)**, 5c extension panels on channel and search pages, per-page toggles, checklist.
- **Linking a browser.** The extension sends nothing until it is linked to a ViewProof account and the user has agreed on the extension's consent screen. Linking happens in the web app: Settings → Extension & data → "Link this browser". The server creates a contribution token, which the web app passes to the extension through the existing bridge.
- **What gets sent.** In batches, the extension POSTs observations to `/api/pool/contribute` with `Authorization: Bearer <token>`: from watch pages, video id, channel id, title, views, exact upload time, format and length; from search pages, the same facts minus the exact upload time.
- **Checking (D6).** The server validates each batch, checks that it is plausible, and rate-limits it per token.
- **Storage.** Discovered videos and channels go into the pool tables. Observations are stored with no link to who sent them.
- **Views and ×N.** Pool channels join the plan 5a feed poller with a separate hourly budget. A pool video's views and ×N come from the channel's public RSS feed, the authoritative and quota-free source. So the values a single contributor sent are never served (D6 quarantine by construction). They are kept for history and archived.
- **Archive.** A daily Cron writes yesterday's accepted observations to R2 as NDJSON.gz day partitions, deleted after 36 months by a lifecycle rule (Q1).

**Tech Stack:** as plans 2–5a; R2 binding `POOL`; extension options page (WXT `entrypoints/options/`).

**Spec:** `docs/superpowers/specs/2026-11-20-viewproof-design.md` §6 S2, §7 (outlier score), §8 items 5 and 9, D1, D6, Q1, §15. Roadmap row 5.

## Global Constraints

- **Off by default, every step.** The extension collects nothing until the user (a) agrees on the extension's consent screen and (b) links the browser to an account. Unlinking or switching it off stops sending at once, and the user can clear the extension's queue and log.
- **Public facts only (S2).** Ids, title, view count, upload time or age, length, format. Nothing about the viewer: no cookies, no tokens, no watch time, no search queries. The source field (`watch`/`search`) is the only context.
- **No link between a person and the videos they saw.** Observations are stored without a user or token id. Per token, the server keeps only counters (accepted, rejected, per day).
- **D6 checks:**
  - schema;
  - ids match YouTube's formats;
  - views between 0 and 2e10;
  - the upload time isn't in the future;
  - a video's views never fall more than 1 % below its latest accepted observation;
  - growth since the latest accepted observation is at most 1,000,000 views per hour + 10 %;
  - at most 300 observations per batch and 3,000 per token per UTC day;
  - a token with more than 200 rejected observations in a day is suspended ("Contribution paused: too much data was rejected"), and the next link creates a new token.
- **Served numbers:** views, VPH and ×N on Outliers come only from the channel's public feed (plan 5a `feed_videos` / `video_snapshots`). Labelled REAL · public feed. The page says "Videos our network found", never "all of YouTube".
- **×N:** core `outlierScore` (median of the channel's earlier same-format uploads in its feed; ≥ 5 needed; otherwise no_data with the reason). It is the same function as the extension and Competitors.
- **No hammering:**
  - Pool channels are polled at most once per 3 h each, with a budget of 30 per hourly Cron run, after the user-tracked channels.
  - A pool channel is polled only while a contribution saw it in the last 30 days.
  - Feed fetches per Cron run stay ≤ 45 in total (5a M8: Workers Free allows 50 subrequests).
- **Retention:**
  - D1 observations: 90 days.
  - R2 partitions: 36 months (a lifecycle rule; documented with the exact `wrangler r2 bucket lifecycle add` command).
  - Pool channels not seen for 30 days and not tracked by anyone are pruned.
- **Self-host:** the pool is the server's own (its own users). Without an R2 binding the archive step is skipped, with one log line.

## Review Focus

1. **A forged or garbage batch:** wrong types, bad ids, 10^12 views, future dates, 10,000 items, or a video's views dropping from 1 M to 10 → that item or batch is rejected with counts; nothing served changes. Tests: Task 1 "validate", Task 2 "plausibility" and "batch limits".
2. **A revoked or suspended token, or an account that was deleted** → 401 with a message; the extension stops and shows "Unlinked". Tests: Task 2 "revoked token", Task 5 "401 unlinks".
3. **Consent not given or switched off mid-session** → nothing is queued or sent; queued items are dropped when switched off. Test: Task 5 "consent gates".
4. **A video the pool saw but whose channel feed hasn't been fetched yet, or failed** → Outliers doesn't show it with a made-up ×N. The coverage line counts it as "waiting for its channel's feed". Test: Task 4 "unpolled channel".
5. **Two browsers of the same account, the same video sent twice, or a re-sent batch** → no double counting; idempotent upserts. Test: Task 2 "duplicate".

---

### Task 1: Core — contribution schema, validation, plausibility

**Files:** `packages/core/src/pool.ts`, `packages/core/test/pool.test.ts`, `index.ts`, `api-types.ts`.

**Interfaces:**
- `PoolObservation`:
  ```ts
  { videoId: string; channelId: string; title: string; views: number; publishedAt: string | null; ageDays: number | null;
    durationSec: number | null; format: Format; source: 'watch' | 'search'; observedAt: string }
  ```
- `PoolBatch = { v: 1; observations: PoolObservation[] }`.
- `parseBatch(x: unknown, nowIso: string): { ok: true; items: PoolObservation[]; rejected: { index: number; reason: string }[] } | { ok: false; reason: string }`:
  - `ok: false` when the batch isn't `{ v: 1, observations: [] }` or has > 300 items;
  - per item, the checks in Global Constraints except the history-based ones;
  - `observedAt` within the last 7 days and ≤ now + 5 min.
- `plausible(prev: { views: number; at: string } | null, next: { views: number; at: string }): string | null` returns the rejection reason or null.
- `fromWatch(v: WatchVideo, nowIso)` and `fromSearch(r: SearchResult, nowIso)` produce a `PoolObservation | null`. Search results with no views or no channel id, and live videos, give null.
- api-types:
  ```ts
  ContributeResult { accepted: number; rejected: number; reasons: string[] /* distinct, ≤ 5 */ }
  PoolBrowser { id: string; label: string; createdAt: string; lastUsedAt: string | null; acceptedToday: number; rejectedToday: number; acceptedTotal: number; status: 'active' | 'suspended' }
  OutlierRow = CompetitorVideo & { channelId; channelTitle; channelMedian: Measured<number> }
  Outliers { rows: OutlierRow[]; coverage: { videos: number; channels: number; channelsWaiting: number; days: 30 } }
  ```

- [ ] **Tests:**
  - "validate": a good batch; each bad field gives a reason naming the field; 301 items → `ok: false`.
  - "plausibility": a drop over 1 % rejected; ≤ 1 % allowed; a growth cap; no previous → ok.
  - "from pages": `fromWatch` uses the fixture player; `fromSearch` uses the search fixture (live and no-views results skipped).
- [ ] FAIL → implement → PASS → commit `feat(core): pool contribution schema and checks`.

### Task 2: DB + contribution API

**Files:** `packages/db/migrations/0007_pool.sql`, `packages/db/src/index.ts`, `apps/api/src/pool/{tokens.ts,contribute.ts,routes.ts}`, `app.ts`, `routes/account.ts` (export: browsers; delete cascades), test `apps/api/test/pool.test.ts`.

**Schema:**
- `pool_tokens(id PK, id_hash UNIQUE, user_id → users CASCADE, label, created_at, last_used_at, status)`
- `pool_token_days(token_id → pool_tokens CASCADE, day, accepted, rejected, PK(token_id, day))`
- `pool_videos(video_id PK, channel_id, title, published_at NULL, format, duration_sec NULL, first_seen_at, last_seen_at)`
- `pool_channels(channel_id PK, first_seen_at, last_seen_at)`
- `pool_observations(video_id, at, views, source, PK(video_id, at))`

**Routes** (all JSON):
- `POST /api/pool/tokens` (session + origin check) → 201 `{ token, browser: PoolBrowser }`. The token is 32 random bytes in base64url; only its SHA-256 is stored. Label from the body (≤ 40 chars) or "Browser".
- `GET /api/pool/browsers` → `PoolBrowser[]`.
- `DELETE /api/pool/browsers/:id` → 204.
- `POST /api/pool/contribute`. Bearer token only, no cookie; CORS: no `Access-Control-Allow-Origin` (extensions use host permissions).
  - 401 `{ error: 'signed_out', message: 'This browser is not linked. Link it again in ViewProof → Settings → Extension & data.' }`;
  - 403 `{ error: 'limit', message: 'Contribution paused: too much data was rejected.' }` when suspended;
  - 429 when over the daily limit;
  - 400 when the batch is unreadable;
  - 200 `ContributeResult` otherwise.
  - Accepted items:
    - upsert `pool_videos`: title and last_seen; `published_at` only if it was null and the item has one;
    - upsert `pool_channels`;
    - insert `pool_observations` (OR IGNORE).
  - Counters go to `pool_token_days`.
  - The contribute route is exempt from the cookie-origin CSRF middleware: it carries no cookie, and the bearer token is the credential.

- [ ] **Tests:**
  - "link, list, revoke";
  - "contribute accepted";
  - "plausibility against stored history";
  - "batch limits" (301 → 400; daily cap → 429);
  - "duplicate" (same batch twice: observations once, counts accepted both times, no error);
  - "suspended after 200 rejections";
  - "revoked token" → 401;
  - "deleted account" → 401;
  - "no user id on observations" (columns of `pool_observations`/`pool_videos` checked via `PRAGMA table_info`);
  - "contribute ignores cookies".
- [ ] FAIL → implement → PASS (file + whole api suite) → commit `feat(api): pool tokens and contribution with D6 checks`.

### Task 3: Pool feed polling, prune, R2 archive

**Files:**
- `apps/api/src/competitors/poll.ts`: `pollStale` gains a `scope: 'tracked' | 'pool'`. Pool channels are rows in `tracked_channels` that are referenced by `pool_channels` and not by `user_competitors`.
- `apps/api/src/pool/archive.ts`
- `apps/api/src/competitors/cron.ts`
- `wrangler.toml`: `[[r2_buckets]] binding = "POOL"`
- `env.ts`
- test `apps/api/test/pool-cron.test.ts`

**Behaviour:**
- **Contribution side:** a contribution that adds a new `pool_channels` row also inserts a `tracked_channels` row (title from the observation's channel name when known, else the id), so the poller can see it.
- **Cron run:**
  1. tracked channels, budget 30;
  2. pool channels seen ≤ 30 days ago, budget 15;
  3. at 03 UTC, stats;
  4. at 04 UTC, archive yesterday's `pool_observations` to `pool/YYYY/MM/DD.ndjson.gz`. Skip when the object exists. One JSON line per observation (`videoId, channelId, at, views, source`; channel from `pool_videos`).
  5. Prune:
     - `pool_observations` older than 90 days;
     - `pool_channels` not seen for 30 days;
     - `pool_videos` of removed channels;
     - `tracked_channels` referenced by neither a user nor the pool.

- [ ] **Tests:**
  - "pool channel gets polled after tracked ones, within budgets";
  - "pruned pool channel stops being polled";
  - "archive writes gz NDJSON once" (read back from the test R2 binding, decompress, parse);
  - "no R2 binding → skipped".
- [ ] FAIL → implement → PASS → commit `feat(api): pool feeds, archive and retention`.

### Task 4: Outliers API

**Files:** `apps/api/src/pool/outliers.ts`, routes, test `apps/api/test/outliers.test.ts`.

**`GET /api/outliers`** (signed in). Query parameters:
- `q` (optional keyword, whole-word match on the title with core `containsKeyword`);
- `format=any|long|short`;
- `days=7|30|90|365` (upload age, default 30);
- `size=any|small|medium|large`: the channel's median feed views, < 10k / 10k–100k / > 100k;
- `min=1.5|2|3|5|10` (default 2).

**Behaviour:**
- **Candidates:** `pool_videos` whose channel has a successful feed poll and whose video is in that feed (`feed_videos`).
- **Values:** each is built with core `videoStats` from its snapshots and feed (same as Competitors).
- **Filter and sort:** `outlier ≥ min`, sorted by ×N descending, up to 100.
- **Coverage:** counts over pool videos seen in 30 days, incl. `channelsWaiting` = pool channels without a successful feed poll.
- **Rate limit:** a request triggers no feed fetches.

- [ ] **Tests:**
  - "outlier found and sorted";
  - "filters: format, days, size, q";
  - "unpolled channel" (not listed; counted as waiting);
  - "below min or no_data ×N not listed";
  - "signed out 401".
- [ ] FAIL → implement → PASS → commit `feat(api): outliers over the pool`.

### Task 5: Extension — consent, link, queue, send, log

**Files:**
- `apps/extension/src/pool.ts`: `poolState` (consent, token, server, queue ≤ 1,000, log ≤ 500 entries, status) over `chrome.storage.local`; `enqueue`; `flush(fetchFn, now)`.
- `entrypoints/options/{index.html,main.ts}`: consent screen, switch, linked status, Unlink, "What my browser shared" log, Clear.
- `entrypoints/youtube.content.ts`: enqueue `fromWatch` / `fromSearch` when consent is given and the browser is linked.
- `entrypoints/background.ts`:
  - flush every 5 min (`chrome.alarms`) and when the queue reaches 50;
  - handle `viewproof:link` from the bridge.
- `src/app-bridge.ts` and `viewproof-app.content.ts`: `{ type: 'viewproof:link', id, token, server }` → stored, answer `linked`.
- `wxt.config.ts`:
  - `permissions: ['storage', 'alarms']`;
  - `host_permissions: ['https://viewproof.app/*']`, plus localhost in the dev build;
  - `options_ui`.
- Tests: `test/pool.test.ts`, `test/app-bridge.test.ts`.

**Consent text** (exact, options page):
- "Share public video facts with ViewProof's data pool".
- Bullets:
  - "What is sent: video and channel ids, title, view count, upload time or age, length, Short or long — from YouTube pages you open.";
  - "Never sent: who you are on YouTube, cookies, what you watch for how long, your searches.";
  - "Sent to: the ViewProof server this browser is linked to. You can see every item below and stop at any time."
- Button "I agree — start sharing".

- [ ] **Tests:**
  - "consent gates" (no consent or no token → enqueue no-ops; switching off clears the queue);
  - "flush sends a batch and logs it";
  - "401 unlinks";
  - "network error keeps the queue";
  - "queue cap drops oldest";
  - "link message stored only from app origins".
- [ ] FAIL → implement → PASS; build both builds (ASCII check passes) → commit `feat(extension): opt-in pool contribution`.

### Task 6: Web — Extension & data settings, Research → Outliers

**Files:**
- `apps/web/src/settings/ExtensionData.tsx` (a Settings sub-page): "Link this browser" (needs the extension, via `askExtension` hello), a browsers table (label, linked, last used, accepted / rejected today, total, status, Unlink), and what is collected.
- `apps/web/src/research/Outliers.tsx`: filters (keyword, format, uploaded within, channel size, ×N at least), a thumbnail grid (title → YouTube, channel, views, VPH, ×N badge, age), the coverage line, and empty states:
  - no pool data: "Your network hasn't found videos yet. Link your browser in Settings → Extension & data.";
  - none match: "No video beats its channel's usual by ×2 with these filters."
- `Research.tsx`: the Outliers tab is built.
- `extension.ts`: `linkExtension(token, server)`.
- Tests: `apps/web/test/outliers.test.tsx`, `apps/web/test/extension-data.test.tsx`.

- [ ] **Tests:**
  - "outliers grid and filters in the URL";
  - "coverage line and waiting channels";
  - "empty states";
  - "link this browser posts token to extension";
  - "no extension → install message";
  - "unlink".
- [ ] FAIL → implement → PASS, build → commit `feat(web): Outliers and Extension & data`.

### Task 7: Docs, privacy, live check

- [ ] **README:**
  - status;
  - a Data pool section (what is sent, never sent, D6, retention, how to stop);
  - Outliers;
  - the extension's privacy section updated.
- [ ] **api README:**
  - R2 binding;
  - the lifecycle command `npx wrangler r2 bucket lifecycle add viewproof-pool expire-36m --expire-days 1095 -y`;
  - Cron budgets;
  - what is stored.
- [ ] **Live check:** the dev extension and dev server.
  1. Link the browser.
  2. Consent.
  3. Open 1 watch page and 1 search page (budget: 2 YouTube pages).
  4. See the log, the server counts, the feed polled by Cron (budget: ≤ 15 feeds), and Outliers rendered.
- [ ] All suites green → commit `docs: data pool and outliers`.
