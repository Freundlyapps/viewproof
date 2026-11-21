# ViewProof

Open-source YouTube research tools: an alternative to vidIQ that shows where every number comes from.
License: AGPL-3.0. Status: Phase 1 — plan 1 (browser extension) and plan 2 (server: Google sign-in, channel connect, account) of 8.

## The browser extension (Chrome, Edge)

On any YouTube video page, a panel at the top of the right-hand column shows:

- **Views / hour**: views divided by hours since upload ("avg since upload"). If you opened the same video at least an hour earlier and its count has moved, it uses the change since your last visit instead ("since your last visit"). A line under the tiles shows the exact numbers used.
- **vs usual (×N)**: this video's views divided by the median views of the channel's earlier uploads of the same type (long video or Short), taken from the channel's public RSS feed (its latest 15 uploads). It needs at least 5 earlier videos of the same type; otherwise it says "No data" and why. Videos older than the channel's latest 15 uploads get "No data" too: the feed has nothing earlier to compare with.
- **Age** and **tags** (the video's public tags).

Live and upcoming videos show "No data" with the reason instead of a misleading number.

### Privacy

The extension sends nothing to ViewProof or anyone else. It talks only to `www.youtube.com`: it reads the data the page already loaded and fetches the channel's public RSS feed without cookies. Your past view-count sightings are stored only in your browser (`chrome.storage.local`, the latest per video, up to 2,000 videos).

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

## Repository layout

- `packages/core`: scores and parsers shared by every part (views per hour, outlier ×N, feed and player parsers).
- `apps/extension`: the browser extension (WXT, Manifest V3).
- `apps/api`: the server (Cloudflare Worker, Hono, D1): sign-in, channel connect, account. See [apps/api/README.md](apps/api/README.md).
- `packages/db`: database migrations.
- `docs/`: design spec, UI prototype and build plans.
