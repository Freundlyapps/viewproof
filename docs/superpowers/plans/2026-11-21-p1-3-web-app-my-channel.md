# Web app shell + My channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in creator opens `/app` and sees their connected channel's real YouTube Analytics — Overview, Videos, Search terms, Earnings — in the approved §15 UI, with every number labelled and every gap explained.

**Architecture:** `apps/web` is a React + Vite SPA built into `apps/web/dist/app` and served by the existing Worker through Workers Static Assets at `/app` (same origin, so the `vp_session` cookie and Origin check just work). The Worker gains a YouTube data client, a D1 report cache, and JSON endpoints under `/api/channels/:id/*`. Response types and the pure display rules (needs attention, upload-time grid, periods) live in `packages/core` so API and web share them.

**Tech Stack:** React 19.3, react-router 8.5 (library mode), Vite 8.3 + @vitejs/plugin-react 6.3, Vitest 4.1 + happy-dom 21 + @testing-library/react 16; Hono 4 Worker, D1; YouTube Analytics API v2 `reports.query`, YouTube Data API v3.

**Spec:** `docs/superpowers/specs/2026-11-20-viewproof-design.md` (§3, §6 S1, §7, §8 items 2 and 9c, §10, §15). Plan 2 (merged) provides sign-in, `channels` rows with encrypted refresh tokens, `readSession`, `grants.ts`.

## Global Constraints

- Owner's rule (§3): "real measurements or an explicit null with a reason, never a plausible placeholder." Every number crosses the API as `Measured<T>` from `@viewproof/core`; a missing row is `no_data` with a reason, never `0`.
- YouTube policy III.E.4.h (verified 2026-11-21): clients must not "access or use API Data to create new or derived data or metrics". So My channel shows only values YouTube returns: no % change, no ratios to a median, no views per hour, no RPM, no "best time" score. Comparisons are the previous period's YouTube value shown next to the current one. Plain date facts (days since last upload) and counts of the creator's own uploads are allowed. Derived scores wait for III.L approval (Phase 2, item 14).
- Not in the Analytics API (verified): thumbnail impressions/CTR, any hour-of-day dimension. Do not show CTR; best time to post links to YouTube Studio's audience chart.
- Data lags 48–72 h and recent days are omitted: every report shows "Data through <last date YouTube returned>".
- Provenance labels (§15): REAL (teal) on YouTube values; ESTIMATE (amber) on revenue ("estimated, may change at month end").
- Palette and tokens (§15): light bg `#FAFAF9` / text `#1C1917`; dark bg `#0F1115` / text `#E7E7EA`; accent `#0F766E` / `#2DD4BF`; highlight `#B45309` / `#F59E0B`. Red/green only for losses/gains and errors. Copy CSS tokens from `docs/ui/prototype-desktop.html`.
- Navigation (§15): Home · Research (Keywords, Outliers) · My channel (Overview, Videos, Search terms, Earnings) · Optimize video · Competitors · Ask AI · Tools · Settings. Items not built yet show a `soon` badge and a one-line page saying what they will do — never mock data.
- Caching: report responses in D1 `report_cache` for 6 h; first-week views per video for 30 days (immutable after day 9). Cache rows are removed with their channel and on account deletion (§10, III.E.4.b).
- Tests: web uses Vitest `pool: 'threads'` (WSL /mnt/f). API tests stay single-worker. Read "Test Files N passed" every run.

## Review Focus

1. A brand-new channel (0 uploads, no Analytics rows) → every tab shows reasons, no `NaN`, `0` or empty chart axes pretending to be data. Test: Task 3 "empty channel", Task 7 "renders no_data reasons".
2. Revenue scope granted but channel not in the Partner Program (Analytics 403) → Earnings says "Revenue isn't available for this channel" with YouTube's reason, not an error page. Test: Task 4 "forbidden revenue".
3. Google access revoked between page loads → endpoint marks the channel `reconnect` and returns `{ error: 'reconnect' }`; UI shows a Reconnect banner, no retry loop. Test: Task 2 "revoked marks reconnect", Task 6 "reconnect banner".
4. Two connected channels → switcher changes every tab's data; another user's channel id → 404. Test: Task 3 "other user's channel", Task 7 "switcher".
5. 7-day range when YouTube has only 4 days → chart and totals say "Data through <date>"; nothing extrapolated. Test: Task 3 "dataThrough is last returned day".

