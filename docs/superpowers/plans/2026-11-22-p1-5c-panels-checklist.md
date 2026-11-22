# P1-5c Extension panels on channel and search pages, per-page toggles, checklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish roadmap row 5: the extension scorecard on watch, channel and search pages (spec §8 item 1), with a toggle per page type and the rule-based video checklist (spec §7), each rule visible and editable.

**Architecture:** Roadmap row 5 was split three ways: 5a competitors (merged), 5b pool + Outliers (merged), **5c this plan**. Everything is read from data YouTube already loaded for the page (MAIN-world script → `postMessage` → isolated script), parsed in `packages/core`, and rendered in a shadow-DOM panel plus small inline badges. The only network requests are the channel RSS feeds the watch panel already uses (`getBaseline`, cached, backs off on 403/429).

**Tech Stack:** TypeScript, WXT MV3, Vitest + happy-dom, Playwright (fake youtube.com pages through request routing).

**Spec:** `docs/superpowers/specs/2026-11-20-viewproof-design.md` §7 (checklist, outlier score), §8 item 1, §10 (YouTube hosts only); roadmap row 5.

## Facts found before planning (live, 3 page loads, fixtures trimmed into `packages/core/test/fixtures/`)

- **Channel Videos tab** (`channel-videos.json`): `richGridRenderer.contents[].richItemRenderer.content.lockupViewModel`.
  - `contentId` is the video id.
  - `metadata.lockupMetadataViewModel.title.content` is the title.
  - `metadataRows[0].metadataParts` are `["3.1M" (accessibilityLabel "3.1 million views"), "3d ago"]`.
  - The duration is a `thumbnailBadgeViewModel.text` like `"38:48"`.
  - **View counts are rounded** (2–3 significant figures). Exact counts are not on the page.
  - The sort chips are `chipViewModel {text: "Latest"|"Popular"|"Oldest", selected}`.
  - The channel id is in `metadata.channelMetadataRenderer.externalId`.
  - The header shows `"21.5M subscribers"` and `"553 videos"`.
  - The page holds 30 videos plus a continuation; scrolling loads more through `/youtubei/v1/browse`.
- **Channel Shorts tab** (`channel-shorts.json`): `shortsLockupViewModel`.
  - The video id is in `onTap.innertubeCommand.reelWatchEndpoint.videoId`.
  - `overlayMetadata.primaryText.content` is the title.
  - `overlayMetadata.secondaryText.content` is like `"290K views"`.
  - There is no upload age.
  - There are 48 items.
- **Watch page player data** (`player-watch-full.json`):
  - `videoDetails.shortDescription` is the full description, with chapters.
  - `captions.playerCaptionsTracklistRenderer.captionTracks[].kind === 'asr'` marks auto-generated captions.
  - `endscreen.endscreenRenderer.elements[]` holds the end-screen elements; the key is absent when there is no end screen.
- **Privacy finding:** the plan 4 fixture `search-results-en.json` contained the developer's IP inside `googlevideo.com` URLs (`watchEndpointSupportedOnesieConfig`). It is scrubbed in this plan's first commit. New fixtures drop that key, and a test fails if any fixture contains `googlevideo.com`.

## Global Constraints

- No fabricated data: a value or `no_data` with a reason.
- Rounded counts are labelled as rounded, and ×N computed from them shows its range.
- Never more requests than plan 1's watch panel already makes: channel feeds only, through `getBaseline` (1 h cache, 1 h back-off on 403/429).
  - At most **8 feeds per search page**, 2 at a time.
  - After any 403/429, no more feed requests from that page.
- Extension host permissions are unchanged (spec §10).
- Panels render after page idle (`requestIdleCallback`, 2 s timeout) and never block YouTube's own rendering.
- All page text goes in as text nodes, never HTML.
- Built extension JS stays pure ASCII (existing build plugin).
- Copy rules: plain words. "×N" always has its reason. Rule thresholds are shown next to each checklist result.
- Commits use `-c user.email=186494249+Freundlyapps@users.noreply.github.com -c user.name=Freundlyapps`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings made at planning time

1. **Channel-page counts are not sent to the pool.**
   - Why: the pool accepts exact counts only (`parseBatch`), and channel grids show rounded ones.
   - Cost if wrong: Outliers stays limited to the feed window. A later plan can add rounded observations with corroboration.
