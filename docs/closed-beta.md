# Closed beta checklist (spec D8)

Phase 1 launches as a closed beta while Google verifies the app. Google's limit for an unverified app is **100 users**. Work through this list in order; each line says where to do it.

## 1. Server ready
- [ ] Production Worker deployed (README → Self-hosting, option 3): D1 created and migrated (`--remote`), R2 bucket `viewproof-pool` with the 36-month lifecycle rule ([apps/api/README.md](../apps/api/README.md) → Data pool), Cron Trigger active.
- [ ] Secrets set with `wrangler secret put`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_KEY` (new, never reused from development), and optional `YOUTUBE_API_KEY`, `AI_API_KEY`, Stripe keys.
- [ ] `[vars]`: `APP_URL = "https://viewproof.app"`, `SELF_HOSTED = "false"`, `OPERATOR_NAME`, `CONTACT_EMAIL` (an address someone reads), `OPERATOR_ADDRESS` (postal address, lines split by `\n`). A paid service run from Germany needs a legal notice with name, address and email (§ 5 DDG), reachable from every page.
- [ ] `https://viewproof.app/privacy`, `/terms` and `/imprint` open signed out and show the operator, contact and address; the footer of every server page and of the app (`/app`, also signed out) links all three.
- [ ] `CRON_FEED_BUDGET` matches the Workers plan (Free 10, Paid 45).

## 2. Google Cloud project (Google Auth Platform)
- [ ] **Branding:** app name ViewProof, logo, support email, homepage `https://viewproof.app`, privacy policy `https://viewproof.app/privacy`, terms `https://viewproof.app/terms`, authorized domain `viewproof.app`.
- [ ] **Domain:** verify `viewproof.app` in Google Search Console with the same Google account that owns the project.
- [ ] **Clients:** a production Web client with the redirect URI `https://viewproof.app/auth/google/callback` (separate from the development client).
- [ ] **Data access:** only `openid`, `email`, `profile`, `youtube.readonly`, `yt-analytics.readonly`, `yt-analytics-monetary.readonly`. Write one justification per scope from what the app shows (My channel, search terms, Earnings).
- [ ] **Audience:** while in Testing, add each beta user's Google address as a test user (at most 100). Testing access ends after 7 days and users must reconnect; publishing unverified removes that, but users then see Google's "unverified app" screen.

## 3. Google verification (sensitive scopes)
- [ ] Demo video (unlisted YouTube link, in English): the whole sign-in flow. The consent screen with the app name and scopes, the address bar on the consent screen showing the production client id (`client_id=` in the URL), then each scope in use (My channel tabs, search terms, Earnings).
- [ ] Per scope, a justification that also says why a narrower scope isn't enough (e.g. `youtube.readonly` is the narrowest scope that lists the channel's own uploads).
- [ ] The privacy policy is on `viewproof.app`, is the same URL on the consent screen, the homepage and in the app, and differs from the homepage URL.
- [ ] Submit in the Verification Center. Answer Google's emails from the support address; verification can take weeks.

## 4. YouTube API Services
- [ ] Check the project's quota use in Google Cloud (YouTube Data API v3: 10,000 units a day by default). ViewProof mostly uses YouTube Analytics, and the Data API for uploads (1 unit per call, cached 6 hours) and video checks.
- [ ] Before the quota runs short, submit the **YouTube API Services Audit and Quota Extension Form**. It reviews compliance with the YouTube API Services Developer Policies. Point it to the privacy page, the "no derived metrics from API data" rule (README → The web app), and the cache times.
- [ ] Keep `YOUTUBE_API_KEY` usage (competitor @handles, subscriber counts) in mind: it shares the same project quota.

## 5. Extension

Both stores review the Privacy tab against the code and the privacy page: everything below must match what the extension does. Rejections come from a permission the code doesn't use ("Purple Potassium"), a missing or inaccurate privacy policy ("Purple Lithium") or undisclosed data handling ("Purple Nickel"). Access to all of `www.youtube.com` means a slower, closer review: expect days to a few weeks; contact Chrome Web Store support only after 3 weeks.

- [ ] Build: `pnpm --filter extension build` (the store build has no `localhost` hosts). Upload as **unlisted** to the Chrome Web Store.
- [ ] **Single purpose:** "Shows public YouTube numbers (views per hour, outlier score, tags) on the YouTube pages you open, and hands what it read to your ViewProof account's keyword research and Tools pages."
- [ ] **Permission justifications** (one per entry in the manifest; plain facts, no marketing):
  - `storage`: "Keeps what the extension read on YouTube (view counts, the first results page of your YouTube searches, transcripts you open, video lookups) and your settings in this browser only."
  - `alarms`: "Every 5 minutes, sends the public video facts waiting to be shared, only if you opted in to the data pool."
  - `https://www.youtube.com/*`: "Content scripts run on the YouTube watch and search pages you open, to read the view counts, search results and transcript panel shown there and add the ViewProof panel; they also fetch, without cookies, the channel's public RSS feed to compare a video with the channel's recent uploads. Only when you look a video up on the Tools page, the background fetches that video's public watch page, without cookies."
  - `https://suggestqueries-clients6.youtube.com/*`: "Fetches YouTube's own search suggestions for the keyword you research in ViewProof, without cookies."
  - `https://viewproof.app/*`: "Hands what the extension read on YouTube to your own ViewProof pages in this browser, and sends public video facts to the data pool only if you opt in."
  - Remote code: **No** (everything runs from the package).
- [ ] **Data usage:** tick **Website content** (opt-in pool uploads: public video facts read from YouTube pages). Leave the others unticked: searches, transcripts and view counts stay in the browser and are never uploaded; nothing about the person (no account, cookies, watch time) is collected. Tick all three certifications (no sale, no unrelated use, no creditworthiness use).
- [ ] **Privacy policy URL:** `https://viewproof.app/privacy` (its "Browser extension and data pool" section must match the ticks above).
- [ ] Edge Add-ons: the same build and the same Privacy-page answers. In "Notes for certification", give the test steps (open a YouTube video → the ViewProof panel; the data pool stays off until linked in Settings → Extension & data). Certification takes up to 7 business days.

## 6. Optional services
- [ ] Stripe live mode (README → Plans and billing): Managed Payments, product tax code, portal, renewal emails, webhook, revenue recovery set to cancel.
- [ ] DataForSEO: keep `DATAFORSEO_DISPLAY_OK` off until DataForSEO's written OK to display Trends data arrives.
- [ ] Included AI: run `pnpm --filter api eval` with keys and pick the models from the report.

## 7. Beta run
- [ ] Invite users one by one (test users list) and track them against the 100 limit.
- [ ] Smoke test with a fresh account: sign in, connect, My channel, keywords with the extension, competitors, Tools, Ask AI, export, delete.
- [ ] Watch the hourly job's logs (`wrangler tail`) for feed errors and quota errors during the first week.