---

### Task 1: YouTube data client

**Files:**
- Create: `apps/api/src/youtube.ts`
- Modify: `apps/api/src/google.ts` (add `forbidden` to `GoogleError`)
- Test: `apps/api/test/youtube.test.ts`

**Interfaces:**
- Produces:
  - `type GoogleError = { kind: 'revoked' } | { kind: 'failed'; reason: string } | { kind: 'forbidden'; reason: string }`
  - `interface ReportQuery { startDate: string; endDate: string; metrics: string[]; dimensions?: string[]; filters?: string; sort?: string; maxResults?: number }`
  - `interface Report { columns: string[]; rows: (string | number)[][] }`
  - `interface Upload { videoId: string; title: string; publishedAt: string; durationSec: number | null; views: number | null; thumbnailUrl: string | null }`
  - `interface YouTubeClient { report(accessToken: string, q: ReportQuery): Promise<Report | GoogleError>; uploads(accessToken: string, max: number): Promise<Upload[] | GoogleError> }`
  - `httpYouTubeClient(fetchFn: typeof fetch): YouTubeClient`

- [ ] **Step 1: Write failing tests** with a fake `fetch` recording URLs:
  - `report` calls `https://youtubeanalytics.googleapis.com/v2/reports` with `ids=channel==MINE`, the dates, `metrics` joined by `,`, and dimensions/filters/sort/maxResults only when given; maps `columnHeaders[].name` → `columns` and `rows` (missing `rows` → `[]`).
  - 401 → `{ kind: 'revoked' }`; 403 → `{ kind: 'forbidden', reason: <error.message from body> }`; 429 or body reason `quotaExceeded` → `{ kind: 'failed', reason: 'YouTube quota used up for today' }`; network throw → `failed` with the message.
  - `uploads(token, 120)`: `channels.list?part=contentDetails&mine=true` → uploads playlist → `playlistItems.list` pages of 50 until 120 ids or no `nextPageToken` → `videos.list?part=snippet,contentDetails,statistics&id=…` in batches of 50. Maps ISO-8601 duration `PT1H2M3S` → `3723`, unparseable → `null`; hidden/absent `viewCount` → `null`; thumbnail `medium.url` else `default.url` else `null`. Output newest first.
  - Channel without uploads playlist → `[]`.
- [ ] **Step 2: Run** `pnpm --filter api test` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `apps/api/src/youtube.ts`.
- [ ] **Step 4: Run** — Expected: PASS, all files passed.
- [ ] **Step 5: Commit** `feat(api): YouTube Analytics and uploads client`

### Task 2: Channel access, report cache, periods

**Files:**
- Create: `packages/db/migrations/0003_report_cache.sql`, `apps/api/src/channel-data.ts`, `packages/core/src/period.ts`
- Modify: `packages/core/src/index.ts`, `apps/api/src/app.ts` (`Deps.youtube`), `apps/api/src/index.ts`, `apps/api/src/routes/account.ts` (delete cache rows on remove/delete), `apps/api/test/helpers.ts` (`makeDeps` gets a fake YouTube), `packages/db/src/index.ts`
- Test: `apps/api/test/channel-data.test.ts`, `packages/core/test/period.test.ts`

