# Core scores + extension scorecard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome/Edge extension that shows, on any YouTube watch page, views per hour, the outlier score ×N with its reason, upload age and tags — computed in the browser with no server.

**Architecture:** A pnpm TypeScript monorepo. `packages/core` holds pure, deterministic scoring and parsing (shared later by the Worker and web app). `apps/extension` (WXT, Manifest V3) reads the page's own player data through a MAIN-world script, fetches the channel's public RSS feed for the baseline (D1), stores the user's own past observations locally for VPH, and renders a panel in a shadow root.

**Tech Stack:** Node 24, pnpm 10, TypeScript (strict), Vitest (`pool: 'threads'`), happy-dom, fast-xml-parser, WXT, Playwright (Chromium) for the end-to-end check.

**Spec:** `docs/superpowers/specs/2026-11-20-open-iq-design.md` (§7 scores, §10 privacy, D1, D4, §15 UI). Roadmap: `docs/superpowers/plans/2026-11-20-phase1-roadmap.md`.

**Out of scope here (later plans):** panels on channel and search pages, per-page-type toggles and the video checklist in the extension (plan 5, with the settings page); anything sent to a server.

## Global Constraints

- License AGPL-3.0; TypeScript everywhere.
- Owner's rule: "real measurements or an explicit null with a reason, never a plausible placeholder." Every score is `Measured<T>`; a missing input yields `{ kind: 'no_data', reason }`, never 0 or a default.
- Scores are deterministic: same inputs → same output; each value carries its `formula` and `inputs` for the "why" text.
- Outlier score = video views ÷ median views of the channel's previous uploads of the same format, baseline = up to 15 from the public RSS feed, minimum 5, else no data (D1). Shown as "×N" with one decimal. ≤ 0.3 is flagged as a negative outlier.
- VPH = view delta ÷ hours between two observations; with one observation, "average since upload" (§7).
- Extension host permissions: YouTube domains only (`https://www.youtube.com/*`). This plan sends nothing to any other server.
- No YouTube cookies or tokens are read or sent; no Studio requests; no `Origin` rewriting (anti-goals, D5).
- Browsers: Chrome + Edge, one MV3 build (D4).
- Records carry `platform: 'youtube'` (non-goals: keep platform-specific code behind a `platform` field).
- Colours from spec §15: neutral light `#FAFAF9`/`#1C1917`, dark `#0F1115`/`#E7E7EA`; accent `#0F766E`/`#2DD4BF`; highlight amber `#B45309`/`#F59E0B` for ×N badges.
- Tests on `/mnt/f` must use Vitest `pool: 'threads'` (forks time out on this mount).
- Live YouTube calls in development: budget of ≤ 5 per task, by hand, never in CI or loops.

## Review Focus

1. **SPA navigation:** clicking from video A to video B without a reload must show B's numbers, never A's. → Task 7 test `ignores stale player data after navigation`.
2. **Live, upcoming and premiere videos:** VPH and ×N must say "live or upcoming video", not compute from a 0 or still-growing count. → Task 4 test `live video yields no_data`.
3. **Baseline unavailable:** feed 404 (removed channel), offline, or < 5 same-format videos → ×N shows the reason while VPH, age and tags still render. → Task 6 test `feed failure leaves other stats intact`.
4. **Odd observations:** second visit seconds later, or a lower view count (YouTube corrections) → no huge or negative VPH; fall back to since-upload. → Task 3 tests `short interval falls back`, `decreasing views falls back`.
5. **YouTube changes its data shape:** the parser returns a failure with a reason; the panel shows "Couldn't read this page" and YouTube itself keeps working (no thrown errors in the content script). → Task 5 test `unknown shape is a failure, not a throw` and Task 8 test `renders parse failure`.

---