2. **Channel ×N uses grid order, not age labels.**
   - With the sort chip on Latest, grid order is upload order. The baseline is the next ≤ 15 older videos in the same tab with a count, and needs ≥ 5 of them (spec §7 thresholds, `MIN_BASELINE` and `MAX_BASELINE`).
   - Under Popular or Oldest: `no_data`.
   - Only the first page (~30 videos) is covered; continuations are not intercepted.
3. **Search-result ×N** is shown only when the result is in its channel's feed. The feed gives the exact upload time and format; the search page gives the exact count.
   - Otherwise the result gets no badge, and the panel counts how many results were covered.
4. **Checklist rules**, with defaults that are editable on the options page:

   | Rule | Default | Applies to |
   |---|---|---|
   | title length | 20–70 characters; YouTube's limit of 100 is the max allowed | all videos |
   | description length | ≥ 250 characters | all videos |
   | tags | ≥ 3 | all videos |
   | chapters | YouTube's rules: first at 0:00, ≥ 3 timestamps, ascending, each ≥ 10 s | long videos; Shorts are skipped |
   | end screen | ≥ 1 element | long videos; Shorts are skipped |
   | captions | a track that isn't auto-generated | all videos |

## Review Focus

1. YouTube recycles grid and result DOM nodes when navigating in the app. A badge must never stay on a tile that now shows a different video.
2. A storage change to toggles or rules while a page is open hides or re-renders the panel without a reload.
3. Rounded-count parsing must handle "No views", "1 view", "845 views", "12K", "3.1M", "1.2B", the `accessibilityLabel` form, and German "Aufrufe". Anything else is `null`, never 0.
4. Chapters: timestamps that aren't at a line start, "0:00" missing, a last chapter shorter than 10 s before the end, and h:mm:ss times.
5. Search pages fire `yt-navigate-finish` again on a new search. Old feed requests must not paint badges on the new results.

---

### Task 1: Core — checklist and chapters

**Files:** Create `packages/core/src/checklist.ts`, `packages/core/test/checklist.test.ts`. Modify `packages/core/src/player.ts`, `packages/core/src/scorecard.ts`, `packages/core/src/index.ts`, `packages/core/test/player.test.ts`, and add a fixture privacy test.

**Interfaces — Produces:**
- `WatchVideo` gains `description: string`, `captions: { manual: number; auto: number }` and `endScreenElements: number`. Missing keys give `''` / 0, because absence means none.
- `parseChapters(description: string, lengthSec: number): { ok: true; chapters: { startSec: number; title: string }[] } | { ok: false; reason: string }`.
- `type ChecklistRuleId = 'title' | 'description' | 'tags' | 'chapters' | 'endScreen' | 'captions'`.
- `interface ChecklistSettings`:
  - `title: { on: boolean; min: number; max: number }`
  - `description: { on: boolean; min: number }`
  - `tags: { on: boolean; min: number }`
  - `chapters`, `endScreen` and `captions`: `{ on: boolean }`
- `DEFAULT_CHECKLIST`, plus `normalizeChecklist(raw: unknown): ChecklistSettings`. It clamps: title max ≤ 100, min ≤ max, non-negative integers. Anything invalid falls back to the default for that field.
- `interface ChecklistItem { id: ChecklistRuleId; label: string; rule: string; status: 'pass' | 'fail' | 'skip'; detail: string }`.
- `runChecklist(v: WatchVideo, s: ChecklistSettings): ChecklistItem[]` (rules that are off are omitted).
- `Scorecard` gains `checklist: ChecklistItem[]`. `buildScorecard` takes an optional `checklist?: ChecklistSettings`, defaulting to `DEFAULT_CHECKLIST`.

