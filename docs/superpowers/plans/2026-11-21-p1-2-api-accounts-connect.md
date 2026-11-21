# API, accounts and channel connect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker that lets a creator sign in with Google (view-only permissions), confirm "Is this the right channel?", see each connected channel's status, remove it, export their data and delete their account — runnable locally with `wrangler dev`.

**Architecture:** `apps/api` is a Hono app on Workers with D1. Google is reached only through a `GoogleClient` interface injected into the app, so tests use a fake and production uses `fetch`. Refresh tokens are encrypted (AES-GCM) before they reach D1; sessions are random ids stored hashed. The few pages this plan needs (sign-in result, channel confirmation, account) are server-rendered with Hono JSX using the §15 tokens; the React app arrives in plan 3 and calls the JSON endpoints added here.

**Tech Stack:** Hono, Wrangler, D1, Vitest with `@cloudflare/vitest-pool-workers`, Web Crypto.

**Spec:** `docs/superpowers/specs/2026-11-20-viewproof-design.md` (§6 S1, §9, §10, D3, D5, D8, D9, §15). Roadmap: `docs/superpowers/plans/2026-11-20-phase1-roadmap.md` (plan 2).

**Out of scope here:** extension API tokens (D5, moves to plan 5 where the extension first talks to the server), analytics data (plan 3), the 30-day consent re-check job (plan 3, uses `channels.last_verified_at` added here), billing (plan 7; `users.plan` defaults to `'free'`).

## Global Constraints

- Scopes (D8, read-only): sign-in `openid email profile`; channel `https://www.googleapis.com/auth/youtube.readonly` and `https://www.googleapis.com/auth/yt-analytics.readonly`; revenue `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` only when the user ticks "Also show my revenue". No write scopes.
- D9 copy: confirmation page title "Is this the right channel?"; shows avatar, title, handle, subscriber count, channel id; note "Not the one? Google's list sometimes shows a channel's old name. Go back and pick the account in the same position as in your YouTube channel list."; buttons "Yes, connect" and "Pick another". A removed channel shows "No longer exists" with a Remove button — never a re-auth loop.
- Channel limits (spec §9 / plan table): Free 1, Pro 3, self-hosted (`SELF_HOSTED=true`) unlimited. Over the limit: a clear message, nothing stored.
- One ViewProof account per YouTube channel (anti-abuse rule for the free tier): a channel already connected to another account is refused with "This channel is already connected to another ViewProof account."
- Owner's rule: no placeholders — a missing value is shown as missing with a reason.
- Privacy (§10): no telemetry; users can export and delete everything; tokens never leave the server and never appear in exports or logs; removing a channel or account revokes Google access.
- Secrets only in `apps/api/.dev.vars` (git-ignored) locally and Wrangler secrets in production: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_KEY` (base64, 32 bytes). Vars: `APP_URL`, `SELF_HOSTED`.
- Cookies: `HttpOnly; Secure; SameSite=Lax; Path=/` (Secure dropped only when `APP_URL` is `http://localhost…`). State-changing requests are POST and must carry an `Origin` equal to `APP_URL`.
- Colours and type from §15; UI copy in plain English.
- Live Google calls in development: only by the owner signing in by hand; tests never call Google.
- Tests on `/mnt/f` may need a single worker; if the Workers pool cannot run on this mount, record a ruling and run the suite from an ext4 copy.

## Review Focus