## File structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, LICENSE, .gitignore (exists)
packages/core/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts          re-exports
  src/types.ts          Platform, Format, FeedVideo
  src/measured.ts       Measured<T>, value(), noData(), median()
  src/vph.ts            viewsPerHour()
  src/outlier.ts        outlierScore()
  src/feed.ts           parseChannelFeed()  (YouTube RSS → FeedVideo[])
  src/player.ts         parsePlayerResponse() (page player data → WatchVideo)
  src/scorecard.ts      buildScorecard()
  test/*.test.ts, test/fixtures/{feed-*.xml, player-*.json}
apps/extension/
  package.json, wxt.config.ts, tsconfig.json, vitest.config.ts
  entrypoints/youtube-main.content.ts   MAIN world: reads player data, posts it
  entrypoints/youtube.content.ts        isolated world: wires bridge → store → baseline → panel
  src/bridge.ts         message type + validation + navigation sequencing
  src/store.ts          ObservationStore (chrome.storage + memory impl)
  src/baseline.ts       getBaseline() with 1 h cache
  src/panel.ts          renderPanel() into a shadow root
  src/panel.css         tokens + panel styles
  test/*.test.ts
  e2e/scorecard.spec.ts, e2e/fixtures/watch.html, e2e/fixtures/feed.xml
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `LICENSE`, `packages/core/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: workspace package `@open-iq/core` (ESM, `exports: "./src/index.ts"` for workspace use); root scripts `pnpm test` (`pnpm -r test`), `pnpm typecheck` (`pnpm -r typecheck`).

- [ ] **Step 1:** Create root files. `pnpm-workspace.yaml` lists `packages/*` and `apps/*`. `tsconfig.base.json`: `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `noUncheckedIndexedAccess: true`. `LICENSE`: full AGPL-3.0 text. Root `package.json`: `"private": true`, `"packageManager": "pnpm@10.4.1"`, `"engines": {"node": ">=24"}`.
- [ ] **Step 2:** `packages/core/vitest.config.ts` with `test: { pool: 'threads' }`. Write `test/smoke.test.ts`: `expect(VERSION).toBe('0.0.0')` importing `VERSION` from `../src/index`.
- [ ] **Step 3:** Run `pnpm install && pnpm test`. Expected: FAIL, `VERSION` not exported.
- [ ] **Step 4:** Export `export const VERSION = '0.0.0'` from `src/index.ts`. Run `pnpm test && pnpm typecheck`. Expected: 1 passed, no type errors.
- [ ] **Step 5:** Commit (first commit also carries the existing `docs/` and `.gitignore`).

```bash
git add -A && git commit -m "chore: monorepo scaffold, core package, research and design docs"
```

### Task 2: `Measured<T>` and median

**Files:** Create `packages/core/src/measured.ts`, `packages/core/test/measured.test.ts`

**Interfaces:**
- Produces:
```ts
export type Inputs = Record<string, number | string | boolean>;
export type Measured<T> =
  | { kind: 'value'; value: T; formula: string; inputs: Inputs }
  | { kind: 'no_data'; reason: string };
export function value<T>(v: T, formula: string, inputs: Inputs): Measured<T>;
export function noData(reason: string): Measured<never>;
export function median(xs: readonly number[]): number | null; // null for []
```

- [ ] **Step 1: Failing tests** — `median([3,1,2]) === 2`; `median([1,2,3,4]) === 2.5`; `median([]) === null`; `noData('x')` deep-equals `{kind:'no_data', reason:'x'}`.
- [ ] **Step 2:** Run `pnpm --filter @open-iq/core test`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement in `measured.ts`; re-export from `index.ts`.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): Measured type and median`.

### Task 3: Views per hour

**Files:** Create `packages/core/src/vph.ts`, `packages/core/test/vph.test.ts`

**Interfaces:**
- Consumes: `Measured`, `value`, `noData` (Task 2).
- Produces:
```ts
export interface ViewObservation { views: number; at: string } // ISO time
export const MIN_DELTA_MINUTES = 10;
export function viewsPerHour(args: {
  current: ViewObservation;
  previous: ViewObservation | null;
  publishedAt: string;
}): Measured<number>; // inputs.mode: 'delta' | 'since_upload'
```

Rule: use delta mode when `previous` exists, is ≥ `MIN_DELTA_MINUTES` older, and `current.views >= previous.views`; otherwise since-upload = `current.views ÷ hours since publishedAt`. Value rounded to a whole number. Hours since upload < 1 → `noData('Published less than an hour ago')`.

- [ ] **Step 1: Failing tests**
  - `delta mode`: previous 1,000 at 10:00, current 3,400 at 12:00 → `value 1200`, `inputs.mode 'delta'`, `formula` contains `÷`.
  - `since upload`: no previous, 48,000 views, published 48 h before → `value 1000`, `mode 'since_upload'`.
  - `short interval falls back`: previous 5 minutes earlier → `mode 'since_upload'`.
  - `decreasing views falls back`: previous 5,000, current 4,900, 2 h apart → `mode 'since_upload'`.
  - `too new`: published 20 minutes ago → `kind 'no_data'`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `viewsPerHour` in `vph.ts`; export.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(core): views per hour`.

### Task 4: Outlier score

**Files:** Create `packages/core/src/outlier.ts`, `packages/core/test/outlier.test.ts`

**Interfaces:**
- Consumes: Task 2; `FeedVideo` and `Format` type from Task 5 — define `Format` and `FeedVideo` here in `outlier.ts`'s sibling `src/types.ts` so Task 5 imports them:
```ts
// src/types.ts
export type Platform = 'youtube';
export type Format = 'long' | 'short' | 'unknown';
export interface FeedVideo { platform: Platform; videoId: string; title: string; publishedAt: string; views: number | null; format: Format }
```
- Produces:
```ts
export const MIN_BASELINE = 5;
export const MAX_BASELINE = 15;
export const NEGATIVE_OUTLIER = 0.3;
export function outlierScore(args: {
  video: { videoId: string; views: number; format: Format; publishedAt: string; isLive: boolean; isUpcoming: boolean };
  baseline: readonly FeedVideo[];
}): Measured<number>;
// inputs: views, baselineMedian, baselineCount, mixedFormats (bool), negative (bool)
```

Baseline selection: exclude the video itself and entries with `views === null`; keep entries published before the video when any exist, else all remaining; keep entries whose `format` equals the video's or is `'unknown'` (`mixedFormats = true` if any unknown kept); newest first, take `MAX_BASELINE`. Value = views ÷ median, rounded to 1 decimal.

- [ ] **Step 1: Failing tests**
  - `basic`: baseline views 10k,20k,30k,40k,50k (long), video 90,000 long → `value 3`, `inputs.baselineMedian 30000`, `baselineCount 5`.
  - `too few`: 4 baseline videos → `no_data`, reason `'Needs 5 earlier videos of the same type; found 4'`.
  - `excludes itself and other format`: baseline includes the video's own id and 3 Shorts → those are not counted.
  - `negative`: views 6,000 vs median 30,000 → `value 0.2`, `inputs.negative true`.
  - `live video yields no_data`: `isLive true` → reason `'Live or upcoming video'`; same for `isUpcoming`.
  - `takes at most 15 newest`: 20 baseline entries → `baselineCount 15`.
  - `zero median`: all baseline views 0 → `no_data`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; export from index.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(core): outlier score with explainable inputs`.

### Task 5: Parsers — channel RSS feed and player data

**Files:** Create `packages/core/src/feed.ts`, `packages/core/src/player.ts`, `packages/core/test/feed.test.ts`, `packages/core/test/player.test.ts`, fixtures `packages/core/test/fixtures/feed-long.xml`, `feed-with-shorts.xml`, `player-watch.json`, `player-live.json`. Add dependency `fast-xml-parser` to core.

**Interfaces:**
- Consumes: `types.ts` (Task 4).
- Produces:
```ts
export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };
export function parseChannelFeed(xml: string): ParseResult<FeedVideo[]>;
export interface WatchVideo {
  platform: 'youtube'; videoId: string; channelId: string; title: string;
  views: number; lengthSeconds: number; publishedAt: string; tags: string[];
  isLive: boolean; isUpcoming: boolean; format: Format;
}
export function parsePlayerResponse(raw: unknown): ParseResult<WatchVideo>;
```

- [ ] **Step 1: Capture fixtures (live budget: 3 requests, by hand).**
  - `curl -s "https://www.youtube.com/feeds/videos.xml?channel_id=<long-form channel>" > feed-long.xml`, and the same for a channel that posts Shorts → `feed-with-shorts.xml`.
  - In your own browser on a watch page, DevTools console: `copy(JSON.stringify(document.getElementById('movie_player').getPlayerResponse()))` → `player-watch.json`. Do the same on a live stream → `player-live.json`. Keep only `videoDetails` and `microformat` to shrink the files.
  - Record in a comment at the top of each test file: capture date, and whether Shorts entries in the feed link to `/shorts/` (decides the format rule below).
- [ ] **Step 2: Failing tests.**
  - feed: `feed-long.xml` → `ok true`, length = number of `<entry>` elements in the file (count them in the test with a regex), first item has non-null numeric `views` from `media:statistics@views`, ISO `publishedAt`, `platform 'youtube'`.
  - feed: `format rule` — if the Step 1 check found `/shorts/` links: those entries are `'short'`, others `'long'`; if not: all entries `'unknown'`. Write the assertion that matches what the fixture shows.
  - feed: `'<html>not a feed</html>'` → `ok false`, reason contains `'not a YouTube feed'`. A valid `<feed>` with no entries → `ok true, value []`.
  - player: `player-watch.json` → `views` equals `Number(videoDetails.viewCount)` from the fixture, `tags` equals `videoDetails.keywords ?? []`, `publishedAt` from `microformat.playerMicroformatRenderer.publishDate`, `isLive false`.
  - player: `player-live.json` → `isLive true`.
  - player: `unknown shape is a failure, not a throw` — `parsePlayerResponse({})`, `null`, and `{videoDetails:{}}` each return `ok false` with a reason naming the missing field.
  - player: `format` is `'short'` when `lengthSeconds <= 180` and the player data marks it a Short if such a field exists in the fixture; otherwise `'long'`. Note the field used in the test comment; if no reliable field exists, use `'unknown'` for videos ≤ 180 s.
- [ ] **Step 3:** Run; expect FAIL.
- [ ] **Step 4:** Implement both parsers. Never throw: wrap parsing and map any exception to `ok: false`.
- [ ] **Step 5:** Run; expect PASS. Add `pnpm --filter @open-iq/core canary`: a script that fetches one real feed and exits non-zero if it parses to zero entries or any entry has `views === null` (manual use only; documents the parser-drift check from spec §11).
- [ ] **Step 6:** Commit `feat(core): RSS feed and player data parsers with fixtures`.

### Task 6: Scorecard

**Files:** Create `packages/core/src/scorecard.ts`, `packages/core/test/scorecard.test.ts`

**Interfaces:**
- Consumes: `viewsPerHour` (3), `outlierScore` (4), `WatchVideo`, `ParseResult<FeedVideo[]>` (5).
- Produces:
```ts
export interface Scorecard {
  platform: 'youtube'; videoId: string; title: string;
  vph: Measured<number>; outlier: Measured<number>;
  ageHours: number; tags: string[];
}
export function buildScorecard(args: {
  video: WatchVideo; previous: ViewObservation | null;
  baseline: ParseResult<FeedVideo[]>; now: string;
}): Scorecard;
```
A failed baseline becomes `outlier = noData("Couldn't load this channel's recent videos: <reason>")`.

- [ ] **Step 1: Failing tests** — `combines scores` (fixture-free synthetic inputs; asserts vph value, outlier value, ageHours 48, tags passed through); `feed failure leaves other stats intact` (baseline `{ok:false, reason:'HTTP 404'}` → outlier no_data containing `HTTP 404`, vph still `kind 'value'`).
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(core): scorecard`.

### Task 7: Extension scaffold, page bridge and navigation

**Files:** Create `apps/extension/{package.json,wxt.config.ts,tsconfig.json,vitest.config.ts}`, `entrypoints/youtube-main.content.ts`, `src/bridge.ts`, `test/bridge.test.ts`

**Interfaces:**
- Consumes: `parsePlayerResponse` (5).
- Produces:
```ts
export const MSG = 'open-iq:player' as const;
export interface PlayerMessage { type: typeof MSG; seq: number; url: string; payload: unknown }
export function isPlayerMessage(e: MessageEvent): e is MessageEvent<PlayerMessage>; // same window, same origin, right shape
export class NavigationGuard { next(url: string): number; isCurrent(seq: number, url: string): boolean }
```

`wxt.config.ts`: manifest name "open-IQ", `host_permissions: ['https://www.youtube.com/*']`, `permissions: ['storage']`, no others. MAIN-world script (`world: 'MAIN'`, matches `https://www.youtube.com/*`, `runAt: 'document_idle'`): on load and on every `yt-navigate-finish` event, if `location.pathname === '/watch'`, read `document.getElementById('movie_player')?.getPlayerResponse?.()`; post `{type: MSG, seq, url: location.href, payload}`; retry up to 10 times at 300 ms while the payload's `videoDetails.videoId` differs from the `v` URL parameter (player data lags the URL after SPA navigation).

- [ ] **Step 1: Failing tests** — `accepts only same-window messages of the right shape` (wrong `source`, wrong `origin`, missing `type` → false); `ignores stale player data after navigation` (guard: `next('…v=A')` = 1, `next('…v=B')` = 2; `isCurrent(1, '…v=A')` false; `isCurrent(2,'…v=B')` true).
- [ ] **Step 2:** Run `pnpm --filter extension test`; FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** `pnpm --filter extension build` produces `.output/chrome-mv3/manifest.json`; check it lists only the host permission and `storage`.
- [ ] **Step 6:** Commit `feat(extension): MV3 scaffold and page bridge`.

### Task 8: Observation store, baseline fetch, panel

**Files:** Create `src/store.ts`, `src/baseline.ts`, `src/panel.ts`, `src/panel.css`, `entrypoints/youtube.content.ts`, tests `test/store.test.ts`, `test/baseline.test.ts`, `test/panel.test.ts` (happy-dom environment).

**Interfaces:**
- Consumes: `buildScorecard`, `parseChannelFeed`, `Scorecard` (core); `isPlayerMessage`, `NavigationGuard` (7).
- Produces:
```ts
// store.ts
export interface ObservationStore {
  getLatest(videoId: string): Promise<ViewObservation | null>;
  record(videoId: string, obs: ViewObservation): Promise<void>;
}
export const MAX_VIDEOS = 2000; // least-recently-recorded evicted
export function memoryStore(): ObservationStore;
export function chromeStore(area: chrome.storage.StorageArea): ObservationStore;
// baseline.ts
export const BASELINE_TTL_MS = 3_600_000;
export function getBaseline(channelId: string, deps: { fetch: typeof fetch; now: () => number; cache: Map<string, { at: number; result: ParseResult<FeedVideo[]> }> }): Promise<ParseResult<FeedVideo[]>>;
// panel.ts
export function renderPanel(host: HTMLElement, state: { kind: 'ok'; card: Scorecard } | { kind: 'error'; reason: string }): void;
```

Panel copy (exact): title "open-IQ"; tiles "Views / hour", "vs usual", "Age", "Tags". VPH since-upload shows the suffix "avg since upload". ×N badge uses the amber token. Why-line: `Why ×{value}? {views} views; this channel usually gets {baselineMedian}.` plus ` (Shorts and long videos mixed)` when `mixedFormats`. No data: the tile shows "No data" and the reason underneath. Parse failure: "Couldn't read this page. YouTube may have changed something." Theme follows YouTube: dark tokens when `document.documentElement.hasAttribute('dark')`. Panel lives in a shadow root inserted at the top of `#secondary`; one host element, reused across navigations.

- [ ] **Step 1: Failing tests**
  - store: `keeps only the latest observation per video`; `evicts beyond MAX_VIDEOS` (record 2001 ids → the first is gone).
  - baseline: `caches for an hour` (two calls within TTL → fetch called once; after TTL → twice); `HTTP error becomes ok:false` (fetch resolves 404 → `reason 'HTTP 404'`); `network error becomes ok:false` (fetch rejects).
  - panel: `renders values and why-line` (contains `×3` and `usually gets 30,000`); `renders no data with reason`; `renders parse failure`; `uses dark tokens when YouTube is dark`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement the three modules.
- [ ] **Step 4:** Implement `youtube.content.ts` (isolated world): on each valid `PlayerMessage` → `guard.next(url)`; parse; read previous observation; record the current one; fetch baseline from `https://www.youtube.com/feeds/videos.xml?channel_id=…`; drop the result if `!guard.isCurrent(seq, location.href)`; render. Wrap the whole handler in try/catch → render error state; never let an exception escape into the page.
- [ ] **Step 5:** Run unit tests; PASS. Commit `feat(extension): scorecard panel with local observations and RSS baseline`.

### Task 9: End-to-end check and manual live check

**Files:** Create `apps/extension/e2e/scorecard.spec.ts`, `e2e/fixtures/watch.html`, `e2e/fixtures/feed.xml`, `apps/extension/playwright.config.ts`; modify `README.md` (create) with "Load the extension" steps.

**Interfaces:** Consumes the built extension from Task 8.

- [ ] **Step 1: Write the e2e test.** Launch Chromium with the built extension (`--load-extension`, persistent context). `context.route('https://www.youtube.com/**')`: serve `watch.html` for `/watch?v=VID1` (defines `#movie_player` with `getPlayerResponse()` returning trimmed `player-watch.json` data with `videoId` VID1, plus a `#secondary` element) and `feed.xml` for the feed URL (6 long videos, median 30,000; VID1 views 90,000). Assertions: panel shows `×3`; `Views / hour` tile shows a number with "avg since upload". Second case: dispatch `yt-navigate-finish` after swapping the player data to VID2 and `history.pushState` to `?v=VID2` → panel title shows VID2's title, not VID1's. Third case: feed route returns 404 → `vs usual` tile shows "No data" and `HTTP 404`, VPH tile still shows a number.
- [ ] **Step 2:** Run `pnpm --filter extension e2e`; expect FAIL before the routes/fixtures are complete, then PASS.
- [ ] **Step 3: Manual live check (budget: 3 page loads).** Load unpacked from `.output/chrome-mv3` in your own Chrome; open one normal video, one live stream, one video from a channel with under 5 uploads. Take a screenshot of each panel into `docs/ui/extension-p1-live/` and check by eye: ×N and why-line match the channel's feed numbers; live shows "Live or upcoming video"; small channel shows the "Needs 5 earlier videos" reason. Confirm in DevTools → Network that the extension made no request outside `www.youtube.com`.
- [ ] **Step 4:** README: install (`pnpm install`, `pnpm --filter extension build`, load unpacked), what the panel shows, the no-server/no-data-sent statement.
- [ ] **Step 5:** Run `pnpm test && pnpm typecheck && pnpm --filter extension e2e`; all pass. Commit `test(extension): end-to-end scorecard check; README`.
