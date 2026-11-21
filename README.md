# ViewProof

Open-source YouTube research tools: an alternative to vidIQ that shows where every number comes from.
License: AGPL-3.0. Status: Phase 1 — plans 1–4 of 8 done: browser extension; server with Google sign-in and channel connect; web app with My channel; keyword research.

## The browser extension (Chrome, Edge)

On any YouTube video page, a panel at the top of the right-hand column shows:

- **Views / hour**: views divided by hours since upload ("avg since upload"). If you opened the same video at least an hour earlier and its count has moved, it uses the change since your last visit instead ("since your last visit"). A line under the tiles shows the exact numbers used.
- **vs usual (×N)**: this video's views divided by the median views of the channel's earlier uploads of the same type (long video or Short), taken from the channel's public RSS feed (its latest 15 uploads). It needs at least 5 earlier videos of the same type; otherwise it says "No data" and why. Videos older than the channel's latest 15 uploads get "No data" too: the feed has nothing earlier to compare with.
- **Age** and **tags** (the video's public tags).

Live and upcoming videos show "No data" with the reason instead of a misleading number.

### Privacy

The extension sends nothing to the ViewProof server or anyone else. It talks only to YouTube: it reads the data the page already loaded, fetches the channel's public RSS feed without cookies, and, when you open a keyword report, asks YouTube's autocomplete (`suggestqueries-clients6.youtube.com`, at most 60 requests an hour, paused for 24 hours if YouTube refuses). Your past view-count sightings and the searches you make on YouTube (the first results page, up to 50 searches for 30 days; filtered searches are skipped) are stored only in your browser (`chrome.storage.local`). The ViewProof web page open in the same browser can read them through a small script the extension runs on ViewProof's own pages; nothing is uploaded.

### Install from source

Requirements: Node 24+, pnpm 10.

```bash
pnpm install
pnpm --filter extension build
```

Then open `chrome://extensions` (or `edge://extensions`), switch on **Developer mode**, click **Load unpacked** and pick `apps/extension/.output/chrome-mv3`.

### Development

```bash
pnpm test                         # unit tests (core + extension)
pnpm typecheck
pnpm --filter extension exec playwright install chromium --no-shell   # once, for e2e
pnpm --filter extension e2e       # builds and runs the extension against fake YouTube pages
pnpm --filter @viewproof/core canary   # ONE real feed request: fails loudly if YouTube changed the feed format
node apps/extension/e2e/live-check.mjs <outDir> <videoId>...   # manual check on real videos; one page load each
```

Keep live checks to a handful of requests; never loop them.

## The web app

Sign in with Google, connect your channel (view-only) and open **My channel**: views, watch time, average view duration and subscribers per day; your videos; the real YouTube search terms that brought viewers; and YouTube's revenue estimates if you allow revenue access.

Every number is YouTube's own value, labelled REAL (or ESTIMATE for revenue), with the previous period beside it. ViewProof doesn't compute scores, percentages or ratios from YouTube API data: YouTube's developer policy (III.E.4.h) forbids derived metrics. When YouTube returns nothing, the app says "No data" and why.

Run it locally: set up `apps/api` (see [apps/api/README.md](apps/api/README.md)), then `pnpm dev` and open http://localhost:8787/app.

## Keyword research

**Research → Keywords** builds a report for a keyword from separate, labelled sources. It never shows a single 0–100 score, and a keyword nobody has data for says "No data", never a number.

- **Top results on YouTube** (REAL): search for the keyword on YouTube with the extension installed. The extension reads the results page you see, and the report shows facts about it: median views, median upload age, how many results are from the last 3 months, how many have under 10,000 views, how many different channels there are, and whether one channel holds several spots. A short plain-language summary quotes those numbers. Channel sizes aren't on YouTube's search page, so they show "No data" for now.
- **YouTube suggestions** (REAL): YouTube's own autocomplete for the keyword, grouped into related searches, questions and matching phrases, in YouTube's order.
- **Your search terms** (REAL): the real searches that brought viewers to your channel (YouTube Analytics, your top 25 over 90 days) that contain the keyword.
- **Estimated monthly searches** (ESTIMATE): only when a keyword data vendor is configured. The DataForSEO adapter (clickstream volume plus Google Trends for YouTube search) is labelled "Estimate — clickstream panel, not YouTube data" and is off unless `DATAFORSEO_DISPLAY_OK=yes` (see [apps/api/README.md](apps/api/README.md)). YouTube doesn't publish search volume; every tool's volume is an estimate.

The report reads the extension through a small script on ViewProof's own pages. The store build runs it only on `viewproof.app`. For a local server (`http://localhost:8787`), load the development build instead: run `pnpm --filter extension build:dev`, then load `apps/extension/.output/chrome-mv3-dev`.

## Repository layout

- `packages/core`: scores, parsers and API types shared by every part (views per hour, outlier ×N, feed and player parsers, My channel rules).
- `apps/extension`: the browser extension (WXT, Manifest V3).
- `apps/api`: the server (Cloudflare Worker, Hono, D1): sign-in, channel connect, account, YouTube Analytics endpoints; serves the web app at `/app`. See [apps/api/README.md](apps/api/README.md).
- `apps/web`: the web app (React, Vite), built into `apps/web/dist` and served by the Worker.
- `packages/providers`: keyword data providers behind one interface (`KeywordProvider`); DataForSEO is the first.
- `packages/db`: database migrations.
- `docs/`: design spec, UI prototype and build plans.
