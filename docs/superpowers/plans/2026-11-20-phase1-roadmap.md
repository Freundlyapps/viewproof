# open-IQ Phase 1 — roadmap of build plans

Phase 1 (spec §8 items 1–9c) spans several subsystems: extension, API, web app, keyword providers, AI, billing. It is split into plans that each ship working, testable software, in this order. Each plan gets its own detailed file when the previous one is merged, so later plans can use real interfaces instead of guessed ones.

| # | Plan | Ships | Spec items | Depends on |
|---|------|-------|-----------|------------|
| 1 | **Core scores + extension scorecard** (`2026-11-20-p1-1-core-and-extension.md`) | Monorepo; `packages/core` (VPH, outlier ×N, feed + player parsers); Chrome/Edge extension showing VPH, ×N with reasons, tags, age on watch pages — no server needed (D1) | 1, D1, D4 | — |
| 2 | API skeleton + accounts + channel connect | Hono Worker, D1 schema, Google sign-in with read-only scopes, "Is this the right channel?" flow, removed-channel state, data export/delete; runs under `wrangler dev` | 2 (connect), D3, D5, D8, D9, §10 | 1 |
| 3 | Web app shell + My channel | React/Vite app with the §15 design tokens and navigation; My channel tabs (Overview, Videos, Search terms, Earnings), best time to post, needs-attention list | 2, 9c, §15 | 2 |
| 4 | Keyword research | `KeywordProvider` interface; no-vendor provider (own search terms, top-results facts); DataForSEO adapter behind a flag until its written OK; 30-day shared cache; Research → Keywords UI | 3, D2 | 3 |
| 5 | Competitors, outliers pool, data contribution | RSS Cron polling, tracked channels, opt-in S2 contribution with consent screen + "what my browser shared" log, D6 integrity checks, R2 day partitions with 36-month lifecycle; Research → Outliers, Competitors UI; extension panels on channel + search pages, per-page toggles, checklist | 4, 5, 9, D6, Q1 | 3 |
| 6 | AI + MCP | Provider-agnostic LLM router (included model + BYO encrypted keys, D7), quick actions, Ask AI with cited sources, title checker (9a), MCP read-only endpoint; pre-launch model eval | 6, 7, 9a, 09 update | 4, 5 |
| 7 | Billing + limits | Stripe Managed Payments checkout/portal, one-click cancel, renewal reminder, hard limits with counters per 09, Settings → Plan & usage | 8, §9 | 3 |
| 8 | Tools + self-host release | Tools page (9b), Docker Compose under workerd, README install paths, closed-beta checklist (≤100 users, OAuth verification, quota extension request) | 9b, D3, D8 | 2–7 |

