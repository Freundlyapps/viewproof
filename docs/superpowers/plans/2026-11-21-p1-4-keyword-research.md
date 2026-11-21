# Keyword research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator opens Research → Keywords, types a keyword and gets a report built only from real, labelled sources: facts about YouTube's top results for that search (read in their own browser), YouTube's own suggestions (related, questions, matching), their own channel's real search terms that match, and, when a licensed vendor is switched on, an estimated volume labelled as an estimate.

**Architecture:** No-vendor path first (spec D2). The extension reads the search page the user loads on YouTube (as it already reads watch pages), parses it with `packages/core`, and keeps the snapshot **in the browser** (`chrome.storage.local`); a small content script on ViewProof's own origins hands snapshots and YouTube suggestions to the web app over `window.postMessage`. Nothing gathered by the extension goes to the server in this plan (pooling is plan 5, behind consent). The Worker adds two endpoints: the creator's matching search terms (S1, reusing the plan 3 cache) and an estimate from a `KeywordProvider` (new `packages/providers`), with a 30-day shared D1 cache. The DataForSEO adapter is built and tested against documented response shapes, and is off unless `DATAFORSEO_DISPLAY_OK=yes`.

**Tech Stack:** as plan 3 (React 19.3, react-router 8.5, Vite 8.3, Vitest 4.1, Hono 4 Worker, D1) + WXT 0.21 extension (MV3: MAIN-world and isolated content scripts, one background service worker).

**Spec:** `docs/superpowers/specs/2026-11-20-viewproof-design.md` (§6 S1/S2/S5, §7 "Keyword report" and "Your search terms", §8 item 3, §10, §11 parser canary, D2, §15). Roadmap row 4: `docs/superpowers/plans/2026-11-20-phase1-roadmap.md`.

## Global Constraints

- Owner's rule: real measurements or an explicit null with a reason, never a plausible placeholder. "A keyword with no data at every source shows 'no data', never a number." (§7)
- "competition = facts about the top-20 results … shown as numbers, plus a plain-language summary — no single opaque 0–100 number." (§7)
- Policy III.E.4.h: no derived metrics from YouTube **API** data. Top-results facts come from the search page the user loaded (S2-style, not API data), so medians/counts over them are allowed; the creator's search terms (API data) are shown as YouTube returned them, only filtered. Non-YouTube numbers next to API data carry a clear disclosure: estimates say "Estimate — clickstream panel, not YouTube data" (§6 S5).
- Labels (§15): REAL (teal) for YouTube's own values (search terms, page facts); ESTIMATE (amber) for vendor volume and YouTube's "about N results".
- Extension privacy (§10): host permissions YouTube domains only (`https://www.youtube.com/*`, `https://suggestqueries-clients6.youtube.com/*`); content script on ViewProof origins only (`https://viewproof.app/*`, `http://localhost:8787/*`, `http://localhost:5173/*`). No cookies or tokens leave the browser; snapshots stay in `chrome.storage.local`.
- Suggestion requests are user-initiated (opening a report) and throttled: ≤ 60 per hour per browser; any non-200 or non-JSONP answer → stop for 24 h (S3 back-off rule).
- Parser canary (§11): a search page with results in its markup but zero parsed videos is an error ("YouTube changed its search page"), never an empty report.
- DataForSEO stays off on the hosted service until its written OK (spec S5); cached 30 days and shared across users.
- Tests use the captured fixtures (`packages/core/test/fixtures/search-results-en.json`, `suggest-en.txt`); no test calls YouTube or DataForSEO. Live-call budget for the whole plan: the two captures already taken.

## Review Focus

1. A search with filters (`sp=` in the URL, e.g. "this week" or "Shorts only") is not a normal top-results page → it is not stored as the keyword's snapshot. Test: Task 4 "filtered searches are not stored".
2. The YouTube UI in German ("vor 4 Jahren", "1.234.567 Aufrufe") → views parse, ages parse; an unknown language gives age `no_data` with a reason, never 0. Test: Task 1 "German page", "unknown language".
3. Extension not installed, or installed but no snapshot for this keyword → the page says exactly that and offers "Search on YouTube"; no empty facts table. Test: Task 6 "no extension", "no snapshot yet".
4. Keyword typed with different case/spacing than the YouTube search ("Pottery  Wheel" vs "pottery wheel") → same snapshot. Test: Task 1 "normalizeKeyword"; Task 4 uses it for the storage key.
5. No connected channel, or channel needs reconnect → "Your search terms" shows the reason; the rest of the report still works. Test: Task 6 "report without a channel".

