# ViewProof API (Cloudflare Worker)

Sign in with Google, connect a YouTube channel (view-only), see its status, export or delete your data.

## Run it locally / self-host

1. **Google OAuth client.** In Google Cloud Console: enable *YouTube Data API v3* and *YouTube Analytics API*; in *Google Auth Platform* set up the app (External), add the scopes `openid`, `email`, `profile`, `youtube.readonly`, `yt-analytics.readonly` (and `yt-analytics-monetary.readonly` if you want revenue), then *Clients → Create client → Web application* with the redirect URI `http://localhost:8787/auth/google/callback`.
2. **Settings.** Copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill in the client ID and secret. Generate `TOKEN_KEY` with `openssl rand -base64 32`. Self-hosters can set `SELF_HOSTED = "true"` in `wrangler.toml` to remove the channel limit.
3. **Database.** `pnpm --filter api db:migrate:local`
4. **Start.** `pnpm --filter api dev`, then open http://localhost:8787

### Google's testing limits
While your Google app is in *Testing*, Google ends each tester's access after 7 days and they must reconnect. Publishing the app while still unverified avoids that; users then see Google's "unverified app" warning, and an unverified project can only ever have 100 users. For more, Google must verify the app (homepage, privacy policy, terms, a demo video; it can take weeks).

## What is stored

- Your Google account id, email and name; your plan.
- Each connected channel's id, title, handle, picture and the permissions you gave. Google's refresh token is stored **encrypted** (AES-256-GCM with `TOKEN_KEY`); it never appears in exports or API responses.
- Login sessions: only a hash of the session id (the id itself is in your browser's cookie).

**Export** (Account → Export my data) downloads all of it as JSON, without secrets. **Remove** a channel or **Delete account** revokes ViewProof's Google access and deletes the rows.

## Tests

`pnpm --filter api test` runs inside the Workers runtime (workerd) with a fake Google; no request goes to Google.
