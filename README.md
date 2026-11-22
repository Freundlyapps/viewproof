# ViewProof

Open-source YouTube research tools: an alternative to vidIQ that shows where every number comes from.
License: AGPL-3.0. Status: Phase 1 — plans 1–4, 5a and 5b done: browser extension; server with Google sign-in and channel connect; web app with My channel; keyword research; competitor tracking; opt-in data pool and Outliers. Next: 5c, extension panels on channel and search pages.

## The browser extension (Chrome, Edge)

On any YouTube video page, a panel at the top of the right-hand column shows:

- **Views / hour**: views divided by hours since upload ("avg since upload"). If you opened the same video at least an hour earlier and its count has moved, it uses the change since your last visit instead ("since your last visit"). A line under the tiles shows the exact numbers used.
- **vs usual (×N)**: this video's views divided by the median views of the channel's earlier uploads of the same type (long video or Short), taken from the channel's public RSS feed (its latest 15 uploads). It needs at least 5 earlier videos of the same type; otherwise it says "No data" and why. Videos older than the channel's latest 15 uploads get "No data" too: the feed has nothing earlier to compare with.
- **Age** and **tags** (the video's public tags).

Live and upcoming videos show "No data" with the reason instead of a misleading number.

### Privacy

By default the extension sends nothing to the ViewProof server or anyone else (the opt-in data pool is below). Otherwise it talks only to YouTube: it reads the data the page already loaded, fetches the channel's public RSS feed without cookies, and, when you open a keyword report, asks YouTube's autocomplete (`suggestqueries-clients6.youtube.com`, at most 60 requests an hour, paused for 24 hours if YouTube refuses). Your past view-count sightings and the searches you make on YouTube (the first results page, up to 50 searches for 30 days; filtered searches are skipped) are stored only in your browser (`chrome.storage.local`). The ViewProof web page open in the same browser can read them through a small script the extension runs on ViewProof's own pages; nothing is uploaded.

### Data pool (opt-in)

You can share the public facts of the videos you see on YouTube. They let Outliers find videos in your niche. It is off until you do both of these:
1. Link the browser: ViewProof → Settings → Extension & data → **Link this browser**.
2. Agree on the extension's data-sharing page, which opens after linking.

- **Sent:** video and channel ids, title, view count, upload time or age, length, Short or long, from watch and search pages you open. Batches go every 5 minutes, only to the server you linked.
- **Never sent:** who you are on YouTube, cookies, watch time, your searches.
- **On the server:** observations are stored without your name or browser. The server keeps only how many items each linked browser sent per day.
- **Checks:** before anything is kept, the server checks each item:
  - its format;
  - YouTube id shapes;
  - view counts can't fall more than 1 % or grow faster than 1 million an hour;
  - at most 300 items per batch and 3,000 per browser per day.
  A browser with more than 200 rejected items in a day is paused.
- **Never shown as numbers:** the values a browser sent are not shown directly. Outliers shows views, views per hour and ×N from each channel's public feed. Shared facts only tell the server which videos and channels to look at.
- **Your record:** the extension's data-sharing page lists every item it sent. Stop sharing, unlink or clear the list there at any time.
- **Self-hosting:** the store build links only to `viewproof.app`. To link to your own server, add your origin to `src/app-origins.ts` and build the extension yourself.

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
- **YouTube search interest** (optional, RELATIVE): weekly interest over the last 12 months from Google Trends' YouTube search filter, through DataForSEO. 100 is the peak week. It is not a number of searches. It is shown only when a server has DataForSEO configured and `DATAFORSEO_DISPLAY_OK=yes` (see [apps/api/README.md](apps/api/README.md)).

ViewProof shows no "monthly searches" number. YouTube publishes search volume to no one, and every tool's figure is a model built from clickstream or Google web-search data.

The report reads the extension through a small script on ViewProof's own pages. The store build runs it only on `viewproof.app`. For a local server (`http://localhost:8787`), load the development build instead: run `pnpm --filter extension build:dev`, then load `apps/extension/.output/chrome-mv3-dev`.

## Competitors

**Competitors** tracks up to 25 YouTube channels. Paste a channel link (`youtube.com/channel/UC…`), its UC… id, or its @handle.

- **New uploads** (REAL · public feed): the latest uploads across your tracked channels, sortable by newest, views, views per hour and ×N.
  - **Views per hour**: the view change between two of ViewProof's checks at least an hour apart; otherwise the average since upload, and it says which.
  - **×N**: a video's views ÷ the median views of the channel's earlier uploads of the same type (long or Short), the same formula as the extension. Fewer than 5 earlier videos gives "No data" with the reason.
- **Channels**: per channel, the subscriber count (REAL · YouTube Data API, shown "as of" its date), how many of the feed's latest 15 uploads came in the last 30 days, median views of long videos and Shorts, and when the feed was last checked. A feed that fails says so, and the last data stays.
- **Views over time**: open a channel and pick a video. The line is its public view count at each of ViewProof's checks.

Where the data comes from: each channel's public RSS feed, which lists its latest 15 uploads with view counts. The server fetches a feed at most once every 3 hours, however many people track the channel. An hourly job checks up to 60 feeds. Subscriber counts and adding by @handle need the YouTube Data API: either the server's `YOUTUBE_API_KEY` or your own connected channel. Without either, paste the channel's /channel/ link. Those counts are kept for at most 30 days and are never charted.

## Outliers

**Research → Outliers** lists videos that beat their channel's usual views, among videos the network of opted-in browsers found in the last 30 days. It is not all of YouTube.
- **×N** is the same formula as the extension and Competitors: views ÷ the median views of the channel's earlier uploads of the same type, from its public feed. It needs 5 earlier uploads; otherwise there is no ×N and the video isn't listed.
- **Filters:** keyword in the title, long or Shorts, uploaded within 7 / 30 / 90 days or 12 months, channel size (the channel's usual views: under 10k, 10k–100k, over 100k) and a minimum ×N.
- **Waiting channels:** a channel the network has just found waits for its first feed check (the hourly job checks up to 15 new channels an hour). The page says how many are waiting.

## Repository layout

- `packages/core`: scores, parsers and API types shared by every part (views per hour, outlier ×N, feed and player parsers, My channel rules).
- `apps/extension`: the browser extension (WXT, Manifest V3).
- `apps/api`: the server (Cloudflare Worker, Hono, D1): sign-in, channel connect, account, YouTube Analytics endpoints; serves the web app at `/app`. See [apps/api/README.md](apps/api/README.md).
- `apps/web`: the web app (React, Vite), built into `apps/web/dist` and served by the Worker.
- `packages/providers`: keyword data providers behind one interface (`KeywordProvider`); DataForSEO is the first.
- `packages/db`: database migrations.
- `docs/`: design spec, UI prototype and build plans.