---

### Task 1: Search page and suggestion parsing, facts and summary (`packages/core`)

**Files:**
- Create: `packages/core/src/keywords.ts`; Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/test/keywords.test.ts` (fixtures already captured)

**Interfaces:**
- Produces:
  - `normalizeKeyword(s: string): string` — NFKC, lowercase, trim, collapse whitespace.
  - `interface SearchResult { videoId: string; title: string; channelId: string | null; channelName: string; views: Measured<number>; ageDays: Measured<number>; ageLabel: string | null; durationSec: number | null; live: boolean }`
  - `interface SearchPage { query: string; results: SearchResult[]; shortsShelves: number; estimatedResults: number | null }`
  - `parseSearchPage(response: unknown, query: string): SearchPage | { error: string }` — accepts `ytInitialData` or the `response` object of a `yt-navigate-finish` event (same `contents.twoColumnSearchResultsRenderer` shape). Takes `videoRenderer` items of the first `itemSectionRenderer`s in order, at most 20. `gridShelfViewModel` (Shorts shelves) counted, playlists (`lockupViewModel`) skipped.
  - `parseAge(label: string): number | null` — days, from "4y ago", "9mo ago", "2w ago", "5d ago", "3h ago", "4 years ago", "Streamed 2 years ago", German "vor 4 Jahren", "vor 1 Monat", "vor 3 Wochen", "vor 5 Tagen", "vor 3 Stunden". Year = 365 d, month = 30 d.
  - `parseSuggestions(text: string): string[] | null` — JSONP `window.google.ac.h([...])` → suggestion strings in YouTube's order; null when not that shape.
  - `interface KeywordSuggestions { related: string[]; questions: string[]; matching: string[] }`; `groupSuggestions(keyword: string, lists: { prefix: string; items: string[] }[]): KeywordSuggestions` — related = items of the plain query except the keyword itself; questions = items from the question prefixes (`how`, `what`, `why`) plus any item starting with how/what/why/when/where/who/can/is/does; matching = items containing every word of the keyword. De-duplicated, YouTube's order kept.
  - `QUESTION_PREFIXES = ['how', 'what', 'why']`
  - `interface TopResultsFacts { videos: number; medianViews: Measured<number>; medianAgeDays: Measured<number>; recent: Measured<number>; under10kViews: Measured<number>; distinctChannels: number; topChannel: { name: string; count: number } | null; shortsShelves: number; channelSizes: Measured<number> }`
  - `topResultsFacts(page: SearchPage): TopResultsFacts` — `recent` = results with ageDays ≤ 90; `topChannel` only when one channel has ≥ 3 results; `channelSizes` = `noData("YouTube's search page doesn't show channel sizes")`. A median over zero values is `no_data`.
  - `factsSummary(f: TopResultsFacts): string[]` — deterministic sentences, each quoting its number (rules below).

Summary rules (exact copy; `n` = videos):
- medianViews < 10,000: `Top videos are small: median {v} views.`; < 100,000: `Top videos are mid-sized: median {v} views.`; else `Top videos are big: median {v} views.`
- recent = 0: `None of the top {n} is from the last 3 months.`; recent ≥ n/2: `{r} of the top {n} are from the last 3 months — YouTube is showing new videos for this search.`
- topChannel: `{name} has {count} of the top {n} results.`
- under10kViews ≥ 5: `{k} of the top {n} have under 10,000 views — smaller videos do rank here.`
- Numbers formatted `en-US`. No sentence for a `no_data` input.

- [ ] **Step 1: Write the failing tests** — `keywords.test.ts`:
  - "parses the English fixture": 18 results; first `{ videoId: '-YCGK33c0xs', channelId: 'UCqZL_f4Jp8yHnv2KNvcsWeg', channelName: 'Florian Gadsby', durationSec: 1005, ageLabel: '4y ago' }`, views value 2061788, ageDays value 1460; `shortsShelves` 3; `estimatedResults` 5160242.
  - "facts from the fixture": medianViews value equals core's `median` of the 18 parsed view counts (asserted against `median(...)`, not a retyped constant), `topChannel` `{ name: 'Florian Gadsby', count: 5 }`, `recent` 0, `distinctChannels` 13.
  - "summary sentences": for the fixture, includes `Florian Gadsby has 5 of the top 18 results.` and `None of the top 18 is from the last 3 months.`
  - "German page": a synthetic copy of the fixture with `viewCountText` `"2.061.788 Aufrufe"` and `publishedTimeText` `"vor 4 Jahren"` parses to 2061788 and 1460.
  - "unknown language": `publishedTimeText` `"il y a 4 ans"` → ageDays `{ kind: 'no_data', reason: "Upload age label not understood: il y a 4 ans" }`.
  - "parser canary": a response whose itemSection has `videoRenderer` keys renamed (e.g. to `videoRendererX`) but non-empty contents → `{ error: "YouTube changed its search page; no results could be read" }`; a response with an empty itemSection → `results: []` (a real "no results" page).
  - "live result": `viewCountText.runs` "123 watching" → `live: true`, views `no_data` "Live now: viewers, not views".
  - "normalizeKeyword": `'  Pottery  WHEEL '` → `'pottery wheel'`.
  - "parseSuggestions": fixture → 14 items, first `'pottery wheel for beginners'`; `'<html>'` → null.
  - "groupSuggestions": plain list from the fixture with keyword `'pottery wheel'` → related excludes `'pottery wheel'`; matching includes `'pottery wheel for beginners'`; questions from a `how` list `['how pottery wheel works', 'pottery wheel']` → `['how pottery wheel works']`.
- [ ] **Step 2: Run** `pnpm --filter @viewproof/core test` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `keywords.ts`. Views: digits of `viewCountText.simpleText` (or joined `runs`); "No views" → 0. Duration from `lengthText.simpleText` (h:m:s). Channel id from `ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId`. Canary: section contents non-empty but no item key among `videoRenderer`, `gridShelfViewModel`, `lockupViewModel`, `shelfRenderer`, `reelShelfRenderer`, `adSlotRenderer`, `messageRenderer`, `showingResultsForRenderer`, `didYouMeanRenderer`, `horizontalCardListRenderer`, `channelRenderer`, `playlistRenderer`, `radioRenderer`, `searchPyvRenderer` → error; known keys but zero videos and zero shelves → also the canary error unless the section holds `messageRenderer` (YouTube's "No results").
- [ ] **Step 4: Run** — Expected: PASS, `Test Files … passed`.
- [ ] **Step 5: Commit** `feat(core): parse YouTube search pages and suggestions into keyword facts`

### Task 2: `packages/providers` — `KeywordProvider` and the DataForSEO adapter

**Files:**
- Create: `packages/providers/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/keyword-provider.ts,src/dataforseo.ts}`
- Create: `packages/providers/test/dataforseo.test.ts`, `packages/providers/test/fixtures/dfs-clickstream.json`, `dfs-trends.json` — copied **verbatim from the example responses on DataForSEO's documentation pages** (`docs.dataforseo.com/v3/keywords_data/clickstream_data/bulk_search_volume/live/` and `…/google_trends/explore/live/`), with the source URL in a sibling `README.md`.
- Modify: `packages/core/src/api-types.ts` (estimate types), `pnpm-workspace.yaml` if needed.

**Interfaces:**
- Produces (core `api-types.ts`):
  - `COUNTRIES: { code: string; name: string; locationCode: number }[]` = US 2840, GB 2826, DE 2276, IN 2356, CA 2124, AU 2036, FR 2250, ES 2724, BR 2076; `DEFAULT_COUNTRY = 'US'`.
  - `type KeywordEstimate = { status: 'off'; reason: string } | { status: 'failed'; reason: string } | { status: 'ok'; provider: string; label: string; keyword: string; country: string; volume: Measured<number>; monthly: { month: string; volume: number }[]; interest: { date: string; value: number }[]; fetchedAt: string }`
- Produces (providers):
  - `interface KeywordProvider { name: string; estimate(keyword: string, country: { code: string; locationCode: number }): Promise<KeywordEstimate> }`
  - `const ESTIMATE_LABEL = 'Estimate — clickstream panel, not YouTube data'`
  - `noProvider(reason: string): KeywordProvider` → always `{ status: 'off', reason }`.
  - `dataForSeoProvider(fetchFn: typeof fetch, creds: { login: string; password: string }): KeywordProvider` — two POSTs with `Authorization: Basic base64(login:password)`: `/v3/keywords_data/clickstream_data/bulk_search_volume/live` `[{ keywords: [k], location_code }]` → `search_volume`, `monthly_searches`; `/v3/keywords_data/google_trends/explore/live` `[{ keywords: [k], location_code, type: 'youtube', time_range: 'past_12_months' }]` → the graph item's `data[].{date_from, values[0]}`. `search_volume` null/absent → volume `noData('DataForSEO has no volume for this keyword')`. HTTP ≠ 200 or `status_code` ≠ 20000 (top level or task) → `{ status: 'failed', reason: 'DataForSEO: <status_message>' }`. Trends failure alone keeps the volume and returns `interest: []`.

- [ ] **Step 1: Fetch the two documentation pages** (one fetch each) and save their example responses as the fixtures; note field paths in `fixtures/README.md`.
- [ ] **Step 2: Write the failing tests** — "volume and monthly from the documented response" (values equal those in the fixture, read by the test from the fixture file, not retyped); "trends interest series"; "auth header and request bodies" (fake fetch records them; body has `type: 'youtube'`); "no volume → no_data reason"; "task error → failed with DataForSEO's message"; "trends failure keeps volume"; "noProvider says off".
- [ ] **Step 3: Run** `pnpm --filter @viewproof/providers test` — Expected: FAIL.
- [ ] **Step 4: Implement.** Read only keys present in the fixtures; an absent key is `no_data`, never a default number.
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Commit** `feat(providers): KeywordProvider and DataForSEO adapter (off by default)`

### Task 3: API — estimate with a shared 30-day cache, and matching search terms

**Files:**
- Create: `packages/db/migrations/0004_keyword_cache.sql`; Modify: `packages/db/src/index.ts` (`KeywordCacheRow`)
- Create: `apps/api/src/routes/keywords.ts`; Modify: `apps/api/src/app.ts` (`Deps.keywords: KeywordProvider`, register routes), `apps/api/src/env.ts` (`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `DATAFORSEO_DISPLAY_OK`), `apps/api/src/index.ts` (choose provider), `apps/api/src/routes/channel.ts` (export `loadSearchTerms`, add the terms route), `apps/api/package.json` (dep `@viewproof/providers`), `apps/api/test/helpers.ts` (`keywords: noProvider(...)` default)
- Test: `apps/api/test/keywords.test.ts`