**Interfaces:**
- Consumes: `GoogleClient.refresh`, `tryDecrypt` (grants.ts), `readSession`.
- Produces:
  - SQL: `CREATE TABLE report_cache (channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, key TEXT NOT NULL, body TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY (channel_id, key));`
  - core: `type RangeKey = '7d' | '28d' | '90d' | '365d'`; `const RANGES: RangeKey[]`; `parseRange(s: string | undefined): RangeKey` (default `'28d'`); `periodFor(range: RangeKey, todayIso: string): { start: string; end: string; prevStart: string; prevEnd: string }` — `end` = today (UTC date), `start` = end − (days − 1), previous period the same length immediately before.
  - api: `type ChannelAccess = { channel: ChannelRow; accessToken: string }`; `ownedChannel(deps, userId, channelRowId): Promise<ChannelRow | null>`; `accessFor(deps, ch: ChannelRow): Promise<ChannelAccess | { error: 'reconnect' | 'gone' | 'google_failed'; message: string }>` (unreadable token or `revoked` → set status `reconnect` with plan 2's reasons and return `reconnect`; status `gone` → `gone`); `cached<T>(deps, channelId, key, ttlMs, load: () => Promise<T | GoogleError>): Promise<T | GoogleError>` (errors never cached).
  - `Deps.youtube: YouTubeClient`.
- [ ] **Step 1: Write failing tests:** `periodFor('7d','2026-11-21')` → `{start:'2026-11-15',end:'2026-11-21',prevStart:'2026-11-08',prevEnd:'2026-11-14'}`; `'365d'` crosses a year; `parseRange('bogus')` → `'28d'`. API: "revoked marks reconnect" (fake refresh `revoked` → row status `reconnect`, result `{error:'reconnect'}`); changed TOKEN_KEY → `reconnect`; `cached` returns stored body within TTL without calling `load`, reloads after TTL, does not store errors; removing a channel and deleting the account leave no `report_cache` rows.
- [ ] **Step 2: Run** `pnpm --filter @viewproof/core test` and `pnpm --filter api test` — Expected: FAIL.
- [ ] **Step 3: Implement** migration, `period.ts`, `channel-data.ts`; wire `httpYouTubeClient(fetch)` in `index.ts`; add `DELETE FROM report_cache WHERE channel_id IN (SELECT id FROM channels WHERE user_id = ?)` first in the account-deletion batch and before the channel delete in `revokeAndDelete`.
- [ ] **Step 4: Run** both — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): channel access and report cache`

### Task 3: Overview and Videos endpoints

**Files:**
- Create: `packages/core/src/api-types.ts`, `apps/api/src/routes/channel.ts`
- Modify: `packages/core/src/index.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/channel-overview.test.ts`

**Interfaces:**
- Produces (in `api-types.ts`, shared with web):
  - `type ApiError = { error: 'signed_out' | 'not_found' | 'reconnect' | 'gone' | 'google_failed'; message: string }`
  - `type Pair = { current: Measured<number>; previous: Measured<number> }`
  - `interface Overview { channelId: string; range: RangeKey; period: ReturnType<typeof periodFor>; dataThrough: string | null; totals: { views: Pair; watchMinutes: Pair; averageViewDuration: Pair; subscribersGained: Pair; subscribersLost: Pair }; daily: { date: string; views: number }[]; fetchedAt: string }`
  - `interface VideoRow { videoId: string; title: string; publishedAt: string; durationSec: number | null; thumbnailUrl: string | null; lifetimeViews: Measured<number>; views: Measured<number>; watchMinutes: Measured<number>; averageViewDuration: Measured<number> }`
  - `interface Videos { range: RangeKey; dataThrough: string | null; videos: VideoRow[]; fetchedAt: string }`
  - Routes: `GET /api/channels/:id/overview?range=`, `GET /api/channels/:id/videos?range=` (`:id` = `channels.id`, not the YouTube id).
- Rules: totals from one `reports.query` per period with no dimensions (metrics `views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost`); no row → each value `no_data` "YouTube returned no data for these dates"; formula text `YouTube Analytics`. Daily from `dimensions=day&sort=day` metric `views`; `dataThrough` = last returned `day` or `null`. Videos: `uploads(token, 200)` + one report `dimensions=video&sort=-views&maxResults=200` over the period; a video with no row → `no_data` "YouTube reported no row for this video in these dates (no views, or below YouTube's reporting threshold)"; `lifetimeViews` from the Data API (`null` → `no_data` "View count hidden"). Cache key `overview:<range>:<end>` / `videos:<range>:<end>`, 6 h.
- [ ] **Step 1: Write failing tests:** signed out → 401 `signed_out`; "other user's channel" → 404 `not_found`; fake reports → exact totals and daily; "dataThrough is last returned day" (rows end 2026-11-18 for a 7d range ending 21 → `dataThrough: '2026-11-18'`, no padded days); "empty channel" (no rows, no uploads) → all totals `no_data`, `daily: []`, `videos: []`; Videos maps a missing analytics row to the reason above; status `gone` → 409 `gone`; second request within 6 h makes no Google call.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `routes/channel.ts` (`channelRoutes(app, deps)`) and types.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): overview and videos from YouTube Analytics`

