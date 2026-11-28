# ViewProof

Open-source YouTube research tools: an alternative to vidIQ that shows where every number comes from.
License: AGPL-3.0. Status: Phase 1 built, closed beta in preparation: browser extension with panels on watch, channel and search pages; server with Google sign-in and channel connect; web app with My channel, keyword research, competitors, Outliers, Optimize video, Ask AI, Tools, an MCP server and optional billing. Self-host with Docker or Wrangler (see [Self-hosting](#self-hosting)).

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

Run it yourself: see [Self-hosting](#self-hosting).

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

## Optimize video

**Optimize video** checks a title, description and tags with fixed rules. Each rule shows its threshold; there is no score. Nothing is written to YouTube: **Copy all** puts the title, description and tags on the clipboard, and **Open in YouTube Studio** opens the video's edit page.
- **Title:** 20–70 characters; at most 100 (YouTube's limit); contains the keyword; the keyword starts within the first 40 characters. Characters are counted as you see them (an emoji is one).
- **Preview:** the title at search-result and phone home-feed widths, cut to two lines. It's an approximate picture, not a measurement; YouTube's layout varies by device.
- **Outlier titles:** videos the network found in the last 90 days that beat their channel's usual by ×2 or more and contain the keyword, with plain counts (median length, titles with a number, questions, keyword early). Under 5 titles there are no counts, only the titles.
- **Your videos:** pick one of your videos to see its real search terms from YouTube Analytics (last 90 days) and whether each appears in the title, description or tags. You can edit the fields and see the checks update. Description: at least 250 characters, the keyword in the first 150, and valid chapters. Tags: at least 3, and within YouTube's 500-character limit. Each video check uses 1 YouTube Data API unit and is kept for 6 hours.
- **AI title ideas** are optional and labelled AI (see "AI").

## AI

**Ask AI** writes titles, descriptions, tags and video ideas, and answers questions about your channel. Every answer lists the data it used, line by line, and cites it as [S1], [S2]…
- **What it may use:** your channel's last 28 days, your top videos and real search terms from the last 90 days (YouTube Analytics), your tracked competitors' latest uploads (public feeds), and outliers the network found in the last 30 days. Whatever isn't available is listed with the reason. Nothing else is sent.
- **Where it goes:** the answer names the provider and model. Nothing about your questions or the answers is stored.
- **Included AI or your own key:** a server can include an AI (the hosted service uses Claude Haiku 5.5 for quick actions and Claude Sonnet 5.5 for Ask AI). Hosted limits each month: Free 20 quick actions; Pro 500 quick actions and 150 Ask AI messages. Self-hosted installs have no limits. In **Settings → AI & apps** you can add your own key instead (Anthropic, OpenAI, Google Gemini, DeepSeek, OpenRouter; and on self-hosted installs any OpenAI-compatible server such as Ollama). The key is tested before it's saved, stored encrypted per user, and your own key is never counted.
- **Server setup** (optional, `.dev.vars` or Wrangler secrets): `AI_API_KEY`, and optionally `AI_PROVIDER` (`anthropic` by default; `openai`, `gemini`, `deepseek`, `openrouter`, `custom`), `AI_BASE_URL` (for `custom`), `AI_QUICK_MODEL`, `AI_COACH_MODEL` (required for providers other than Anthropic), `AI_BRIEF_MODEL` (the weekly brief; defaults to `AI_COACH_MODEL`). With `AI_PROVIDER=custom` and `AI_BASE_URL`, no key is needed (local models).
- **Live check:** `VP_SESSION=<vp_session cookie> node apps/api/scripts/ai-live-check.mjs http://localhost:8787` runs one titles action and one question (at most 3 AI calls) and prints what came back.

## Weekly brief

On **Home → What to make next**, ViewProof's agent suggests 5 next videos and better titles for videos that do worse than usual. You decide; it never changes your channel.
- **What it reads:** the same data as Ask AI, plus up to 3 videos picked by code, not by the AI. A picked video was published 28 to 365 days ago, gets fewer views than your median over the last 28 days, and still gets at least one view a day. Each one comes with its own search terms.
- **Checked before you see it:** if a reason gives a number that isn't in that data, the suggestion is removed, and the brief says how many were removed. A title change must be for one of the picked videos, at most 100 characters, and different from the current title.
- **Then measured:** click **I'll use it** and change the title in YouTube Studio. ViewProof checks once a day. From the first day the new title is live, it compares views and search views over the 7 and 28 days after with the same number of days before. It also shows how much that video's views normally rose or fell between earlier periods. If the change is within that normal rise and fall, it says it can't tell whether the title helped. It never claims the title caused a change. All of this is plain arithmetic in `packages/core/src/agent.ts`; the AI never computes these numbers.
- **When:** when you click **Make one now**, or every week if you switch that on. Included with Pro (6 a month); with your own key on any plan. A weekly run that fails waits a day before trying again; after 3 failures in a row weekly runs pause until you make one or switch them on again. Each brief is capped at 8,000 output tokens, so one costs at most about $0.09 on Claude Sonnet 5.5.
- **Cost:** every AI answer's token counts are summed per month and model in `ai_tokens`, with no link to any account, so the hosted service knows what the AI really costs.
- **Kept:** briefs for 30 days. Title changes and their checks are kept until 60 days after the last check. Everything is deleted when you remove the channel.

## MCP server

Use ViewProof's data from your own AI app: ChatGPT, Claude, Claude Code, Cursor, VS Code and other apps that support MCP. Everything is on the **Connect AI** page in the app's menu. Your AI app does the writing; ViewProof gives it your real numbers. The tools are **read-only**: nothing is changed at YouTube or in ViewProof.
- **Tools:** `list_channels`, `channel_overview`, `channel_videos`, `search_terms`, `upload_times`, `video_details` (one of your videos with its own search terms), `find_outliers`, `competitor_uploads`, `keyword_trends`, `check_video_text` (the Optimize rules). They return the same data as the web app, from the same cache, so they cost no extra YouTube quota. A value YouTube doesn't give comes back as `no_data` with the reason, and the server tells the AI not to fill it in.
- **Chat apps (sign-in):** add a custom connector with the address `https://<your server>/mcp`, click Connect, sign in to ViewProof and click **Allow**. This is OAuth 2.1 with dynamic client registration and PKCE (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`). Access tokens last an hour; refresh tokens rotate on every use and end after 90 days unused. Up to 10 connected apps; disconnect any of them on Connect AI.
- **Developer tools (token):** on **Connect AI**, create a token (shown once; up to 5; revoke at any time). Then:
  - Claude Code: `claude mcp add --transport http viewproof https://<your server>/mcp --header "Authorization: Bearer <token>"`
  - Other apps: `{"mcpServers":{"viewproof":{"type":"http","url":"https://<your server>/mcp","headers":{"Authorization":"Bearer <token>"}}}}`
- **Limits:** 500 tool calls per day on the hosted service (no limit when self-hosted), shared by all your connected apps and tokens.

## Model eval

Before choosing which model the hosted service includes, `pnpm --filter api eval` sends 10 cases (titles, tags, a description, next-video ideas, coach questions and two weekly briefs) to each candidate in `apps/api/eval/candidates.json`. It uses the production prompts on a synthetic pottery channel and grades each answer with fixed checks:
- `parses`: valid JSON items;
- `count` and `length`: within limits;
- `cites` and `knownCitations`: cites only sources that were sent;
- `numbers`: every number is in the data, allowing rounding;
- `saysMissing`: says so when data is missing;
- `noInjection`: ignores instructions hidden in video titles;
- `changes`: a brief's title changes are for the videos it was given.

The report also prints the weekly brief's measured cost per Pro user per month for every candidate with a price (Claude Haiku 5.5 and Sonnet 5.5 are priced).

Keys come from `EVAL_ANTHROPIC_KEY` and `EVAL_OPENROUTER_KEY` (environment or `apps/api/.dev.vars`). A candidate without a key is listed as skipped. The report goes to `docs/model-eval/<date>.md`; raw answers stay in the git-ignored `apps/api/eval/out/`.

## Plans and billing

Hosted limits (self-hosted servers have none):

| | Free | Pro ($10/month) |
|---|---|---|
| Connected channels | 1 | 3 |
| Competitor channels | 3 | 25 |
| New keyword lookups (cached ones are free) | 5 / month | 60 / month |
| Outlier keyword searches (repeating one, or browsing by filters, is free) | 10 / day | no limit |
| Included AI quick actions | 20 / month | 500 / month |
| Ask AI messages | — | 150 / month |
| Weekly briefs | — (own key: no limit) | 6 / month |

Limits are hard and shown as counters under **Settings → Plan & usage**; nothing is billed as overage. Going back to Free never deletes data: channels and competitors above the limit stay, you just can't add more.

Billing is optional and uses **Stripe Managed Payments** (Stripe is the merchant of record and handles VAT and sales tax). To turn it on:

1. In Stripe, enable Managed Payments (Settings → Managed Payments) and create a Product with tax code `txcd_10103000` (SaaS, personal use) and a $10/month recurring Price.
2. Configure the customer portal (Settings → Billing → Customer portal) and turn on **Upcoming renewals** emails (Settings → Billing → Subscriptions and emails). Stripe sends the renewal reminder, receipts and invoices. Under Settings → Billing → Revenue recovery, set "If all retries for a payment fail" to **cancel the subscription**, so someone who never pays is moved back to Free instead of keeping Pro or an open subscription.
3. Add a webhook endpoint `https://<your server>/api/billing/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`.
4. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_ID` (Wrangler secrets, or `apps/api/.dev.vars` locally). Billing stays off unless all three are set, and always off when `SELF_HOSTED=true`.

Locally, use test-mode keys and forward events with `stripe listen --forward-to localhost:8787/api/billing/webhook` (its `whsec_…` goes in `STRIPE_WEBHOOK_SECRET`). The plan follows Stripe's webhooks (only subscriptions for `STRIPE_PRICE_ID` count, so other products on the same Stripe account don't turn on Pro), so cancelling in Stripe's portal or on link.com works too. Deleting your ViewProof account cancels the subscription at Stripe first.

## Tools

**Tools** has four small tools. None of them costs server data, and nothing you enter is stored on the server.
- **Tags:** paste a video link to see its public tags, with the character total YouTube counts (500 at most) and **Copy tags**. The extension reads the video's public YouTube page in your browser, without your YouTube sign-in: at most 30 lookups an hour, paused for 24 hours if YouTube refuses. **Check its chapters** opens the video's description in the chapter checker.
- **Chapters:** paste a description (and optionally the video's length) to check it against YouTube's chapter rules: timestamps at line starts, the first at 0:00, at least 3, in order, each at least 10 seconds. It lists the chapters or names the first broken rule.
- **Transcripts:** on a YouTube video, open the description and click **Show transcript**. The extension keeps that transcript in your browser only (the 20 newest, for 30 days). Tools lists them; open one to search it, copy the text or download it as .txt, with each line linked to its moment in the video. ViewProof calls no YouTube caption or transcript service.
- **Calculators:** engagement rate ((likes + comments) ÷ views), watch time (views × average view duration) and average view duration (watch time ÷ views), on numbers you type in. They never take numbers from YouTube's API: YouTube's developer policy forbids derived metrics from API data.

Live check (manual, 3 YouTube requests): `VP_SESSION=<vp_session cookie> node apps/extension/e2e/tools-live-check.mjs <outDir> <videoId>`, with the development build of the extension and a local server. Set `CHROMIUM_PATH` to use an installed Chromium.

## Self-hosting

A self-hosted server has no plan limits and no billing, uses your own Google OAuth client and keys, and has no access to the hosted data pool. There are three ways to run it, all with the same Worker code:

1. **Docker Compose** (one machine, data in a Docker volume):
   1. Create a Google OAuth client (step 1 of [apps/api/README.md](apps/api/README.md)) with the redirect URI `<APP_URL>/auth/google/callback`.
   2. `cp apps/api/.dev.vars.example apps/api/.dev.vars` and fill it in (`TOKEN_KEY`: `openssl rand -base64 32`).
   3. `APP_URL=https://viewproof.example.com docker compose up -d` (default `http://localhost:8787`; `PORT` changes the host port). Create `.dev.vars` before the first start: if it is missing, Docker may create an empty folder in its place, and the container then stops with a message saying so (delete the folder and create the file).

   The container applies database migrations at every start (only new ones run), runs the Worker under workerd (`wrangler dev`) with `SELF_HOSTED=true`, keeps D1 and R2 data in the `viewproof-data` volume, and calls the hourly job at minute 17. `.dev.vars` is mounted read-only and is never built into the image. The port is published on `127.0.0.1` only. For other machines, put an HTTPS reverse proxy in front (Google sign-in and secure cookies need HTTPS), set `APP_URL` to the proxy's address, and have the proxy refuse `/__scheduled` and `/cdn-cgi/`: they trigger the hourly job, which spends YouTube API quota.

   Back up the volume: `docker run --rm -v viewproof_viewproof-data:/data -v "$PWD":/out busybox tar czf /out/viewproof-data.tgz /data` (the volume name starts with the Compose project name, by default the folder name).
2. **Wrangler on your computer:** follow [apps/api/README.md](apps/api/README.md) (`pnpm install`, `.dev.vars`, `pnpm --filter api db:migrate:local`, `pnpm dev`). Set `SELF_HOSTED = "true"` in `wrangler.toml`. Run the hourly job by opening `http://localhost:8787/__scheduled` (start with `--test-scheduled`) or from cron.
3. **Your own Cloudflare account** (Workers Free is enough for a few users):
   ```sh
   cd apps/api
   npx wrangler d1 create viewproof        # put the printed database_id into wrangler.toml
   npx wrangler d1 migrations apply viewproof --remote
   npx wrangler r2 bucket create viewproof-pool
   npx wrangler secret put GOOGLE_CLIENT_ID     # and GOOGLE_CLIENT_SECRET, TOKEN_KEY, optional keys
   # wrangler.toml [vars]: APP_URL = "https://<your worker>.workers.dev", SELF_HOSTED = "true"
   pnpm --filter web build && npx wrangler deploy
   ```
   Cloudflare runs the hourly Cron Trigger itself.

**Privacy, terms and legal notice:** every server serves `/privacy`, `/terms` and `/imprint`, linked from every page. Set `OPERATOR_NAME`, `CONTACT_EMAIL` and `OPERATOR_ADDRESS` so they say who runs it; the privacy page follows the server's own setup (self-hosted or not, DataForSEO, billing, pool archive). Google's OAuth verification needs both pages and a contact address. The hosted service's launch steps are in [docs/closed-beta.md](docs/closed-beta.md).

**The extension and a self-hosted server:** the store build talks only to `viewproof.app`. To use keyword facts, Tools and the data pool with your own server, add your origin to `apps/extension/src/app-origins.ts` and build the extension yourself (see "Install from source").

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