**Interfaces:**
- Consumes: Task 2 `KeywordProvider`, `KeywordEstimate`, `COUNTRIES`; plan 3 `serve`, `cached`, `REPORT_TTL_MS`; Task 1 `normalizeKeyword`.
- Produces:
  - `keyword_cache(keyword TEXT, country TEXT, provider TEXT, body TEXT, fetched_at TEXT, PRIMARY KEY (keyword, country, provider))` — not tied to a user or channel (shared vendor data).
  - `GET /api/keywords/estimate?q=&country=` → `KeywordEstimate`. Signed out → 401 `signed_out`. Empty/over-100-char `q` → 400 `{ error: 'bad_request', message: 'Type a keyword (up to 100 characters).' }`. Unknown country → `DEFAULT_COUNTRY`. `ok` bodies cached 30 days per (normalized keyword, country, provider); `off`/`failed` never cached.
  - `type YourTerms = { keyword: string; coverage: Coverage; terms: SearchTerm[]; note: string | null; fetchedAt: string }` in core `api-types.ts`.
  - `GET /api/channels/:id/keyword-terms?q=` → `YourTerms`: the channel's 90-day search terms (the same cached load as `/search-terms?range=90d`, key `terms:90d:<today>`) filtered to terms containing every word of the normalized keyword. No match → `note: "None of your channel's top 25 search terms (last 90 days) contains this keyword."`. Access errors as plan 3.
  - Provider choice in `index.ts`: `DATAFORSEO_DISPLAY_OK === 'yes'` and both creds → `dataForSeoProvider`; creds without OK → `noProvider('Estimated volume is off: DataForSEO has not yet confirmed that its data may be shown to users.')`; no creds → `noProvider('Estimated volume needs a keyword data provider; none is configured.')`.

