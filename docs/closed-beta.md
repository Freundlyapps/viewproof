# Closed beta checklist (spec D8)

Phase 1 launches as a closed beta while Google verifies the app. Google's limit for an unverified app is **100 users**. Work through this list in order; each line says where to do it.

## 1. Server ready
- [ ] Production Worker deployed (README → Self-hosting, option 3): D1 created and migrated (`--remote`), R2 bucket `viewproof-pool` with the 36-month lifecycle rule ([apps/api/README.md](../apps/api/README.md) → Data pool), Cron Trigger active.
- [ ] Secrets set with `wrangler secret put`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_KEY` (new, never reused from development), and optional `YOUTUBE_API_KEY`, `AI_API_KEY`, Stripe keys.
- [ ] `[vars]`: `APP_URL = "https://viewproof.app"`, `SELF_HOSTED = "false"`, `OPERATOR_NAME`, `CONTACT_EMAIL` (an address someone reads).
- [ ] `https://viewproof.app/privacy` and `/terms` open signed out and show the operator and contact.
- [ ] `CRON_FEED_BUDGET` matches the Workers plan (Free 10, Paid 45).

## 2. Google Cloud project (Google Auth Platform)
- [ ] **Branding:** app name ViewProof, logo, support email, homepage `https://viewproof.app`, privacy policy `https://viewproof.app/privacy`, terms `https://viewproof.app/terms`, authorized domain `viewproof.app`.
- [ ] **Domain:** verify `viewproof.app` in Google Search Console with the same Google account that owns the project.
- [ ] **Clients:** a production Web client with the redirect URI `https://viewproof.app/auth/google/callback` (separate from the development client).
- [ ] **Data access:** only `openid`, `email`, `profile`, `youtube.readonly`, `yt-analytics.readonly`, `yt-analytics-monetary.readonly`. Write one justification per scope from what the app shows (My channel, search terms, Earnings).
- [ ] **Audience:** while in Testing, add each beta user's Google address as a test user (at most 100). Testing access ends after 7 days and users must reconnect; publishing unverified removes that, but users then see Google's "unverified app" screen.

## 3. Google verification (sensitive scopes)
- [ ] Demo video (unlisted YouTube link): the sign-in screen with the app name and scopes, the address bar showing `viewproof.app`, then each scope in use (My channel tabs, search terms, Earnings).
- [ ] Submit in the Verification Center. Answer Google's emails from the support address; verification can take weeks.

## 4. YouTube API Services
- [ ] Check the project's quota use in Google Cloud (YouTube Data API v3: 10,000 units a day by default). ViewProof mostly uses YouTube Analytics, and the Data API for uploads (1 unit per call, cached 6 hours) and video checks.
- [ ] Before the quota runs short, submit the **YouTube API Services Audit and Quota Extension Form**. It reviews compliance with the YouTube API Services Developer Policies. Point it to the privacy page, the "no derived metrics from API data" rule (README → The web app), and the cache times.
- [ ] Keep `YOUTUBE_API_KEY` usage (competitor @handles, subscriber counts) in mind: it shares the same project quota.

## 5. Extension
- [ ] Chrome Web Store: publish the store build (`pnpm --filter extension build`) as **unlisted**, with the privacy policy link and the single-purpose and permission justifications (youtube.com: read the pages you open; suggestqueries: YouTube's autocomplete; viewproof.app: keyword facts, Tools and the opt-in pool).
- [ ] Edge Add-ons: the same build.

## 6. Optional services
- [ ] Stripe live mode (README → Plans and billing): Managed Payments, product tax code, portal, renewal emails, webhook, revenue recovery set to cancel.
- [ ] DataForSEO: keep `DATAFORSEO_DISPLAY_OK` off until DataForSEO's written OK to display Trends data arrives.
- [ ] Included AI: run `pnpm --filter api eval` with keys and pick the models from the report.

## 7. Beta run
- [ ] Invite users one by one (test users list) and track them against the 100 limit.
- [ ] Smoke test with a fresh account: sign in, connect, My channel, keywords with the extension, competitors, Tools, Ask AI, export, delete.
- [ ] Watch the hourly job's logs (`wrangler tail`) for feed errors and quota errors during the first week.