- [ ] Write tests:
  - parse `player-watch-full.json`: description length 4293, captions `{manual: 1, auto: 1}`, `endScreenElements` 3;
  - the old `player-watch.json` gives `''`, `{0, 0}` and 0;
  - chapters from the fixture: 13 chapters, the first `{0, 'The "Impossible" Liquid'}`;
  - `parseChapters`: no 0:00 → "First timestamp must be 0:00"; 2 stamps → "needs at least 3"; a 5 s chapter → "at least 10 seconds"; a descending stamp → reason; `1:01:58` is 3718 s; a stamp in the middle of a line is ignored;
  - `runChecklist` on the fixture with defaults:
    - title 77 characters fails, detail "77 characters (aim for 20–70)";
    - description passes;
    - tags pass (31);
    - chapters pass ("13 chapters");
    - end screen passes ("3 elements");
    - captions pass;
  - a Short skips chapters and end screen;
  - `normalizeChecklist({title: {max: 500}})` gives max 100;
  - `normalizeChecklist('junk')` gives the defaults;
  - a rule that is off is omitted;
  - fixture privacy: no fixture contains `googlevideo.com`.
- [ ] Run `pnpm --filter @viewproof/core test`. Expected: FAIL (missing exports).
- [ ] Implement. Chapter regex: `^\s*((?:\d+:)?\d{1,2}:\d{2})\s+[-–—:]?\s*(.+)$` per line.
- [ ] Run again. Expected: PASS. Then commit `feat(core): video checklist and chapter rules`.

### Task 2: Core — channel page grid and rounded counts

**Files:** Create `packages/core/src/channel-page.ts`, `packages/core/test/channel-page.test.ts`. Modify `packages/core/src/index.ts`.

**Interfaces — Produces:**
- `parseRoundedCount(text: string): { lo: number; hi: number; mid: number; exact: boolean } | null`.
  - `"3.1M"` gives lo 3,050,000, hi 3,149,999, mid 3,100,000, exact false.
  - `"845 views"` gives all three 845, exact true.
  - `"No views"` gives 0.
  - It accepts `K/M/B`, `thousand/million/billion`, and German `Aufrufe`, `Tsd.`, `Mio.`, `Mrd.`.
- `interface GridVideo { videoId: string; title: string; views: RoundedCount | null; viewsText: string; ageLabel: string | null; ageDays: number | null; durationSec: number | null }`.
- `interface ChannelPage { channelId: string; title: string; tab: 'videos' | 'shorts'; sort: 'latest' | 'popular' | 'oldest' | null; subscribersText: string | null; videos: GridVideo[] }`.
- `parseChannelPage(data: unknown): ChannelPage | { error: string }`.
  - Returns an error for a non-channel shape or an unsupported tab.
  - When grid items exist but none is readable, it returns the canary error: "YouTube changed its channel page; no videos could be read".
- `gridOutliers(page: ChannelPage): Map<string, Measured<number>>`.
  - The value is ×N at mid. Its inputs are `{ viewsText, baselineMedian, baselineCount, low, high, rounded: true }`, where `low = lo / median(hi)` and `high = hi / median(lo)`, both rounded like `outlierScore`.
  - When the sort isn't Latest, every video is `no_data("Sorted by Popular: ×N needs the Latest order")`.
- `channelSummary` is not reused. Add `gridSummary(page): { medianViews: Measured<number>; counted: number }` over the first 15 videos with counts.

- [ ] Write tests:
  - videos fixture: channel `UCHnyfMqiRRG1u-2MsSQLbXA`, tab videos, sort latest, 30 videos;
  - the first video is `uXuQF_PPg5U`, views mid 3.1M, ageLabel "3d ago", ageDays 3, duration 2328;
  - shorts fixture: tab shorts, 48 videos, the first `HZjRoKgDnow` at 290K;
  - `parseRoundedCount` over every Review Focus 3 case;
  - `gridOutliers`: the last 4 videos have `no_data` "Needs 5 earlier videos…";
  - a synthetic page with medians 100K and one video at 1.0M gives ×10 with a low/high range;
  - sort popular gives `no_data`;
  - a canary shape gives an error.
- [ ] Run. Expected: FAIL. Implement it. Run. Expected: PASS. Commit `feat(core): channel page grid and outliers from rounded counts`.

### Task 3: Extension — settings (toggles and rules) and the options page

**Files:** Create `apps/extension/src/settings.ts`, `apps/extension/test/settings.test.ts`. Modify `apps/extension/entrypoints/options/{main.ts,index.html}`.