1. **Wrong brand account picked** (Google's chooser shows old names): "Pick another" must reopen Google's account chooser, not silently reuse the last account. → Task 6 test `pick another forces the account chooser`.
2. **User unticks a permission** on Google's consent screen (granular consent) or presses Cancel → a page naming the missing permission; no half-connected channel stored. → Task 5 tests `denied consent`, `missing youtube scope`.
3. **Channel removed or access revoked later** → status "No longer exists" / "Reconnect needed", each with one clear action. → Task 7 tests `invalid_grant marks reconnect`, `empty channel list marks gone`.
4. **No refresh token returned** → "Couldn't get lasting access; please try again", nothing stored. → Task 5 test `no refresh token`.
5. **Replay / double submit:** reused OAuth callback URL or a second "Yes, connect" click → "This link has expired, start again" / idempotent success, never two rows. → Task 5 test `state is single use`, Task 6 test `confirm twice`.

---

## File structure

```
packages/db/
  package.json
  migrations/0001_accounts.sql
  src/index.ts            row types (User, Session, OAuthState, Channel, PendingConnection)
apps/api/
  package.json, wrangler.toml, tsconfig.json, vitest.config.ts, .dev.vars.example
  src/index.ts            Worker entry: createApp(realDeps(env))
  src/app.ts              createApp(deps) → Hono; route wiring; Origin check
  src/env.ts              Env type, parseConfig(env)
  src/crypto.ts           randomToken, sha256Hex, encryptSecret, decryptSecret, pkcePair
  src/google.ts           GoogleClient interface + httpGoogleClient(fetch, config)
  src/session.ts          createSession, readSession, clearSession
  src/routes/auth.ts      /auth/google/start, /auth/google/callback, /auth/logout
  src/routes/connect.ts   /connect/confirm (GET, POST), /connect/cancel
  src/routes/account.ts   /account, /channels/:id/check, /channels/:id/remove, /account/export, /account/delete, /api/me, /api/channels
  src/views/*.tsx         Layout, ConfirmChannel, Account, Message
  test/*.test.ts, test/fake-google.ts, test/setup.ts
```

---

### Task 1: Worker scaffold and database schema

**Files:** Create `packages/db/{package.json,migrations/0001_accounts.sql,src/index.ts}`, `apps/api/{package.json,wrangler.toml,tsconfig.json,vitest.config.ts,.dev.vars.example,src/index.ts,src/app.ts,src/env.ts}`, `apps/api/test/{setup.ts,health.test.ts,schema.test.ts}`

**Interfaces:**
- Produces:
```ts
// env.ts
export interface Env { DB: D1Database; APP_URL: string; SELF_HOSTED?: string; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; TOKEN_KEY: string }
export interface Config { appUrl: string; selfHosted: boolean; secureCookies: boolean; googleClientId: string; googleClientSecret: string; tokenKey: string }
export function parseConfig(env: Env): Config; // throws naming the missing variable
// app.ts
export interface Deps { db: D1Database; config: Config; google: GoogleClient; now: () => number }
export function createApp(deps: Deps): Hono;
```
- Schema (`0001_accounts.sql`), all times ISO text:
  - `users(id TEXT PK, google_sub TEXT UNIQUE NOT NULL, email TEXT, name TEXT, plan TEXT NOT NULL DEFAULT 'free', created_at TEXT NOT NULL)`
  - `sessions(id_hash TEXT PK, user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE, created_at, expires_at TEXT NOT NULL)`
  - `oauth_states(state TEXT PK, code_verifier TEXT NOT NULL, user_id TEXT, want_revenue INTEGER NOT NULL, created_at TEXT NOT NULL)` — expires 10 min after `created_at`
  - `pending_connections(id TEXT PK, user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE, channel_id, title, handle, avatar_url, subscriber_count INTEGER NULL, video_count INTEGER NULL, scopes TEXT NOT NULL, refresh_token_enc TEXT NOT NULL, created_at TEXT NOT NULL)`
  - `channels(id TEXT PK, user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE, platform TEXT NOT NULL DEFAULT 'youtube', channel_id TEXT UNIQUE NOT NULL, title, handle, avatar_url, scopes TEXT NOT NULL, refresh_token_enc TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','reconnect','gone')), status_reason TEXT, connected_at, last_verified_at TEXT NOT NULL)`

- [ ] **Step 1:** Add packages: `hono` (api dep), `wrangler`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types` (dev). `wrangler.toml`: `name = "viewproof-api"`, `main = "src/index.ts"`, `compatibility_date` = today, `compatibility_flags = ["nodejs_compat"]`, `[[d1_databases]] binding = "DB", database_name = "viewproof", database_id = "local", migrations_dir = "../../packages/db/migrations"`, `[vars] APP_URL = "http://localhost:8787"`, `SELF_HOSTED = "false"`. `.dev.vars.example` lists the three secrets with empty values and a comment on generating `TOKEN_KEY` (`openssl rand -base64 32`). Vitest config uses `defineWorkersConfig` with the wrangler file, test bindings for the secrets (dummy values), and `setup.ts` applying migrations with `applyD1Migrations`.
- [ ] **Step 2: Failing tests** — `health.test.ts`: `GET /health` → 200 `{ ok: true }`. `schema.test.ts`: after migrations, `sqlite_master` lists the five tables; inserting two `channels` rows with the same `channel_id` fails; a `status` outside the three values fails. `parseConfig` without `TOKEN_KEY` throws `'TOKEN_KEY is not set'`; `secureCookies` false for `http://localhost:8787`, true for `https://viewproof.app`.
- [ ] **Step 3:** Run `pnpm --filter api test`; expect FAIL.
- [ ] **Step 4:** Implement `env.ts`, `app.ts` (health route only; `GoogleClient` type imported from Task 3 — define the interface file now with the signatures in Task 3), `index.ts`.
- [ ] **Step 5:** Run; PASS. `pnpm --filter api exec wrangler d1 migrations apply viewproof --local` succeeds. Commit `feat(api): worker scaffold and accounts schema`.

### Task 2: Crypto helpers

**Files:** Create `apps/api/src/crypto.ts`, `apps/api/test/crypto.test.ts`

**Interfaces:**
- Produces:
```ts
export function randomToken(bytes?: number): string;            // base64url, default 32 bytes
export function sha256Hex(s: string): Promise<string>;
export function pkcePair(): Promise<{ verifier: string; challenge: string }>; // S256
export function encryptSecret(plain: string, keyB64: string): Promise<string>; // "v1.<iv b64url>.<ciphertext b64url>"
export function decryptSecret(box: string, keyB64: string): Promise<string>;    // throws on tamper / wrong key
```

- [ ] **Step 1: Failing tests** — round-trip; two encryptions of the same text differ (random IV); flipping one ciphertext character throws; wrong key throws; `sha256Hex('abc')` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; PKCE challenge equals base64url(SHA-256(verifier)) with no padding; `randomToken()` length 43.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement with Web Crypto (AES-GCM 256, 12-byte IV). **Step 4:** PASS. **Step 5:** Commit `feat(api): token encryption and PKCE helpers`.

### Task 3: Google client

**Files:** Create `apps/api/src/google.ts`, `apps/api/test/google.test.ts`, `apps/api/test/fake-google.ts`

**Interfaces:**
- Produces:
```ts
export const SCOPES = { signIn: ['openid', 'email', 'profile'], channel: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'], revenue: 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly' } as const;
export interface TokenSet { refreshToken: string | null; accessToken: string; scopes: string[]; idClaims: { sub: string; email?: string; name?: string } }
export interface MyChannel { channelId: string; title: string; handle: string | null; avatarUrl: string | null; subscriberCount: number | null; videoCount: number | null }
export type GoogleError = { kind: 'revoked' } | { kind: 'failed'; reason: string };
export interface GoogleClient {
  authUrl(a: { state: string; challenge: string; wantRevenue: boolean; chooseAccount: boolean }): string;
  exchangeCode(code: string, verifier: string): Promise<TokenSet | GoogleError>;
  refresh(refreshToken: string): Promise<{ accessToken: string } | GoogleError>;
  myChannels(accessToken: string): Promise<MyChannel[] | GoogleError>;  // channels.list part=snippet,statistics mine=true (1 unit)
  revoke(token: string): Promise<void>;                                  // best effort, never throws
}
export function httpGoogleClient(fetch: typeof globalThis.fetch, cfg: { clientId: string; clientSecret: string; redirectUri: string }): GoogleClient;
export function fakeGoogle(over?: Partial<GoogleClient>): GoogleClient & { calls: string[] }; // in test/fake-google.ts
```
`authUrl` always sets `access_type=offline`, `include_granted_scopes=false`, `code_challenge_method=S256`, `prompt=consent` (+ ` select_account` when `chooseAccount`). `hiddenSubscriberCount: true` → `subscriberCount: null`. Token endpoint `error: 'invalid_grant'` → `{ kind: 'revoked' }`. ID token claims are read from the token endpoint response (received directly over TLS from Google, so no signature check is needed — Google's OpenID docs allow this; cite the doc URL in a code comment after checking it).

- [ ] **Step 1: Failing tests** (fake `fetch` records requests): auth URL contains all sign-in + channel scopes and not the revenue scope unless `wantRevenue`; `prompt=consent select_account` when `chooseAccount`; `exchangeCode` posts `code`, `code_verifier`, `grant_type=authorization_code`, `redirect_uri` and parses `scope` (space separated) and id-token claims; missing `refresh_token` → `refreshToken: null`; `invalid_grant` → `revoked`; `myChannels` maps a sample `channels.list` response (write the sample from Google's documented response shape) and hidden subscriber counts to `null`; HTTP 500 → `{ kind:'failed', reason:'HTTP 500' }`; `revoke` swallows network errors.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(api): Google OAuth and channel client`.

### Task 4: Sessions and the Origin check

**Files:** Create `apps/api/src/session.ts`, `apps/api/test/session.test.ts`; modify `src/app.ts`.

**Interfaces:**
- Produces:
```ts
export const SESSION_COOKIE = 'vp_session';
export const SESSION_DAYS = 30;
export function createSession(c: Context, deps: Deps, userId: string): Promise<void>; // sets cookie, stores sha256(id)
export function readSession(c: Context, deps: Deps): Promise<{ userId: string } | null>; // null when missing/expired
export function clearSession(c: Context, deps: Deps): Promise<void>;
// app.ts middleware: POST/DELETE without Origin === config.appUrl → 403 "Request blocked (wrong origin)"
```

- [ ] **Step 1: Failing tests** — cookie flags (`HttpOnly`, `SameSite=Lax`, `Secure` only for https APP_URL); DB stores only the hash (raw cookie value absent from `sessions`); expired session → null and row deleted; POST without Origin → 403; POST with matching Origin passes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(api): sessions and origin check`.

### Task 5: Sign-in and OAuth callback

**Files:** Create `apps/api/src/routes/auth.ts`, `apps/api/src/views/{Layout,Message}.tsx`, `apps/api/test/auth.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces routes: `GET /auth/google/start?revenue=1&choose=1` → stores `oauth_states` row (state, PKCE verifier, current user id if signed in, want_revenue) → 302 to `google.authUrl`. `GET /auth/google/callback?state&code|error` → validates and deletes the state (single use, 10-minute expiry) → exchanges the code → checks scopes → upserts user by `idClaims.sub` (or keeps the signed-in user) → creates session → calls `myChannels` → stores one `pending_connections` row → 302 `/connect/confirm?id=<pending id>`. `POST /auth/logout`.

Messages (exact copy, rendered by `Message` with a "Start again" link to `/auth/google/start`):
- unknown/expired/reused state: "This link has expired. Please start again."
- `error=access_denied`: "You cancelled the Google sign-in. Nothing was connected."
- missing channel scope: "ViewProof needs permission to view your YouTube channel and its analytics. Please start again and keep both boxes ticked." (names which one is missing)
- no refresh token: "Google didn't give us lasting access. Please start again."
- `myChannels` returns `[]`: "This Google account has no YouTube channel. Pick the account that owns your channel."
- Google failure: "Google sign-in failed: <reason>."

- [ ] **Step 1: Failing tests** (fake Google): `start stores state and redirects` (Location host `accounts.google.com`; state row present); `new user is created and session set`; `existing user is reused`; `state is single use` (second callback with the same state → expired message); `expired state` (now + 11 min); `denied consent`; `missing youtube scope` (scopes lack `yt-analytics.readonly` → message names "analytics"; no pending row; Google `revoke` called); `no refresh token`; `account without a channel`; `revenue scope requested only when asked`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Refresh token is encrypted before insert; pending rows older than 1 hour are deleted on each callback. **Step 4:** PASS. **Step 5:** Commit `feat(api): Google sign-in and OAuth callback`.

### Task 6: "Is this the right channel?"

**Files:** Create `apps/api/src/routes/connect.ts`, `apps/api/src/views/ConfirmChannel.tsx`, `apps/api/test/connect.test.ts`

**Interfaces:**
- Produces: `GET /connect/confirm?id` (signed in, own pending row only; else 404 "Not found") renders D9 page: avatar, title, handle, "N subscribers" or "Subscriber count hidden", "N videos", channel id, the brand-name note, buttons. `POST /connect/confirm` (form `id`) → limit check → insert `channels` row (`status 'active'`, `last_verified_at` now) → delete pending → 302 `/account?connected=<channel id>`. `POST /connect/cancel` (form `id`) → revoke token, delete pending → 302 `/auth/google/start?choose=1` (keeps `revenue` choice).
- `maxChannels(plan: string, selfHosted: boolean): number` — free 1, pro 3, self-hosted `Infinity`.

- [ ] **Step 1: Failing tests** — `renders channel facts` (title, handle, `12,345 subscribers`, id, both buttons, the old-name note); `hidden subscriber count says so`; `other user's pending id is 404`; `confirm creates an active channel`; `confirm twice` (second POST → 302 to `/account`, still one row); `pick another forces the account chooser` (cancel → Location `/auth/google/start?choose=1`, then start → Google URL has `select_account`); `free plan limit` (second channel → "Your plan allows 1 channel. Remove one first or upgrade.", nothing stored, token revoked); `self-hosted has no limit`; `channel connected to another account` (refused with exact copy, token revoked).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(api): channel confirmation flow`.

### Task 7: Account page and channel status

**Files:** Create `apps/api/src/routes/account.ts`, `apps/api/src/views/Account.tsx`, `apps/api/test/account.test.ts`

**Interfaces:**
- Produces: `GET /account` (signed in, else 302 `/auth/google/start`) lists channels with status badge — Active / "Reconnect needed" (button "Reconnect" → `/auth/google/start?choose=1`) / "No longer exists" (button "Remove"); plan and "N of M channels"; Export and Delete account buttons. `POST /channels/:id/check` → decrypt token → `refresh` → `myChannels` → update `status`, `status_reason`, `last_verified_at`. `POST /channels/:id/remove` → revoke, delete. `GET /api/me` → `{ id, email, name, plan, maxChannels }`; `GET /api/channels` → `[{ id, channelId, title, handle, avatarUrl, status, statusReason, lastVerifiedAt }]` (401 JSON when signed out). Status rules: `revoked` → `'reconnect'`, reason "Google access was removed or expired"; channel list without this channel id → `'gone'`, reason "YouTube no longer returns this channel"; `failed` → status unchanged, reason "Check failed: <reason>".

- [ ] **Step 1: Failing tests** — `signed out redirects`; `lists channels with statuses`; `invalid_grant marks reconnect`; `empty channel list marks gone`; `transient failure keeps status`; `remove revokes and deletes`; `cannot touch another user's channel` (404); `api/channels never includes tokens` (response text has no `refresh_token_enc` value and no `v1.`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(api): account page and channel status`.

### Task 8: Export and delete

**Files:** Modify `apps/api/src/routes/account.ts`; create `apps/api/test/privacy.test.ts`

**Interfaces:**
- Produces: `GET /account/export` → `Content-Disposition: attachment; filename="viewproof-export.json"`, body `{ exportedAt, user: {email,name,plan,createdAt}, channels: [{channelId,title,handle,status,connectedAt,lastVerifiedAt,scopes}] }`. `POST /account/delete` (form field `confirm` must equal `delete`) → revoke every channel token, delete the user (cascades), clear cookie, render "Your account and all its data were deleted."

- [ ] **Step 1: Failing tests** — `export has no tokens` (no `refresh`, no `v1.` boxes, no session hashes); `delete without confirmation does nothing`; `delete revokes every token and removes all rows` (users, sessions, channels, pending for that user all empty; another user's rows untouched).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(api): data export and account deletion`.

### Task 9: Run it locally, docs, owner's live check

**Files:** Modify `README.md`, `apps/api/package.json` (scripts `dev`, `db:migrate:local`); create `apps/api/README.md`.

- [ ] **Step 1:** Scripts: `dev` = `wrangler dev --port 8787`, `db:migrate:local` = `wrangler d1 migrations apply viewproof --local`. A plain home page at `/` with "Sign in with Google" (links to start) and "Account" when signed in.
- [ ] **Step 2:** Docs: self-host steps (create Google OAuth client, redirect URI `http://localhost:8787/auth/google/callback`, copy `.dev.vars.example` → `.dev.vars`, generate `TOKEN_KEY`, migrate, `pnpm --filter api dev`); what is stored and how to delete it; note that in Testing status Google makes testers reconnect every 7 days, and that publishing the app while unverified avoids this (users see Google's "unverified app" warning; 100-user lifetime cap per project).
- [ ] **Step 3:** Run `pnpm test && pnpm typecheck`; all pass. Start `pnpm --filter api dev`; `curl localhost:8787/health` → `{"ok":true}`; `curl -I localhost:8787/auth/google/start` → 302 to `accounts.google.com` with the client id from `.dev.vars`.
- [ ] **Step 4: Owner's live check (by hand, owner's browser):** sign in with the personal account → confirmation page shows the right channel (or use "Pick another") → Yes, connect → account page shows it Active → "Check" keeps it Active → Export downloads JSON without tokens → Remove → gone from the list and from myaccount.google.com → Third-party connections. Record the result in the ledger.
- [ ] **Step 5:** Commit `docs(api): local setup and self-host guide`.