- [ ] **Step 1: Write the failing tests** — "estimate is cached 30 days and shared between users" (two users, fake provider counting calls → 1; after 31 days → 2); "off and failed are not cached"; "country falls back to US; key uses normalized keyword"; "signed out → 401"; "bad keyword → 400"; "keyword terms filter the cached 90-day terms" (fake YouTube as plan 3 search-terms test; `q='Trim  Bowl'` keeps `'how to trim a bowl'`, drops `'glaze'`); "no match note"; "another user's channel → 404".
- [ ] **Step 2: Run** `pnpm --filter api test -- test/keywords.test.ts` (background; ~1 min) — Expected: FAIL.
- [ ] **Step 3: Implement** migration, routes, config, provider choice.
- [ ] **Step 4: Run the new file, then the whole api suite** — Expected: all pass.
- [ ] **Step 5: Commit** `feat(api): keyword estimate with shared cache; matching search terms`

### Task 4: Extension — read search pages, keep snapshots, fetch suggestions, answer the web app

**Files:**
- Create: `apps/extension/src/search.ts` (snapshot store + capture logic), `apps/extension/src/suggest.ts` (throttle + fetch), `apps/extension/src/app-bridge.ts` (protocol types/guards), `apps/extension/entrypoints/background.ts`, `apps/extension/entrypoints/viewproof-app.content.ts`
- Modify: `apps/extension/entrypoints/youtube-main.content.ts` (also post search data), `apps/extension/entrypoints/youtube.content.ts` (store snapshots), `apps/extension/wxt.config.ts` (host permission for suggestions, description)
- Test: `apps/extension/test/search.test.ts`, `suggest.test.ts`, `app-bridge.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseSearchPage`, `normalizeKeyword`, `parseSuggestions`, `groupSuggestions`, `QUESTION_PREFIXES`.
- Produces:
  - MAIN world posts `{ type: 'viewproof:search', url, response }` on `/results` pages: on load from `window.ytInitialData`, and on `yt-navigate-finish` from `event.detail.response.response` (fallback `event.detail.response`).
  - `interface Snapshot { query: string; capturedAt: string; page: SearchPage }`; `searchStore(area)` with `save(url: string, response: unknown, now: number): Promise<'saved' | 'skipped' | { error: string }>` (skips URLs with `sp=`, or without `search_query`; key `kw:<normalizeKeyword(search_query)>`; keeps the 50 newest, drops ones older than 30 days) and `get(q: string): Promise<Snapshot | null>`.
  - Background message `{ kind: 'suggest', q }` → `{ ok: true, suggestions: KeywordSuggestions } | { ok: false, reason: string }`. Requests: the keyword, then `how <kw>`, `what <kw>`, `why <kw>` to `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=…`; results cached in storage 7 days per normalized keyword. Throttle: ≤ 60 requests/hour (rolling) per browser; a non-200 or `parseSuggestions` null → pause 24 h, reason `"YouTube refused suggestion requests; paused until <ISO time>"`.
  - Window protocol on ViewProof origins (`app-bridge.ts`): page → `{ type: 'viewproof:kw-request', id: string, q: string }`; content script → `{ type: 'viewproof:kw-response', id, version: string, snapshot: Snapshot | null, suggestions: KeywordSuggestions | null, suggestionsError: string | null }`; page → `{ type: 'viewproof:hello' }`, content script → `{ type: 'viewproof:here', version }`; on a new snapshot in storage the content script posts `{ type: 'viewproof:kw-updated', q }`. Messages accepted only when `e.source === window && e.origin === location.origin`.

