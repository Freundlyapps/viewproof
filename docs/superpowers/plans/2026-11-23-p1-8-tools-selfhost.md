# Plan 8: Tools page + self-host release + closed-beta checklist

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship roadmap row 8: the Tools page (spec 9b), a Docker Compose self-host path under workerd (D3), README install paths, and what the closed beta needs (D8): privacy/terms pages and a checklist.

**Architecture:** Tools are client-side math on the user's own numbers, plus two extension-backed tools (tags of any video, transcripts the user opened on YouTube); no server data cost. Docker runs the same Worker with `wrangler dev` (workerd + Miniflare) on a persisted volume, plus a tiny cron sidecar. Legal pages are server-rendered like Home.

**Tech Stack:** Hono JSX views, React 19, WXT extension, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-20-viewproof-design.md` (9b, D3, D8, §10, §15), roadmap row 8.

## Global Constraints

- 9b: "Small real tools (zero data cost): tag extractor page, chapter validator (YouTube's chapter rules), transcript viewer (fetched in the user's own browser by the extension), engagement-rate and watch-time calculators on the user's numbers."
- YouTube policy III.E.4.h: calculators never prefill from YouTube API data; they compute only numbers the user typed.
- Extension network: only youtube.com, `credentials: 'omit'`, rate-limited, paused 24 h on refusal (same as suggest).
- No fabricated data: a tool that can't get data says so and why.
- D3: "a Docker Compose file that runs the same Worker under workerd with local persistence. No separate Node server."
- Secrets never in the image or compose file; `.dev.vars` mounted or env_file.
- Never commit real YouTube pages (they carry the capturing IP); fixtures are synthetic.

## Review Focus

1. Watch HTML without `ytInitialPlayerResponse` (consent page, bot check) → tag tool says why, never shows empty tags as "no tags".
2. Transcript panel with no segments / a different panel layout → nothing stored, no partial transcript claimed.
3. Calculators with 0 views or empty fields → "Enter …", never NaN or Infinity.
4. Docker restart → database and sessions survive (volume), migrations re-run idempotently.
5. `/privacy` without `CONTACT_EMAIL` set → page still renders and says the operator hasn't set one.

---

### Task 1: Core helpers

**Files:** Create `packages/core/src/tools.ts`, `packages/core/test/tools.test.ts`; export from `index.ts`.

**Produces:**
- `extractPlayerResponse(html: string): unknown | null`: JSON after `ytInitialPlayerResponse =` read by balanced braces (string-aware); null when absent or invalid.
- `videoIdFromInput(s: string): string | null`: watch, youtu.be, shorts, embed, live URLs or a bare 11-char id.
- `engagementRate({views, likes, comments}): {ok:true; percent:number} | {ok:false; reason}`: (likes+comments)/views×100; views must be > 0, all whole numbers ≥ 0.
- `watchTime({views, avgSec}) → hours`; `avgViewDuration({views, hours}) → seconds`; same ok/reason shape.
- `transcriptText(segments: {startSec:number; text:string}[], withTimes: boolean): string`.
- `parseTimestamp("1:02:03") → 3723 | null`.

Tests: id forms; extraction from synthetic HTML with braces inside strings; missing var → null; rates incl. zero views and non-numbers; timestamps.

### Task 2: Extension

**Files:** Create `apps/extension/src/tools.ts` (`videoLookup` limiter, `transcriptStore`, `readTranscriptPanel(root)`), tests `apps/extension/test/tools.test.ts`; modify `app-bridge.ts`, `background.ts`, `viewproof-app.content.ts`, `youtube.content.ts`.

- `videoLookup(deps)`: `lookup(videoId)` fetches `https://www.youtube.com/watch?v=<id>&hl=en` with `credentials:'omit'`, extracts + `parsePlayerResponse`. ≤ 30 per hour, 6 h cache, 24 h pause on HTTP refusal (non-ok); network errors don't pause. Result `{ok:true; video:{videoId,title,channelId,tags,description,lengthSeconds}} | {ok:false; reason}`.
- `readTranscriptPanel(root: ParentNode)`: reads `ytd-transcript-segment-renderer` (`.segment-timestamp`, `.segment-text`); returns segments or null when none.
- `transcriptStore(area)`: keep the 20 most recent, 30 days; `put({videoId,title,segments}, now)`, `list(now)`.
- Watch content script: watch the transcript panel (MutationObserver on `ytd-engagement-panel-section-list-renderer`) and store when segments appear.
- Bridge: `viewproof:video-request {id, videoId}` → `viewproof:video-response {id, result}`; `viewproof:transcripts-request {id}` → `viewproof:transcripts-response {id, items}`.

Ruling: no YouTube transcript/caption endpoint is called. Caption URLs now need a proof-of-origin token (checked: empty body), and the transcript panel endpoint is undocumented. The extension reads the panel the user opens themselves.

### Task 3: Web Tools page

**Files:** Create `apps/web/src/tools/Tools.tsx`, `TagTool.tsx`, `ChapterTool.tsx`, `TranscriptTool.tsx`, `Calculators.tsx`; modify `App.tsx`, `shell/nav.ts` (drop `soon`), `research/extension.ts` (`lookupVideo`, `listTranscripts`); test `apps/web/test/tools.test.tsx`.

Tabs: Tags · Chapters · Transcripts · Calculators (`/tools/:tab?`).
- Tags: paste link → tags list, character total vs 500, Copy tags, "Check chapters" (fills the chapter tool with its description and length). No extension → install text.
- Chapters: description + optional video length → `parseChapters` result: list with times, or the reason.
- Transcripts: list from the extension; open one → text with timestamps, Copy, Download .txt, search box. Empty: how to open YouTube's transcript panel.
- Calculators: engagement rate; watch time (views × avg duration); average view duration (hours ÷ views). Labelled "Your numbers".

### Task 4: Self-host: Docker Compose

**Files:** Create `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/docker-start.sh`, `scripts/docker-cron.sh`; README "Self-hosting".

- Image: `node:24-bookworm-slim`, pnpm via corepack, `pnpm install --frozen-lockfile`, build web.
- Start: apply D1 migrations `--local --persist-to /data`, then `wrangler dev --ip 0.0.0.0 --port 8787 --persist-to /data --test-scheduled` with `SELF_HOSTED=true` and `APP_URL` from env.
- Cron sidecar: `curl` the scheduled handler every hour at minute 17.
- Verify: `docker compose up -d`, `/health` ok, restart keeps a row in D1.

### Task 5: Closed beta: legal pages + checklist

**Files:** Create `apps/api/src/views/Legal.tsx`, test `apps/api/test/legal.test.ts`, `docs/closed-beta.md`; modify `app.ts`, `env.ts`, `Layout.tsx` (footer links), `.dev.vars.example`.

- `GET /privacy`, `GET /terms`: plain pages from the README facts, including the Google API Services User Data Policy "Limited Use" statement and how to revoke access. `CONTACT_EMAIL` and `OPERATOR_NAME` env; missing → "The operator of this server hasn't set a contact address."
- Checklist: Google Cloud test users (≤100), OAuth verification items (homepage, privacy URL, scope justifications, demo video, domain verification), YouTube API Services audit + quota extension, Stripe live keys, DataForSEO written OK, R2 lifecycle, secrets list.
