# ViewProof

Open-source YouTube research tools: an alternative to vidIQ that shows where every number comes from.
License: AGPL-3.0. Status: Phase 1 — plans 1–5 done: browser extension with panels on watch, channel and search pages; server with Google sign-in and channel connect; web app with My channel; keyword research; competitor tracking; opt-in data pool and Outliers.

## The browser extension (Chrome, Edge)

On any YouTube video page, a panel at the top of the right-hand column shows:

- **Views / hour**: views divided by hours since upload ("avg since upload"). If you opened the same video at least an hour earlier and its count has moved, it uses the change since your last visit instead ("since your last visit"). A line under the tiles shows the exact numbers used.
- **vs usual (×N)**: this video's views divided by the median views of the channel's earlier uploads of the same type (long video or Short), taken from the channel's public RSS feed (its latest 15 uploads). It needs at least 5 earlier videos of the same type; otherwise it says "No data" and why. Videos older than the channel's latest 15 uploads get "No data" too: the feed has nothing earlier to compare with.
- **Age** and **tags** (the video's public tags), with a **Copy tags** button.
- **Checklist**: plain checks of what YouTube shows for the video. Each check shows the rule it applied:
  - title length (20–70 characters by default; YouTube allows 100);
  - description length (at least 250 characters);
  - at least 3 tags;
  - chapters by YouTube's rules (first at 0:00, at least 3, each at least 10 seconds);
  - an end screen;
  - captions that aren't only auto-generated.

  Shorts skip chapters and end screens. **Edit rules** opens the extension's settings, where you can switch each rule off or change its numbers.

On a channel's **Videos** or **Shorts** tab, a panel above the grid shows:
- the channel's usual views: the median of its latest 15 videos;
- the biggest outliers on the page;
- a ×N badge on each video.

YouTube shows only rounded counts there ("3.1M"), so ×N is computed from them and shows the range the rounding allows ("between ×2.4 and ×2.6"). Only the videos on the first page are covered (about 30); videos loaded by scrolling aren't. Sorting by Popular or Oldest gives no ×N, because the order is no longer upload order.

On a **search results** page, a panel above the results shows facts about the results you see: median views, median upload age, how many are from the last 90 days and how many have under 10,000 views, plus a short summary. Results that are among their channel's latest 15 uploads get a ×N badge. The extension checks at most 8 channel feeds per search, 2 at a time, and stops if YouTube asks it to slow down.

The extension's settings page has a switch for each page type (watch, channel, search). Changes apply without reloading the page. Every panel draws after the page has finished its own work.

Live and upcoming videos show "No data" with the reason instead of a misleading number.

### Privacy

By default the extension sends nothing to the ViewProof server or anyone else (the opt-in data pool is below). Otherwise it talks only to YouTube: it reads the data the page already loaded, fetches the channel's public RSS feed without cookies, and, when you open a keyword report, asks YouTube's autocomplete (`suggestqueries-clients6.youtube.com`, at most 60 requests an hour, paused for 24 hours if YouTube refuses). Your past view-count sightings and the searches you make on YouTube (the first results page, up to 50 searches for 30 days; filtered searches are skipped) are stored only in your browser (`chrome.storage.local`). The ViewProof web page open in the same browser can read them through a small script the extension runs on ViewProof's own pages; nothing is uploaded.

### Data pool (opt-in)

You can share the public facts of the videos you see on YouTube. They let Outliers find videos in your niche. It is off until you do both of these:
1. Link the browser: ViewProof → Settings → Extension & data → **Link this browser**.
2. Agree on the extension's data-sharing page, which opens after linking.

- **Sent:** video and channel ids, title, view count, upload time or age, length, Short or long, from watch and search pages you open. Batches go every 5 minutes, only to the server you linked.
- **Never sent:** who you are on YouTube, cookies, watch time, or the words you type into YouTube's search box. The facts of the results you see are sent.
- **On the server:** observations are stored without your name or browser, at hour precision; when a video or channel was seen, and when a browser last sent, are kept to the day. So no timestamp can pair a person with what they watched. The server keeps only how many items each linked browser sent per day.
- **Checks:** before anything is kept, the server checks each item:
  - its format;
  - YouTube id shapes;
  - view counts can't fall more than 1 % or grow faster than 1 million an hour;
  - at most 300 items per batch and 3,000 per browser per day.
  Counts are compared with the channel's own public feed, never with what other browsers sent, so one browser can't make others fail. More than 200 malformed items from a browser in a day pause the whole account for 7 days. An account can link up to 5 browsers, and each browser can introduce at most 200 new channels a day.
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
node apps/extension/e2e/panels-live-check.mjs <outDir> [channel|search|watch]   # manual check of the page panels; 1–3 page loads
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

## AI

**Ask AI** writes titles, descriptions, tags and video ideas, and answers questions about your channel. Every answer lists the data it used, line by line, and cites it as [S1], [S2]…
- **What it may use:** your channel's last 28 days, your top videos and real search terms from the last 90 days (YouTube Analytics), your tracked competitors' latest uploads (public feeds), and outliers the network found in the last 30 days. Whatever isn't available is listed with the reason. Nothing else is sent.
- **Where it goes:** the answer names the provider and model. Nothing about your questions or the answers is stored.
- **Included AI or your own key:** a server can include an AI (the hosted service uses Claude Haiku 5.5 for quick actions and Claude Sonnet 5.5 for Ask AI). Hosted limits each month: Free 20 quick actions; Pro 500 quick actions and 150 Ask AI messages. Self-hosted installs have no limits. In **Settings → AI & apps** you can add your own key instead (Anthropic, OpenAI, Google Gemini, DeepSeek, OpenRouter; and on self-hosted installs any OpenAI-compatible server such as Ollama). The key is tested before it's saved, stored encrypted per user, and your own key is never counted.
- **Server setup** (optional, `.dev.vars` or Wrangler secrets): `AI_API_KEY`, and optionally `AI_PROVIDER` (`anthropic` by default; `openai`, `gemini`, `deepseek`, `openrouter`, `custom`), `AI_BASE_URL` (for `custom`), `AI_QUICK_MODEL`, `AI_COACH_MODEL` (required for providers other than Anthropic). With `AI_PROVIDER=custom` and `AI_BASE_URL`, no key is needed (local models).
- **Live check:** `VP_SESSION=<vp_session cookie> node apps/api/scripts/ai-live-check.mjs http://localhost:8787` runs one titles action and one question (at most 3 AI calls) and prints what came back.

## Repository layout

- `packages/core`: scores, parsers and API types shared by every part (views per hour, outlier ×N, feed and player parsers, My channel rules).
- `apps/extension`: the browser extension (WXT, Manifest V3).
- `apps/api`: the server (Cloudflare Worker, Hono, D1): sign-in, channel connect, account, YouTube Analytics endpoints; serves the web app at `/app`. See [apps/api/README.md](apps/api/README.md).
- `apps/web`: the web app (React, Vite), built into `apps/web/dist` and served by the Worker.
- `packages/providers`: keyword data providers behind one interface (`KeywordProvider`); DataForSEO is the first.
- `packages/db`: database migrations.
- `docs/`: design spec, UI prototype and build plans.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests run a privacy check (`pnpm check:privacy`), the type check and all tests in CI.