### Task 4: Search terms, Earnings, upload times

**Files:**
- Modify: `packages/core/src/api-types.ts`, `apps/api/src/routes/channel.ts`
- Test: `apps/api/test/channel-more.test.ts`

**Interfaces:**
- Produces:
  - `interface SearchTerm { term: string; views: number; watchMinutes: number; previousViews: Measured<number>; topVideo: { videoId: string; title: string } | null }`
  - `interface SearchTerms { range: RangeKey; terms: SearchTerm[]; note: string | null; fetchedAt: string }`
  - `type Earnings = { status: 'not_granted' } | { status: 'not_available'; reason: string } | { status: 'ok'; range: RangeKey; dataThrough: string | null; totals: { estimatedRevenue: Pair; playbackBasedCpm: Pair; monetizedPlaybacks: Pair }; topVideos: { videoId: string; title: string; estimatedRevenue: number; playbackBasedCpm: Measured<number> }[]; fetchedAt: string }`
  - `interface UploadTimes { uploads: { videoId: string; title: string; publishedAt: string; firstWeekViews: Measured<number> }[]; fetchedAt: string }`
  - Routes: `GET /api/channels/:id/search-terms?range=`, `/earnings?range=`, `/upload-times`.
- Rules:
  - Search terms: `dimensions=insightTrafficSourceDetail&filters=insightTrafficSourceType==YT_SEARCH&sort=-views&maxResults=25`, metrics `views,estimatedMinutesWatched`, current and previous period. `previousViews` = previous period's value for the same term, else `no_data` "Not in YouTube's top 25 for the previous period". `topVideo`: for the top 10 videos of the period (video report), the same terms query with `;video==<id>`; each term's `topVideo` = the video with the most views for it, else `null`. No terms → `note` "YouTube lists search terms only once enough people searched; it doesn't publish the threshold."
  - Earnings: channel `scopes` lacks `yt-analytics-monetary.readonly` → `not_granted` (no Google call). Report `forbidden` → `not_available` with YouTube's reason. Totals metrics `estimatedRevenue,playbackBasedCpm,monetizedPlaybacks`; top 10 `dimensions=video&sort=-estimatedRevenue&maxResults=10`.
  - Upload times: the 20 newest uploads published ≥ 10 days ago; per video one report with `filters=video==<id>`, `startDate` = publish date (UTC), `endDate` = +6 days, metric `views`; no row → `no_data` "YouTube reported no views for its first week"; cache key `fw:<videoId>` 30 days.
- [ ] **Step 1: Write failing tests:** terms + previous + topVideo mapping; empty terms note; "forbidden revenue" → `not_available` with the reason; `not_granted` makes no Google call; upload times skips uploads newer than 10 days and caches per video (second call → no report calls).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): search terms, earnings and upload times`

### Task 5: Display rules in core

**Files:**
- Create: `packages/core/src/attention.ts`, `packages/core/src/upload-grid.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/attention.test.ts`, `packages/core/test/upload-grid.test.ts`

**Interfaces:**
- Produces:
  - `interface AttentionItem { level: 'warn' | 'ok' | 'info'; title: string; detail: string; action?: { label: string; href: string } }`
  - `needsAttention(i: { status: 'active' | 'reconnect' | 'gone'; statusReason: string | null; lastUploadAt: string | null; todayIso: string; dataThrough: string | null; revenue: 'granted' | 'not_granted' }): AttentionItem[]`
  - `uploadGrid(uploads: { publishedAt: string }[], timeZone: string): { days: string[]; blocks: string[]; counts: number[][] }` — days Mon…Sun, blocks `0–4h` … `20–24h` (6 blocks), counts of uploads per cell in the given IANA zone.
- Rules (exact copy): reconnect → warn "Reconnect needed" detail = statusReason, action `Reconnect` → `/auth/google/start?choose=1`; gone → warn "Channel no longer exists" action `Remove it` → `/account`; no uploads → info "No uploads yet"; last upload ≥ 30 days → warn "No upload in N days"; else ok "Last upload N days ago" (N = whole days, `1 day` singular); dataThrough older than 4 days → info "YouTube data is delayed" detail "Latest day YouTube returned: <date>."; revenue not granted → info "Revenue not shown" action `Add revenue access` → `/auth/google/start?choose=1&revenue=1`.
- [ ] **Step 1: Write failing tests** for each rule and for `uploadGrid` with `Europe/Berlin` (a 23:30 UTC Sunday upload lands Monday 0–4h).
- [ ] **Step 2: Run** `pnpm --filter @viewproof/core test` — Expected: FAIL.
- [ ] **Step 3: Implement** (use `Intl.DateTimeFormat` with `timeZone`, `weekday: 'short'`, `hourCycle: 'h23'`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): needs-attention rules and upload-time grid`

