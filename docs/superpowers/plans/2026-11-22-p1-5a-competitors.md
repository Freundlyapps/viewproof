# Competitors (plan 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator tracks up to 25 competitor channels and sees their new uploads, each video's views, views per hour and ×N against the channel's usual, plus a views-over-time line per video built from ViewProof's own repeated checks.

**Architecture:** Roadmap row 5 is split: **5a** (this plan) = competitors from public RSS feeds (S4), polled by Cron and on demand, snapshots in D1; **5b** (next) = opt-in data pool, Outliers, extension panels. Feeds are fetched by the Worker (quota-free, public, not API data), parsed with plan 1's `parseChannelFeed`, and each video's view count is stored as a snapshot when it changes. Current subscriber/total-view counts come from the YouTube Data API only when the server has `YOUTUBE_API_KEY` (or the adding user's own token for resolving a handle); they are overwritten daily, shown "as of <date>", never charted or computed with (III.E.4.h, III.E.4.a 30-day limit).

**Tech Stack:** as plans 2–4; Workers Cron Triggers (`[triggers] crons`, `scheduled` handler).

**Spec:** `docs/superpowers/specs/2026-11-20-viewproof-design.md` (§6 S4, §7 VPH and outlier score, §8 item 4, §15). Roadmap row 5 (split ruled here).

## Global Constraints

- Owner's rule: real measurements or `no_data` with a reason; never a placeholder number.
- VPH and ×N use plan 1's core functions (`viewsPerHour`, `outlierScore`) unchanged — same formulas as the extension. VPH "delta" mode = between two of ViewProof's own checks ≥ 60 min apart; otherwise "average since upload".
- RSS lists only the latest 15 uploads: counts over it say so ("in the feed's latest 15").
- Data API values (subscribers, total views, video count) are shown as YouTube returned them with "as of"; never stored longer than 30 days, never charted, never used in a computation. Labelled REAL · YouTube Data API. RSS-derived numbers labelled REAL · public feed.
- Limit: 25 tracked channels per user (spec §8 item 4).
- No hammering: a channel's feed is fetched at most once per 3 hours, whatever the number of users tracking it; a Cron run polls at most 60 channels; a request triggers at most 3 polls.
- Tests use the plan 1 feed fixtures; no test fetches YouTube.

## Review Focus

1. A feed fetch fails (404 for a deleted channel, 5xx, HTML instead of XML) → channel keeps its last data with "Feed check failed: <reason>, <time>"; no snapshot written; retried next window. Test: Task 2 "failed poll".
2. Two users track the same channel → one feed fetch per window, one set of snapshots; removing it for one user keeps it for the other. Test: Task 3 "shared channel".
3. Pasted input forms: `https://www.youtube.com/channel/UC…`, `UC…`, `@handle`, `https://www.youtube.com/@handle/videos`, garbage → resolved or a clear message; no API key and no connected channel → handles explain how to paste the /channel/ link. Test: Task 1 "parseChannelInput", Task 3 "add by handle without a key".
4. A brand-new upload (< 1 h) or a live/upcoming one → VPH/×N `no_data` with reason. Test: Task 1 "video stats edge cases".
5. Account deletion removes the user's tracked list; channels nobody tracks are dropped with their snapshots by the next Cron run. Test: Task 3 "orphans pruned".

---

### Task 1: Core — input parsing, feed meta, per-video stats, channel summary

**Files:** Create `packages/core/src/competitors.ts`, `packages/core/test/competitors.test.ts`; modify `feed.ts` (export `parseFeedChannel`), `index.ts`, `api-types.ts`.

**Interfaces (produces):**
- `parseChannelInput(s: string): { kind: 'id'; channelId: string } | { kind: 'handle'; handle: string } | { kind: 'invalid'; reason: string }` — accepts the forms in Review Focus 3; handle normalised to `@name` lowercase.
- `parseFeedChannel(xml: string): { channelId: string; title: string } | null` — from `<feed>` (`yt:channelId` prefixed with `UC`, or the alternate link), title from `<title>`/`<author><name>`.
- `interface Snapshot { views: number; at: string }`
- `videoStats(v: { videoId; title; publishedAt; format; views: number | null }, snapshots: Snapshot[] /* oldest first */, feed: FeedVideo[], nowIso: string): CompetitorVideo` where `CompetitorVideo = { videoId; title; publishedAt; format; views: Measured<number>; vph: Measured<number>; outlier: Measured<number>; history: Snapshot[] }`. VPH: current = latest snapshot; previous = the newest snapshot ≥ 60 min older; `viewsPerHour`. ×N: `outlierScore` with `isLive:false,isUpcoming:false`, baseline = feed.
- `channelSummary(feed: FeedVideo[], nowIso: string): { latestUploadAt: string | null; inLast30Days: { count: number; ofFeed: number }; medianViewsLong: Measured<number>; medianViewsShorts: Measured<number> }`.
- api-types: `Competitor`, `CompetitorDetail`, `CompetitorUploads` (see Task 3).

- [ ] Tests: "parseChannelInput" (each form, garbage → `invalid` "Paste a channel link, its @handle or its UC… id."); "feed meta from fixture" (`UCHnyfMqiRRG1u-2MsSQLbXA`, `Veritasium`); "video stats" (two snapshots 2 h apart → delta mode; one snapshot → since upload); "video stats edge cases" (< 1 h old → no_data; views null → no_data); "channel summary from fixture" (median of long vs shorts computed by core `median` over the fixture's parsed views).
- [ ] Run (FAIL) → implement → run (PASS) → commit `feat(core): competitor input parsing, video stats and channel summary`.

### Task 2: DB + feed poller

**Files:** `packages/db/migrations/0005_competitors.sql`, `packages/db/src/index.ts`; `apps/api/src/competitors/poll.ts`; test `apps/api/test/competitors-poll.test.ts`.

**Schema:**
- `tracked_channels(channel_id PK, title, handle NULL, last_polled_at NULL, last_poll_ok_at NULL, last_poll_error NULL, subscribers NULL, total_views NULL, video_count NULL, stats_at NULL, created_at)`
- `user_competitors(user_id → users ON DELETE CASCADE, channel_id → tracked_channels ON DELETE CASCADE, added_at, PK(user_id, channel_id))`
- `feed_videos(video_id PK, channel_id → tracked_channels ON DELETE CASCADE, title, published_at, format, first_seen_at)`
- `video_snapshots(video_id → feed_videos ON DELETE CASCADE, at, views, PK(video_id, at))`

**Interfaces:**
- `Deps.fetchFeed(channelId): Promise<{ ok: true; xml: string } | { ok: false; reason: string }>` (index.ts: `fetch('https://www.youtube.com/feeds/videos.xml?channel_id=…')`, no cookies).
- `pollChannel(deps, channelId): Promise<'polled' | 'skipped' | { error: string }>` — skipped when polled < 3 h ago; on success upserts videos (title can change), writes a snapshot when views differ from the latest or the latest is ≥ 24 h old, sets `last_polled_at`/`last_poll_ok_at`, clears error; on failure sets `last_polled_at` and `last_poll_error`.
- `pollStale(deps, max): Promise<number>` — oldest `last_polled_at` first.
- `pruneCompetitors(deps)` — delete tracked channels with no user (all data cascades); delete snapshots older than 90 days; null Data API stats older than 30 days.

- [ ] Tests: "first poll stores videos and snapshots"; "unchanged views write no new snapshot within 24 h"; "skipped within 3 h"; "failed poll" (404 and HTML body → error kept, data kept); "pollStale order and cap"; "prune".
- [ ] Run (FAIL) → implement → run (PASS) → commit `feat(api): competitor feed poller with snapshots`.

### Task 3: API routes, Data API stats, Cron

**Files:** `apps/api/src/competitors/routes.ts`, `apps/api/src/competitors/stats.ts`, `apps/api/src/index.ts` (`scheduled`), `apps/api/wrangler.toml` (`[triggers] crons = ["17 * * * *"]`), `env.ts` (`YOUTUBE_API_KEY?`), `app.ts` (`Deps.fetchFeed`, `Deps.channelStats`), `routes/account.ts` (export includes tracked list); test `apps/api/test/competitors.test.ts`.

**Interfaces:**
- `ChannelStatsClient { byIds(ids: string[]): Promise<Map<string, { title; subscribers: number | null; totalViews; videoCount }> | { error }>; byHandle(handle, accessToken?): Promise<string | null | { error }> }` — Data API `channels.list` (`part=snippet,statistics`, `id=` ≤ 50 / `forHandle=`), key or bearer token. Hidden subscriber counts → null.
- `GET /api/competitors` → `Competitor[]` (`channelId, title, handle, addedAt, lastCheckedAt, checkError, subscribers: Measured<number> (as of), summary`); triggers ≤ 3 stale polls first.
- `POST /api/competitors` JSON `{ input }` → 201 `Competitor` | 400 invalid | 404 "No YouTube channel found for <input>" | 409 already tracked | 422 `{ error: 'limit', message: 'You can track up to 25 channels.' }` | 400 handle without key/token: "To add by @handle, connect your channel (Account) or paste the channel's /channel/UC… link.".
- `DELETE /api/competitors/:channelId` → 204.
- `GET /api/competitors/:channelId` → `CompetitorDetail` (summary + `videos: CompetitorVideo[]` from the feed's 15, sorted newest first) — polls if stale; 404 if not tracked by this user.
- `GET /api/competitors/uploads` → `{ uploads: (CompetitorVideo & { channelId; channelTitle })[] }` newest 50 across the user's channels.
- `scheduled`: `pollStale(deps, 60)`; once a day (hour 3 UTC) refresh stats by ids in batches of 50 when a key exists; `pruneCompetitors`.

- [ ] Tests: "add by /channel/ link, list, detail"; "add by handle without a key"; "add by handle with key"; "limit 25"; "already tracked → 409"; "shared channel" (two users, one fetch); "other user's channel → 404"; "remove"; "orphans pruned after account deletion"; "scheduled polls stale channels"; "stats shown as of, null when hidden or no key".
- [ ] Run (FAIL) → implement → run new file, then whole api suite → commit `feat(api): competitors endpoints, Data API stats and Cron`.

### Task 4: Web — Competitors page

**Files:** `apps/web/src/competitors/{Competitors.tsx,CompetitorDetail.tsx,Uploads.tsx,ViewsLine.tsx}`, `App.tsx` (routes `/competitors`, `/competitors/:channelId`), `shell/nav.ts` (not soon, section `/competitors`), test `apps/web/test/competitors.test.tsx`.

- Page: add form (label "Channel", button "Track"), counter "N of 25", tabs "New uploads" | "Channels". Channels table: title (link to detail), subscribers (Value + "as of"), latest upload age, "N of the feed's latest 15 in the last 30 days", median views long/Shorts, last check / error, Remove. New uploads: thumbnail, title → YouTube, channel, age, views, VPH (with mode tooltip), ×N badge (amber, §15), sorted newest; sort chips Views / VPH / ×N.
- Detail: header with stats, videos table (same columns), click a row → ViewsLine (views over time from snapshots, single series, accent colour, table view, hover title per point).
- Empty states: no channels → "Track a competitor by pasting its channel link or @handle."; feed error shown per channel.

- [ ] Tests: "nav Competitors not soon"; "add shows it and the counter"; "add error message"; "uploads sorted by VPH"; "×N and no_data reasons"; "detail views line and table"; "remove".
- [ ] Run (FAIL) → implement → run (PASS), build → commit `feat(web): Competitors`.

### Task 5: Docs and live check

- [ ] README (status 1–5a, Competitors section, sources/labels, YOUTUBE_API_KEY), api README (Cron, env, what's stored, retention), `.dev.vars.example`.
- [ ] One live feed fetch of a real channel through the local server (budget: 1 feed), all suites green → commit `docs: competitors`.
