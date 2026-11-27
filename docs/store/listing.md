# Chrome Web Store / Edge Add-ons listing

Copy these into the store dashboard. The privacy answers (single purpose, permission justifications, data usage) are in [../closed-beta.md](../closed-beta.md), section 5. Everything here must stay true to what the extension does; update it with the extension.

## Store listing tab

- **Name:** ViewProof (from the manifest)
- **Summary** (from the manifest description, 126 of 132 characters): Views per hour, outlier score and tags on YouTube; keyword facts for ViewProof. Open source; shares nothing unless you opt in.
- **Category:** Productivity → Tools
- **Language:** English
- **Icon:** `docs/store/store-icon-128.png`
- **Small promo tile (440×280):** `docs/store/promo-tile-440x280.png`
- **Screenshots (1280×800):** `docs/store/screenshots/` (local only, see the checklist)
  1. `1-watch.png`: the panel on a video page
  2. `2-search.png`: the panel on a search results page
  3. `3-channel.png`: the panel on a channel's Videos tab
- **Homepage URL:** https://viewproof.app
- **Support URL:** the GitHub repository's Issues page

### Description

```
ViewProof shows the numbers behind YouTube videos, and how each one was worked out.

ON A VIDEO PAGE
• Views per hour: views divided by hours since upload, with the exact numbers used.
• vs usual (×N): this video's views compared with the median of the channel's recent uploads of the same type. If there aren't enough recent uploads to compare with, it says "No data" and why.
• Age and the video's public tags, with a Copy tags button.
• Checklist: title and description length, tags, chapters, end screen and captions. Each check shows the rule it used, and you can change or switch off every rule.

ON A SEARCH RESULTS PAGE
• Facts about the results you see: median views, median upload age, how many are recent, how many have under 10,000 views.
• ×N badges on results, comparing each with its channel's usual views.

ON A CHANNEL'S VIDEOS TAB
• The channel's usual views and its biggest outliers, with a ×N badge on each video.

HONEST NUMBERS
Every number says where it comes from. When there isn't enough data, ViewProof says "No data" and why, instead of guessing.

PRIVATE BY DEFAULT
The extension works without an account. What it reads stays in your browser. It sends nothing to anyone unless you switch on the optional data pool in its settings, which shows exactly what would be shared and keeps a record of everything sent.

With a free ViewProof account (viewproof.app), the extension also adds keyword facts and tools to the web app.

Open source (AGPL-3.0). Works on Chrome and Edge.
```

## Privacy practices tab: test instructions for the reviewer

```
No account or login is needed to test the extension.

1. Install the extension and open any YouTube video, for example https://www.youtube.com/watch?v=KfODG5REyss
   A "ViewProof" panel appears at the top of the right-hand column: views per hour, ×N vs usual, age, tags and a checklist.
2. Search YouTube for "pottery wheel beginner". A ViewProof panel with facts about the results appears above them.
3. Open https://www.youtube.com/@veritasium/videos. A ViewProof panel and ×N badges appear on the Videos tab.
4. Open the extension's options page. Each page type can be switched off, and the checklist rules can be edited.
   The data pool section is off by default and sends nothing until the user clicks "I agree — start sharing" AND links the browser to a ViewProof account.

Besides the pages the user opens, the extension only fetches YouTube's public RSS feeds and search suggestions, and a video's public watch page when the user looks it up on the ViewProof Tools page. All without cookies. It runs no remote code.
```
