# ViewProof API (Cloudflare Worker)

Sign in with Google, connect a YouTube channel (view-only), see its status, export or delete your data.

## Run it locally / self-host

1. **Google OAuth client.** In Google Cloud Console: enable *YouTube Data API v3* and *YouTube Analytics API*; in *Google Auth Platform* set up the app (External), add the scopes `openid`, `email`, `profile`, `youtube.readonly`, `yt-analytics.readonly` (and `yt-analytics-monetary.readonly` if you want revenue), then *Clients → Create client → Web application* with the redirect URI `http://localhost:8787/auth/google/callback`.
2. **Settings.** Copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill in the client ID and secret. Generate `TOKEN_KEY` with `openssl rand -base64 32`. Self-hosters can set `SELF_HOSTED = "true"` in `wrangler.toml` to remove the channel limit. Set `APP_URL` to the exact public address people open (behind a proxy, the proxy's https address): form posts from any other origin are refused.
3. **Database.** `pnpm --filter api db:migrate:local`
4. **Start.** `pnpm dev` (builds the web app, then starts the Worker), then open http://localhost:8787. The app is at `/app`. After changing code, stop and start again: on WSL Windows drives file changes aren't detected.

For web development with hot reload, run the Worker as above and `pnpm --filter web dev` (Vite on http://localhost:5173/app/, API calls proxied to 8787).

### Google's testing limits
While your Google app is in *Testing*, Google ends each tester's access after 7 days and they must reconnect. Publishing the app while still unverified avoids that; users then see Google's "unverified app" warning, and an unverified project can only ever have 100 users. For more, Google must verify the app (homepage, privacy policy, terms, a demo video; it can take weeks).

## My channel data

The Worker reads YouTube Analytics (`reports.query`) and the Data API (your uploads) with the stored access, and caches the answers in D1 for 6 hours (first-week views per video for 30 days; "no views yet" and "revenue not available" are re-asked sooner). A cached answer is served without contacting Google; Google access is renewed at most once per 45 minutes per channel, and tabs that load together share one request. Removing a channel or deleting the account deletes its cached reports. YouTube's data lags 48–72 hours; each view says how far it goes.

## YouTube search interest (optional)

The keyword report can show relative YouTube search interest (Google Trends with the YouTube search filter, 100 = peak week) from DataForSEO. Set `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` in `.dev.vars` (or as Wrangler secrets). It stays **off** until you also set `DATAFORSEO_DISPLAY_OK=yes`, which confirms you're allowed to show DataForSEO data to your users. The hosted service keeps it off until DataForSEO confirms in writing.

- **Cost:** one DataForSEO call per keyword and country, about $0.01.
- **Cache:** answers are kept for 30 days and shared by every user (table `keyword_cache`, which holds no personal data). Failed answers are not kept.
- **Limit:** each user can look up 50 new keywords a day; keywords already in the cache don't count.

## Competitors

- **Feeds:** the hourly Cron Trigger (`17 * * * *` in `wrangler.toml`) fetches up to 60 public channel feeds. Opening a page fetches at most 3 more. No feed is fetched more than once in 3 hours.
- **Snapshots:** a video's view count is stored when it changed, or once a day. Snapshots older than 90 days are deleted.
- **Optional `YOUTUBE_API_KEY`:** a YouTube Data API key, used to add channels by @handle and for current subscriber/total-view counts. Counts are refreshed daily at 03:xx UTC (`channels.list`, 1 quota unit per 50 channels) and cleared after 30 days. Without a key, the adding user's own connected channel resolves @handles.
- **Clean-up:** a channel nobody tracks any more is deleted with its videos and snapshots on the next Cron run.

Test the Cron job locally with `npx wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=17+*+*+*+*"`.

## Data pool

- **Routes:**
  - `POST /api/pool/tokens` links a browser (the session plus an app-origin check);
  - `GET` and `DELETE /api/pool/browsers[/:id]`;
  - `POST /api/pool/contribute` takes the bearer token only, no cookie;
  - `GET /api/outliers`.
- **Cron budget per hourly run:** up to 30 user-tracked feeds, then up to 15 pool channels seen in the last 30 days. That keeps each run under the Workers Free limit of 50 subrequests.
- **Retention:**
  - observations in D1 for 90 days;
  - pool channels not seen for 30 days are removed with their videos.
- **Archive:** at 04:xx UTC the previous day's accepted observations go to R2 as `pool/YYYY/MM/DD.ndjson.gz` (binding `POOL`, bucket `viewproof-pool`). Without the binding, the archive step is skipped.
- **R2 setup:** create the bucket and the 36-month lifecycle rule once:

  ```sh
  npx wrangler r2 bucket create viewproof-pool
  npx wrangler r2 bucket lifecycle add viewproof-pool expire-36m --expire-days 1095 -y
  ```

## What is stored

- Your Google account id, email and name; your plan.
- Each connected channel's id, title, handle, picture and the permissions you gave. Google's refresh token is stored **encrypted** (AES-256-GCM with `TOKEN_KEY`); it never appears in exports or API responses.
- Login sessions: only a hash of the session id (the id itself is in your browser's cookie).
- Browsers you linked to the data pool (a label, dates, status), a hash of each browser's token, and how many items each sent and had rejected per day. Pool observations themselves (video id, time, view count, watch/search) carry no user or browser id.
- The channels you track as competitors, and how many new keyword lookups you made each day. Tracked channels' public feed data (titles, upload times, view counts over time) is shared by every user who tracks them, and is deleted when nobody does.

**Export** (Account → Export my data) downloads all of it as JSON, without secrets. **Remove** a channel or **Delete account** revokes ViewProof's Google access and deletes the rows.

## Tests

`pnpm --filter api test` runs inside the Workers runtime (workerd) with a fake Google; no request goes to Google.
