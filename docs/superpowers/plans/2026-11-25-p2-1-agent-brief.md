# Plan P2-1: the weekly brief agent (propose → approve → measure)

**Goal:** Start Phase 2 item 12 ("next video" engine) and 14g (scheduled AI jobs) with an agent that proposes, waits for the creator's approval, and then measures the result from the creator's own YouTube Analytics. The measuring step is what other tools don't do: they give advice and never check whether it worked.

**Architecture:** One AI call per brief. Code chooses which videos may get a title change, sends them with the usual sources, and checks the answer: unknown videos, bad titles and reasons that cite numbers missing from the data are dropped, and the drop count is shown. The creator approves; the hourly job sees the new title live (Data API `videos.list`, 1 unit), then at 7 and 28 days compares views and YouTube-search views over the same number of days before and after, next to the video's normal rise and fall between earlier periods. That is pure code in `packages/core/src/agent.ts`; the AI never computes these numbers.

**Models:** quick actions on the cheap model (Claude Haiku 5.5), Ask AI on the deeper one (Sonnet 5.5), the brief on `AI_BRIEF_MODEL` (defaults to the Ask AI model). Own keys use their Ask AI model. Every answer's token counts are summed per month, task and model in `ai_tokens` (no account link): the measured cost.

## Constraints

- Facts, not scores (III.E.4.h): show before/after counts, the change in percent and the biggest earlier period-to-period change. No "impact score". Never say the change caused a move; say when we can't tell.
- The agent never writes to YouTube; the creator changes the title in Studio.
- Weekly runs only for users who switch them on. A failed run waits a day (no hourly retries spending tokens).
- Retention: briefs 30 days; changes until 60 days after the last check; deleted with the channel or account; included in the export. The privacy page says so.
- Limits: Free 0 (own key: no limit), Pro 6 a month, self-hosted no limit. An unusable AI answer isn't counted.

## Built

- [x] `packages/core/src/agent.ts`: `measureChange`, `pickCandidates`, `describeMetric` + tests.
- [x] Migration `0013_agent.sql`: `agent_settings`, `agent_briefs`, `agent_changes`, `ai_tokens`, `ai_usage.brief`.
- [x] `apps/api/src/agent/brief.ts` (prompt, `parseBrief`, `runBrief`), `checks.ts` (hourly job), `routes.ts` (`GET /api/agent`, `POST /api/agent/settings|brief|changes/:id`).
- [x] `groundedNumbers` moved from the eval into `src/ai/grounded.ts` so it runs live.
- [x] Router task `brief`, `AI_BRIEF_MODEL`, plan limit `aiBrief`, usage row, token recording for all AI tasks.
- [x] Home → "What to make next" card (ideas with citations, data used, title changes with approve/dismiss, Studio link, 7/28-day checks).
- [x] Privacy page, README, export, channel/account deletion.
- [x] Eval: two brief cases, `changes` check, measured cost per Pro user per month (Haiku 5.5, Sonnet 5.5, Fable 5.2 priced).

## Open

- Run `pnpm --filter api eval` with `EVAL_ANTHROPIC_KEY` to measure real tokens and quality for Haiku vs Sonnet vs Fable on the brief, then set `AI_BRIEF_MODEL` for the hosted service.
- The first day a title is "live" is the day the job first sees it (checked daily), so the after-period can start up to a day late.
- Later: thumbnails and descriptions as changes; a track record across changes ("titles you changed: N above their usual swing").