**Interfaces — Produces:**
- `type PageKind = 'watch' | 'channel' | 'search'`.
- `interface PanelToggles { watch: boolean; channel: boolean; search: boolean }`. The default is all true.
- `settingsStore(area)`:
  - `getToggles(): Promise<PanelToggles>`
  - `setToggle(kind, on)`
  - `getChecklist(): Promise<ChecklistSettings>` (normalized)
  - `setChecklist(s)`
  - `resetChecklist()`
  - `onChange(area-listener helper)`: `settingsChanged(changes): { toggles?: boolean; checklist?: boolean }`
- The storage keys are `panels` and `checklist`.

- [ ] Tests: defaults when empty; set/get round trip; a corrupt stored value gives the defaults; `settingsChanged` flags only the keys it owns. Run → FAIL → implement → PASS.
- [ ] Options page: change the title to "ViewProof — settings", then add two cards above the data-sharing cards.
  - **"Show ViewProof on"**: three checkboxes, Watch pages, Channel pages and Search pages.
  - **"Video checklist"**: one row per rule, with an on/off checkbox, number inputs where the rule has them, the rule text, and "Reset to defaults".
- [ ] Commit `feat(extension): per-page toggles and editable checklist rules`.

### Task 4: Extension — watch panel: checklist, copy tags, toggle, idle render

**Files:** Modify `apps/extension/src/panel.ts`, `panel.css`, `src/flow.ts`, `entrypoints/youtube.content.ts`, `test/panel.test.ts`, `test/flow.test.ts`.

**Interfaces — Consumes:** `runChecklist` via `buildScorecard({…, checklist})`; `settingsStore`.

- `FlowDeps` gains `checklist: () => Promise<ChecklistSettings>`.
- `PanelState`'s `ok` card carries `checklist`.

- [ ] Tests:
  - the panel renders a "Checklist" section with one row per item, a ✓/✗/– mark plus a text status ("Pass", "Fail", "Skipped"), the detail and the rule;
  - "Copy tags" calls `navigator.clipboard.writeText` with `tags.join(', ')` and shows "Copied";
  - "Edit rules" sends `{kind: 'open-options'}`;
  - with no tags there's no copy button;
  - the flow passes stored checklist settings, so a title rule that's off has no title row.
- [ ] Run → FAIL → implement. The content script reads toggles. When watch is off, it never mounts, and its host is hidden. Toggle changes take effect live via `storage.onChanged`. The mount is wrapped in `whenIdle()` (`requestIdleCallback`, 2 s timeout, falling back to `setTimeout`).
- [ ] PASS. Commit `feat(extension): checklist and copy tags on the watch panel`.

### Task 5: Extension — channel page panel and badges

**Files:**
- Create `apps/extension/src/channel.ts`, `apps/extension/src/badges.ts`, `apps/extension/src/page-panel.ts` (a shared shadow-DOM card for channel and search), and the tests `test/channel.test.ts` and `test/badges.test.ts`.
- Modify `entrypoints/youtube-main.content.ts`, `entrypoints/youtube.content.ts` and `panel.css`.

**Interfaces — Produces:**
- `CHANNEL_MSG = 'viewproof:channel'` and `isChannelMessage(e, self, origin)`, shaped like `isSearchMessage`.
- `isChannelPath(pathname): 'videos' | 'shorts' | null` covers `/@x/videos`, `/@x/shorts`, `/channel/UC…/videos|shorts`, `/c/x/videos` and `/user/x/videos`.
- `channelCard(page: ChannelPage, outliers: Map<string, Measured<number>>): CardModel`.
  - The title is "This channel's videos". It shows the median views of the latest 15, labelled "rounded counts", and the subscribers text.
  - It lists the top 5 by ×N, each with a link to its video and its range.
  - It shows a count of `no_data` videos, with the reason.
- `type Badge = { text: string; title: string; tone: 'hi' | 'lo' | 'plain' }`.
- `applyBadges(root: ParentNode, badges: Map<string, Badge>): number`.
  - Tile containers are `ytd-rich-item-renderer, ytd-video-renderer, ytd-reel-item-renderer, ytm-shorts-lockup-view-model`.
  - The video id comes from the first `a[href]` in each tile that matches `/watch?v=ID` or `/shorts/ID`.
  - It keeps at most one `span[data-viewproof-badge]` per tile, with `data-video-id` set. It replaces a badge whose id differs from the tile's current id, and removes it when the map lacks the id.
  - It returns the number of badges placed.
