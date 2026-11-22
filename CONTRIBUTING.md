# Contributing to ViewProof

Thanks for helping. ViewProof is AGPL-3.0; by opening a pull request you agree your change is licensed the same way.

## How changes get in

1. Fork the repository and create a branch from `main`.
2. Make your change with tests (`pnpm test`, `pnpm typecheck`).
3. Open a pull request against `main`. CI runs the privacy check, the type check and every test suite.
4. A maintainer reviews it. Pull requests are merged with **squash and merge**, so `main` gets one commit per change.

`main` is never rewritten. If something private ever lands in a pull request, it is fixed in the pull request before merging (see below), not by rewriting `main` afterwards.

## Test fixtures

Most parsers are tested against real YouTube page data saved as JSON. Real data is what keeps the parsers honest, but it can carry details about the person who saved it.

- **Capture logged out**, in a fresh browser profile. Logged-in pages carry your account name, avatar and channel.
- **Remove stream URLs.** YouTube's page and player JSON contains `googlevideo.com` links, and every one of them has the capturing computer's IP address in it (`ip=…`). Delete `streamingData`, `playerAds`, `watchEndpointSupportedOnesieConfig` and anything else holding such links, and trim the file to what the test needs.
- **Never commit** `.dev.vars`, `.env` files, cookies, OAuth tokens or HAR files.
- Note the capture date in the test file's first comment.

`pnpm check:privacy` scans every tracked file for stream URLs, IP addresses in fixtures, and secrets files. CI runs it on every pull request, and a failing check blocks the merge.

## If private data gets into a pull request

- **Before merge:** push a commit that removes it, then squash-merge. The squashed commit on `main` will not contain it. The pull request's own commits stay visible on GitHub, so for anything sensitive (a token, an IP address) ask a maintainer to close the pull request and open a clean one, and **revoke the token** in any case.
- **After merge:** treat the data as public. Revoke secrets immediately; rewriting history does not undo exposure. Maintainers decide whether a history rewrite is worth it (see `docs/maintainers.md`).
