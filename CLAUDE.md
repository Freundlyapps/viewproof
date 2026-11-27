# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ViewProof is an open-source (AGPL-3.0) YouTube research tool, an alternative to vidIQ that shows where every number comes from. It is a pnpm monorepo (Node 24+, pnpm 10) with a browser extension, a Cloudflare Worker server and a React web app. The README is the user-facing spec; keep it accurate when behaviour changes.

## Commands

```bash
pnpm install
pnpm test                      # every workspace's vitest suite (what CI runs, after typecheck)
pnpm typecheck                 # every workspace (api also typechecks eval/, extension runs `wxt prepare` first)
pnpm check:privacy             # CI blocker: scans tracked files for stream URLs, IPs in fixtures, secrets files

# One workspace / one file / one test
pnpm --filter api test
pnpm --filter api exec vitest run test/agent.test.ts
pnpm --filter web exec vitest run test/brief.test.tsx -t "part of the test name"
pnpm --filter @viewproof/core exec vitest run test/outlier.test.ts

# Local server (Worker + built web app at http://localhost:8787/app)
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in Google OAuth client + TOKEN_KEY (openssl rand -base64 32)
pnpm --filter api db:migrate:local
pnpm dev                       # builds web, then `wrangler dev`; restart after code changes (no file watching on WSL /mnt drives)
pnpm --filter web dev          # optional Vite hot reload on :5173/app/, proxies API to :8787

# Extension
pnpm --filter extension build  # load apps/extension/.output/chrome-mv3 unpacked
pnpm --filter extension e2e    # builds, runs Playwright against fake YouTube pages (needs `playwright install chromium --no-shell` once)

pnpm --filter api eval         # model eval: sends real requests to candidates in apps/api/eval/candidates.json (needs EVAL_* keys)
```

Live checks (`pnpm --filter @viewproof/core canary`, `apps/extension/e2e/*-live-check.mjs`, `apps/api/scripts/ai-live-check.mjs`) hit real YouTube / real AI providers. Run them manually, a handful of requests at most, never in a loop.

## Architecture

- **`packages/core`** (`@viewproof/core`): pure logic shared by everything: parsers for YouTube page/player/feed data, scores (views per hour, outlier ×N), checklist and Optimize rules, period comparisons, the weekly-brief measurement arithmetic (`agent.ts`), and the API request/response types (`api-types.ts`) used by both server and web app. No I/O. Packages are consumed as TypeScript source (`exports: ./src/index.ts`), no build step.
- **`packages/db`**: D1 SQL migrations (`migrations/NNNN_*.sql`, numbered, append-only) plus row-shape interfaces in `src/index.ts` that must match them. Tests apply all migrations to a fresh D1.
- **`packages/providers`**: external providers behind interfaces: `KeywordProvider` (DataForSEO) and `llmClient` (Anthropic, OpenAI, Gemini, DeepSeek, OpenRouter, custom OpenAI-compatible).
- **`apps/api`**: Cloudflare Worker using Hono + D1 + R2. `src/index.ts` builds real clients and passes them as `Deps` into `createApp(deps)` (`src/app.ts`); the same file's `scheduled` handler runs the hourly cron (`17 * * * *`: competitor feeds, pool archive/prune, weekly briefs). Every external dependency (Google, YouTube, feeds, LLM, Stripe, clock) lives in `Deps`, so tests inject fakes via `makeDeps()` in `test/helpers.ts` (`fake-google.ts`, `fake-youtube.ts`, `fake-stripe.ts`). Server-rendered pages (home, account, legal) are Hono JSX in `src/views`; the React app is served from `apps/web/dist` via the `ASSETS` binding at `/app`. Feature areas: `routes/` (auth, connect, channel analytics, keywords, account), `competitors/`, `pool/` (data pool + outliers), `ai/`, `agent/` (weekly brief), `mcp/` (read-only MCP server at `/mcp`, bearer tokens), `billing/` (Stripe, optional).
- **`apps/web`**: React 19 + react-router SPA built with Vite into `apps/web/dist/app`. Talks to the API through `src/api.ts`; tests use `test/fake-api.ts` and `test/fake-extension.ts` with happy-dom.
- **`apps/extension`**: WXT, Manifest V3. `youtube-main.content.ts` runs in YouTube's MAIN world only to read data the page already loaded (player response, search results, channel grid) and posts it to the isolated-world `youtube.content.ts`, which renders panels/badges. `viewproof-app.content.ts` runs on ViewProof's own origins (`src/app-origins.ts`) and answers the web app over `window.postMessage` (`src/app-bridge.ts`: keyword snapshots, pool linking, Tools lookups, transcripts). The extension, not the server, does all YouTube page reads.

### Testing notes

- API tests run inside workerd via `@cloudflare/vitest-pool-workers`, single worker, no file parallelism (parallel workerd start-ups crash on the WSL `/mnt/f` mount). They are slow; run single files while iterating. No test contacts Google or any AI provider.
- Parser tests use real captured YouTube JSON in `packages/core/test/fixtures`. Fixtures must be captured logged-out, stripped of `googlevideo.com` stream URLs (`streamingData`, `playerAds`, etc. carry the capturer's IP), and note the capture date in the test file's first comment. See CONTRIBUTING.md.

## Product rules that constrain code

- **No derived metrics from YouTube API data** (YouTube developer policy III.E.4.h): show YouTube's own values labelled REAL/ESTIMATE with the previous period; don't compute ratios/percentages/scores from Analytics or Data API numbers. Calculators in Tools only use numbers the user types. Scores like views/hour and ×N come from public page/feed data in the extension.
- **Say "No data" and why** rather than fill gaps; MCP tools return `no_data` with a reason.
- **AI never computes numbers.** Brief/Ask AI answers cite sources `[S1]…`; suggestions whose reasons contain numbers not in the sent data are dropped. Measurement is plain arithmetic in `packages/core/src/agent.ts`.
- **Hosted vs self-hosted**: `SELF_HOSTED=true` removes plan limits and billing. Limits live in `apps/api/src/plans.ts`/`usage.ts`; billing is on only when all three Stripe vars are set.
- **Privacy pages are generated from the server's actual config** (`views/Legal.tsx`, checked by `legal-truth.test.ts`, which fails on a new table, cookie, OAuth scope or pool field the pages don't cover); when adding storage or a third party, update them and the "What is stored" section of `apps/api/README.md`.
- State-changing requests must come from `APP_URL`'s origin (middleware in `app.ts`); only `/api/pool/contribute`, `/api/billing/webhook` and `/mcp` use bearer/signature credentials instead.

## Workflow

- Commit messages use conventional prefixes (`feat:`, `fix:`, `fix(security):`, `chore:`). PRs target `main` and are squash-merged; `main` is never rewritten.
- Design spec and per-phase implementation plans are in `docs/superpowers/specs` and `docs/superpowers/plans`; check the relevant plan before extending a feature.
- Never commit `.dev.vars`, `.env`, cookies, OAuth tokens or HAR files.