- `badgeWatcher(apply: () => void)` is a MutationObserver on `document.body`, throttled to 300 ms, and is disconnected on `yt-navigate-start`.
- `renderPagePanel(host, model)` is the shadow-DOM card.
  - On channel pages it is mounted before `ytd-rich-grid-renderer`.
  - On search pages it is mounted at the top of `ytd-search #contents` / `ytd-section-list-renderer`.
  - Each mount falls back to `ytd-browse #primary` or `#primary`.

- [ ] Tests:
  - `isChannelPath` over the listed paths, with `/@x/featured` giving null;
  - `channelCard` from the videos fixture shows "rounded" and 5 rows or fewer;
  - badges:
    - place one per tile;
    - re-running doesn't duplicate;
    - changing a tile's href to another id replaces the badge;
    - an id missing from the map removes the badge;
    - a ×3 or higher badge has tone `hi`, and 0.3 or lower has `lo`;
  - badge text has no HTML injection: a title with `<img>` stays text.
- [ ] Run → FAIL → implement. The MAIN world posts `viewproof:channel` on a channel tab path, from `ytInitialData` on the first load and from `yt-navigate-finish` `detail.response` afterwards. The isolated script parses it, builds the card and badges, mounts after idle, and respects the `channel` toggle. A channel-page parse error shows the canary message in the panel.
- [ ] PASS. Commit `feat(extension): channel page panel with ×N from the visible videos`.

### Task 6: Extension — search page panel and badges

**Files:** Create `apps/extension/src/search-panel.ts` and `test/search-panel.test.ts`. Modify `entrypoints/youtube.content.ts`.

**Interfaces — Produces:**
- `searchFeedOutliers(page: SearchPage, deps: { baseline: (channelId: string) => Promise<ParseResult<FeedVideo[]>>; isCurrent: () => boolean }): Promise<{ outliers: Map<string, Measured<number>>; channelsChecked: number; stopped: string | null }>`.
  - It checks at most 8 distinct channels, in result order, 2 at a time.
  - A result found in its feed gets `outlierScore({ video: {videoId, views, format, publishedAt from the feed entry, isLive: false, isUpcoming: false}, baseline: feed })`.
  - A baseline that fails with `HTTP 403` or `HTTP 429` stops the remaining channels; `stopped` carries the reason.
  - When `isCurrent()` turns false, it returns early.
- `searchCard(page, facts: TopResultsFacts, summary: string[], cover: { withXn: number; total: number; stopped: string | null }): CardModel`.
  - The title is `What ranks for "<query>"`.
  - It shows median views, median age, how many results are from the last 90 days, and how many have under 10K views.
  - It includes the summary sentences, plus "×N shown for X of Y results — the rest are older than their channel's latest 15 uploads".

- [ ] Tests:
  - with a fake baseline over `search-results-en.json`, at most 8 baseline calls, and never more than 2 in flight at once;
  - a result in a feed gets ×N, and one not in a feed gets no entry;
  - a 429 on the first channel stops the rest;
  - `isCurrent` false gives no further calls;
  - the card text includes the query and the coverage line.
- [ ] Run → FAIL → implement. In the content script, the search message handler also builds the panel: facts at once, badges when the feeds arrive, and the `NavigationGuard`-style sequence checked before painting. It respects the `search` toggle.
- [ ] PASS. Commit `feat(extension): search page panel with competition facts and ×N`.

### Task 7: E2E, docs, live check

**Files:** Modify `apps/extension/e2e/scorecard.spec.ts` (new cases), `README.md`, and `apps/extension/README.md` if it exists.

- [ ] E2E on fake pages:
  - the watch page shows Checklist rows;
  - a channel page (`/@fixture/videos`, `ytInitialData` from the videos fixture plus a `ytd-rich-grid-renderer` with 3 tiles) shows "This channel's videos" and a badge on a tile;
  - a search page shows `What ranks for` and ×N on a result whose channel feed contains it;
  - turning the channel toggle off on the options page removes the channel panel after a reload.
- [ ] README: watch, channel and search panels; toggles; checklist rules; rounded counts.
- [ ] Live check on real YouTube with the dev build, with a budget of 1 channel page, 1 search and 1 watch page. Screenshot each and read the pixels.
- [ ] Commit `docs: page panels, toggles, checklist`.