- [ ] **Step 1: Write the failing tests** — "filtered searches are not stored" (`sp=EgIIAw%3D%3D`); "stores by normalized keyword" (URL `search_query=Pottery+Wheel+for+Beginners` → `get('pottery wheel for beginners')` returns the fixture's 18 results); "keeps the 50 newest, drops older than 30 days"; "a canary error is reported, not stored"; "suggest: four requests, grouped, cached 7 days"; "throttle stops at 60 per hour"; "non-200 pauses 24 h and says until when"; "bridge ignores other windows and other origins"; "bridge answers kw-request with snapshot and suggestions".
- [ ] **Step 2: Run** `pnpm --filter extension test` — Expected: FAIL.
- [ ] **Step 3: Implement**; manifest description: `Views per hour, outlier score and tags on YouTube; keyword facts for ViewProof. Open source; your data stays in your browser.`
- [ ] **Step 4: Run tests and** `pnpm --filter extension build` — Expected: PASS; built manifest lists exactly the two YouTube host permissions and the three ViewProof matches.
- [ ] **Step 5: Commit** `feat(extension): keyword facts from your own YouTube searches, suggestions for the web app`

### Task 5: Web — Research section and keyword report

**Files:**
- Create: `apps/web/src/research/{Research.tsx,KeywordReport.tsx,TopResults.tsx,Suggestions.tsx,YourTerms.tsx,Estimate.tsx,extension.ts,recent.ts}`
- Modify: `apps/web/src/App.tsx` (routes `/research` → `/research/keywords`, `/research/keywords`, `/research/outliers` = Soon), `apps/web/src/shell/nav.ts` (Research no longer `soon`, `section: '/research'`, `to: '/research/keywords'`), `apps/web/test/fake-api.ts` (helpers), `apps/web/src/styles.css` if needed
- Test: `apps/web/test/research.test.tsx`

**Interfaces:**
- Consumes: Task 1 types and `topResultsFacts`, `factsSummary`, `normalizeKeyword`; Task 3 endpoints and `YourTerms`, `KeywordEstimate`, `COUNTRIES`; Task 4 window protocol.
- Produces:
  - `extension.ts`: `askExtension(q: string, timeoutMs = 1500): Promise<{ installed: false } | { installed: true; version: string; snapshot: Snapshot | null; suggestions: KeywordSuggestions | null; suggestionsError: string | null }>`; `onKeywordUpdated(cb: (q: string) => void): () => void`.
  - `recent.ts`: last 10 keywords in `localStorage 'vp-keywords'`.
  - Page `/research/keywords?q=&country=`: sub-tabs "Keywords" | "Outliers (soon)"; form (keyword input labelled "Keyword", country select labelled "Country", button "Get report"); recent keywords as links. Report sections in order:
    1. **Top results on YouTube** (REAL; "Read from YouTube's search page in your browser, <capturedAt>"): fact tiles (Videos, Median views, Median upload age "about N days/months/years", From the last 3 months, Under 10k views, Channels), summary sentences, table of results (thumbnail `https://i.ytimg.com/vi/<id>/mqdefault.jpg`, title linking to `https://www.youtube.com/watch?v=<id>`, channel, views, age label); "Channel sizes: <reason>". No extension → "Install the ViewProof extension to read YouTube's top results in your browser." No snapshot → "Search for "<kw>" on YouTube with the extension installed; the facts appear here." + button "Search on YouTube" (`https://www.youtube.com/results?search_query=<kw>`, new tab). The section refreshes on `kw-updated` for this keyword. Snapshot older than 7 days shows "Read <N> days ago — search again for fresh facts."
    2. **YouTube suggestions** (REAL, "YouTube's own autocomplete, in its order"): three lists Related / Questions / Matching; each item links to the report for that keyword. Error → the extension's reason.
    3. **Your search terms** (REAL): `YourTerms` table (term, views, previous views) or its note/error; no channel → "Connect a channel to see which of your real search terms match."
    4. **Estimated volume** (ESTIMATE, label text from the response): volume, 12-month table, YouTube interest series; `off` → its reason in muted text.
  - When every section has no data: a single line "No data for this keyword from any source yet." above the sections.

- [ ] **Step 1: Write the failing tests** — "Research nav opens Keywords; Outliers says soon"; "no extension" (no `viewproof:here` reply within timeout → install message, no table); "no snapshot yet" (button href); "facts and summary from a snapshot" (snapshot built from the core fixture via `parseSearchPage`; shows `Florian Gadsby has 5 of the top 18 results.`, 18 rows); "refreshes on kw-updated"; "suggestion lists link to their reports"; "your terms table and no-channel message" ("report without a channel"); "estimate off shows reason; ok shows ESTIMATE label and volume"; "no data anywhere line"; "recent keywords remembered".
- [ ] **Step 2: Run** `pnpm --filter web test` — Expected: FAIL.
- [ ] **Step 3: Implement.** The fake extension in tests answers `window.postMessage` exactly as Task 4's content script.
- [ ] **Step 4: Run** web tests, `pnpm --filter web build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Research → Keywords report`

### Task 6: Docs and a whole-system check

**Files:** Modify `README.md` (status: plans 1–4; "Keyword research" section: what each source is, that extension data stays in the browser, DataForSEO switch), `apps/api/README.md` (env vars, keyword cache), `apps/extension` README or store text if present.

- [ ] **Step 1:** Update docs.
- [ ] **Step 2:** Run every suite (core, providers, extension, web, api in background) and `pnpm -r exec tsc --noEmit` — Expected: all pass, 0 errors.
- [ ] **Step 3:** Commit `docs: keyword research`.