### Task 6: Web app shell, served at /app

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}`, `apps/web/src/{main.tsx,App.tsx,api.ts,theme.ts,styles.css}`, `apps/web/src/shell/{Shell.tsx,nav.ts,Soon.tsx,SignIn.tsx}`, `apps/web/test/{setup.ts,shell.test.tsx}`
- Modify: `apps/api/wrangler.toml` (`[assets] directory = "../web/dist"`, `binding = "ASSETS"`, `run_worker_first = true`), `apps/api/src/app.ts` (`Deps.assets?: { fetch(req: Request): Promise<Response> }`; `GET /app`, `/app/*` → asset or `/app/index.html`; `GET /` signed in → 302 `/app`), `apps/api/src/index.ts`, `apps/api/src/views/Account.tsx` (link "Open ViewProof" → `/app`), `apps/api/package.json` (`dev` builds web first)
- Test: `apps/web/test/shell.test.tsx`, `apps/api/test/app-assets.test.ts`

**Interfaces:**
- Consumes: `/api/me`, `/api/channels` (plan 2).
- Produces: `api.ts`: `getJson<T>(path: string): Promise<T | ApiError>` (401 → `{error:'signed_out'}`); `useChannels()`; router basename `/app`, routes `/`, `/channel/:tab?` (tabs `overview|videos|search-terms|earnings`), `/research/*`, `/optimize`, `/competitors`, `/ai`, `/tools`, `/settings/*`; `Shell` props `{ me, channels, current, onSwitch }`; theme stored in `localStorage['vp-theme']`, default from `prefers-color-scheme`, applied as `data-theme` on `<html>`. Settings → Channels links to `/account`.
- Vite: `base: '/app/'`, `build.outDir: 'dist/app'`; dev server `server.watch.usePolling: true`, proxy `/api`, `/auth`, `/account`, `/connect` to `http://localhost:8787`.
- [ ] **Step 1: Write failing tests:** nav shows the §15 labels in order; unbuilt items carry `soon`; theme toggle flips `data-theme` and persists; signed out renders "Sign in with Google" linking `/auth/google/start`; channel switcher lists channels; a `reconnect` channel shows a banner with `Reconnect`. API: `/app/channel/videos` with a fake `assets` returning 404 for the path serves `/app/index.html`; signed-in `/` → 302 `/app`.
- [ ] **Step 2: Run** `pnpm --filter web test` and `pnpm --filter api test` — Expected: FAIL.
- [ ] **Step 3: Implement.** If the Workers test pool refuses to start because `../web/dist` is missing, keep `[assets]` and make the api `test` script create `../web/dist/app/index.html` as a placeholder when absent (ledger ruling).
- [ ] **Step 4: Run** both — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): app shell served by the Worker at /app`

### Task 7: My channel — Overview and Home

**Files:**
- Create: `apps/web/src/channel/{MyChannel.tsx,Overview.tsx,Kpi.tsx,DailyChart.tsx,BestTime.tsx,Attention.tsx,RangeChips.tsx}`, `apps/web/src/home/Home.tsx`, `apps/web/src/ui/{Badge.tsx,Value.tsx}`
- Test: `apps/web/test/overview.test.tsx`

**Interfaces:**
- Consumes: `Overview`, `Videos`, `UploadTimes`, `needsAttention`, `uploadGrid`, `parseRange`.
- Produces: `Value({ m, format })` renders a `Measured<number>`: value via `format`, or a muted "No data" with the reason as visible text (not only a tooltip); hover/`title` shows `formula`. `format` helpers: `views` (en-US grouping), `minutes→hours` (`1,234.5 h`), `seconds→m:ss`.
- Rules: KPI card = label, REAL badge, current value, "Previous <N> days: <value>" line (no %). Range chips 7 days / 28 days / 90 days / 12 months, kept in `?range=`. Chart: SVG of `daily` with "Data through <date>"; `daily` empty → "No daily data from YouTube for these dates". Best time card: `uploadGrid` heat by upload count in the browser's zone, title "When you post", text "YouTube's API doesn't share when your viewers are online. YouTube Studio shows it:" + link `https://studio.youtube.com/channel/<youtube channel id>/analytics/tab-audience/period-default`, then up to 5 uploads sorted by `firstWeekViews` (value rows first) as "<title> · <weekday hh:mm> · <views> first-week views". Home: KPIs (28 days), top 5 search terms, needs attention; "What to make next" and "Outliers in your niche" cards say "Arrives in a later update" (no mock rows).
- [ ] **Step 1: Write failing tests** with mocked `fetch`: KPIs show exact formatted values and the previous line; "renders no_data reasons" (all `no_data` → reasons visible, no digits in KPI values); range chip click refetches with `range=7d`; chart says "Data through 2026-11-18"; best-time link contains the YouTube channel id; "switcher" changes the channel id in requested URLs.
- [ ] **Step 2: Run** `pnpm --filter web test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): My channel overview and home`

### Task 8: My channel — Videos, Search terms, Earnings

**Files:**
- Create: `apps/web/src/channel/{VideosTab.tsx,SearchTermsTab.tsx,EarningsTab.tsx}`
- Test: `apps/web/test/tabs.test.tsx`

**Interfaces:**
- Consumes: `Videos`, `SearchTerms`, `Earnings`, `Value`.
- Rules: Videos table columns Video (thumb + title + published date) · Views (range) · Watch time · Avg view · Lifetime views; row action "Open in Studio" → `https://studio.youtube.com/video/<id>/analytics`. Search terms: heading "What people typed before finding you", REAL · YouTube badge, columns Term · Views · Previous period · Watch time · Your video; `note` shown when present. Earnings: `not_granted` → "Revenue isn't connected" + button `Add revenue access` → `/auth/google/start?choose=1&revenue=1`; `not_available` → "Revenue isn't available for this channel" + YouTube's reason; `ok` → KPIs Estimated revenue (ESTIMATE badge, `$` 2 decimals), Playback-based CPM, Monetized playbacks, each with previous line, top videos table, note "YouTube's estimate; it can change at month end."
- [ ] **Step 1: Write failing tests** for each state and column set above, including a `no_data` row in Videos showing its reason.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): videos, search terms and earnings tabs`

### Task 9: Local run, docs, live check

**Files:**
- Modify: `README.md`, `apps/api/README.md`, `package.json` (root `dev` → `pnpm --filter web build && pnpm --filter api dev`)

- [ ] **Step 1:** `pnpm test` and `pnpm typecheck` at the root — Expected: all packages pass, 0 TS errors.
- [ ] **Step 2:** apply migrations locally, build web, restart `wrangler dev`; `curl` `/app/` → 200 HTML containing `<div id="root">`; `/api/channels/<id>/overview` without cookie → 401.
- [ ] **Step 3:** Owner opens `http://localhost:8787/app` signed in and checks Overview, Videos, Search terms, Earnings against YouTube Studio for the same dates (live-call budget: one load per tab).
- [ ] **Step 4:** Docs: README status line (plan 3), how to run the web app, what My channel shows and why there are no derived scores (III.E.4.h).
- [ ] **Step 5: Commit** `docs: web app and My channel`
