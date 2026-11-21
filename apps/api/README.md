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

## What is stored

- Your Google account id, email and name; your plan.
- Each connected channel's id, title, handle, picture and the permissions you gave. Google's refresh token is stored **encrypted** (AES-256-GCM with `TOKEN_KEY`); it never appears in exports or API responses.
- Login sessions: only a hash of the session id (the id itself is in your browser's cookie).

**Export** (Account → Export my data) downloads all of it as JSON, without secrets. **Remove** a channel or **Delete account** revokes ViewProof's Google access and deletes the rows.

## Tests

`pnpm --filter api test` runs inside the Workers runtime (workerd) with a fake Google; no request goes to Google.
