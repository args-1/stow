# Linkstash — Cross-Platform Bookmark & Link Manager — Design

Date: 2026-11-24
Status: Approved

## 1. Goal

Save, organize, and access links across web, mobile (installable PWA on Android/iOS), and desktop
browsers (Chrome/Chromium MV3 + Firefox extension). Links saved in the extension appear in the PWA and
vice versa via Supabase cloud sync.

## 2. Confirmed decisions

| Topic | Decision |
|---|---|
| Backend | Supabase hosted project (Postgres + Auth + Realtime + one Edge Function) |
| Auth | Email + password in both PWA and extension |
| Offline (PWA) | Offline read + queued writes (outbox), last-write-wins |
| Offline (extension) | Online-only; shows inline error when offline |
| Organization | Flat, color-coded categories (0..1 per link) + free-form tags |
| Stack | pnpm workspaces, TypeScript, Vite + React + Tailwind PWA, WXT extension |
| Location | This directory, new git repo |
| Verification | Unit tests with fakes + live smoke test against the user's Supabase project |

## 3. Repository structure

```
linkstash/ (repo root)
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json
├─ packages/
│  ├─ core/                      # pure TS; no DOM, no React
│  │  └─ src/
│  │     ├─ schema.ts            # TS types: Link, Category, Mutation, OutboxEntry, CATEGORY_COLORS
│  │     ├─ model.ts             # zod input schemas, createLink/updateLink, tags, categories
│  │     ├─ url.ts               # normalizeUrl, dedupeKey, hostname, faviconFallback
│  │     ├─ query.ts             # queryLinks (search/category/view + sort), findByUrl
│  │     ├─ remote.ts            # Remote interface + RemoteError
│  │     ├─ supabase-remote.ts   # SupabaseRemote implementation
│  │     ├─ local.ts             # LocalStore interface + MemoryLocalStore (tests)
│  │     ├─ sync.ts              # SyncEngine(local, remote)
│  │     ├─ supabase.ts          # createLinkstashClient(url, publishableKey, storageAdapter?)
│  │     └─ metadata-client.ts   # fetchMetadata via the Edge Function
│  └─ ui/                        # shared React components (Tailwind classes)
│     └─ src/ LinkForm (incl. comma-separated tags field), CategoryPicker, ColorDot, AuthForm
├─ apps/
│  ├─ web/                       # PWA (.env / .env.example: VITE_*)
│  │  └─ src/ db.ts (Dexie LocalStore), sync/, components/, sw via vite-plugin-pwa
│  └─ extension/                 # WXT (.env / .env.example: WXT_*)
│     └─ entrypoints/ popup/, background.ts
└─ supabase/
   ├─ migrations/0001_init.sql
   └─ functions/
      ├─ _shared/metadata.ts     # parseHtmlMetadata — dependency-free so the Edge bundler includes it
      └─ fetch-metadata/index.ts
```

Unit boundaries:
- `SyncEngine` depends only on `LocalStore` and `Remote` interfaces. The PWA supplies a Dexie
  `LocalStore`; tests supply `MemoryLocalStore` and a fake `Remote`.
- `query.ts`, `url.ts`, and `supabase/functions/_shared/metadata.ts` are pure functions.
- The extension uses `SupabaseRemote` directly (no local store, no outbox).

## 4. Data model (Postgres)

### `categories`
| column | type | notes |
|---|---|---|
| id | uuid PK | client-generated (`crypto.randomUUID()`) |
| user_id | uuid | `references auth.users on delete cascade`, default `auth.uid()` |
| name | text | 1–50 chars |
| color | text | `#RRGGBB` |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | set by trigger on every insert/update |
| deleted_at | timestamptz null | soft delete (tombstone) |

### `links`
| column | type | notes |
|---|---|---|
| id | uuid PK | client-generated |
| user_id | uuid | as above |
| url | text | normalized (http/https only) |
| url_key | text | `dedupeKey(url)`, computed by clients; used for duplicate lookup |
| title | text | fetched page title (fallback: hostname) |
| custom_title | text null | user override; display title = custom_title ?? title |
| description | text null | meta/og description |
| favicon_url | text null | |
| notes | text null | |
| tags | text[] | default `{}`; lowercase, trimmed, unique |
| category_id | uuid null | references categories(id) on delete set null |
| is_favorite | bool | default false |
| is_archived | bool | default false |
| visit_count | int | default 0 |
| last_visited_at | timestamptz null | |
| created_at, updated_at, deleted_at | timestamptz | as above |

Server-side objects:
- RLS on both tables: select/insert/update/delete only where `user_id = auth.uid()`.
- Trigger `set_updated_at` (before insert/update) sets `updated_at = now()`.
- Trigger on `categories`: when `deleted_at` becomes non-null, set `category_id = null` on that user's links.
- RPC `increment_visit(link_id uuid)` (security invoker): `visit_count += 1`, `last_visited_at = now()`.
- Both tables added to the `supabase_realtime` publication.
- Indexes: `(user_id, updated_at)` on both tables; `(user_id, url_key) where deleted_at is null` on links.

Duplicates: no DB uniqueness constraint. Clients compute `dedupeKey(url)` (scheme ignored; lowercase
host, strip `www.`, trailing slashes, fragment, and `utm_*`/`fbclid`/`gclid`/`mc_cid`/`mc_eid`
params) and store it as `url_key`. The PWA checks its local store; the extension queries
`url_key` on the server. On match, the UI opens the existing link instead of creating a new one.

## 5. Sync (PWA)

- Local store: Dexie tables `links`, `categories`, `outbox`, `meta` (pull cursor).
- Write path: UI mutation → write row to Dexie (UI updates immediately via live query) → append
  `Mutation` to outbox → `SyncEngine.flush()`.
- Mutation kinds: `upsertLink`, `upsertCategory` (full row), `visit` (link id). Deletes are upserts
  with `deleted_at` set.
- Flush: replay outbox in order; remove each entry on success. On network failure stop and retry with
  exponential backoff (1s → 60s cap). On non-retryable error (4xx other than 401/408/429) drop the
  entry and surface a toast. On 401 try `auth.refreshSession()`; if that fails, sign out locally
  (`signOut({ scope: 'local' })`) and show the sign-in screen, keeping Dexie data and the outbox.
- Pull: `select * from X where updated_at > cursor - 5s order by updated_at` (tombstones included),
  merged into Dexie. A pulled row overwrites local unless a pending outbox mutation exists for the
  same id (local pending change wins until pushed; the server then applies last-write-wins by arrival).
  Cursor = max pulled `updated_at`.
- Triggers: app start, sign-in, window focus, `online` event, Realtime change event, 60s interval.
- Dexie stores its owner user id in `meta`. Explicit sign-out clears Dexie; signing in as a different
  user than the stored owner also clears it first (prevents data leaking between accounts).

## 6. Metadata fetching

- Extension: reads `tab.title`, `tab.url`, `tab.favIconUrl`; runs `scripting.executeScript` to read
  `meta[name=description]` / `og:description`. Restricted pages (`chrome://`, store pages) fall back
  to tab fields only.
- PWA: calls Edge Function `fetch-metadata` (`POST {url}`, requires auth JWT) which fetches the page
  (5s timeout, 1 MB cap, http/https only), parses with `parseHtmlMetadata`, and returns
  `{title, description, faviconUrl}`. If the function is unavailable, fallback: title = hostname,
  favicon = `https://www.google.com/s2/favicons?domain=<host>&sz=64`.
- Save is never blocked by metadata; the link is saved first, metadata is patched in when it arrives.

## 7. PWA UX

- Mobile-first layout: top search bar (instant, client-side over title/custom title/url/description/
  notes/tags), horizontally scrollable category chips, sort menu (Newest, Oldest, A–Z, Most visited),
  view tabs (All / Favorites / Archive). Desktop (≥ md): left sidebar with views + categories.
- Link card: favicon, display title, hostname, tags, category dot; actions: open (increments visit),
  favorite, archive/unarchive, edit, delete (with undo toast).
- Add/edit: floating "+" button (mobile) / header button (desktop) opens a sheet with URL, custom
  title, category, tags, notes.
- Category manager: create, rename, recolor (palette of 10 colors), delete (links become uncategorized).
- Status: badge for offline and pending outbox count; non-blocking toast on sync errors.
- Theme: dark/light via `prefers-color-scheme`.
- Auth screen: email + password sign in / sign up.

PWA configuration (`vite-plugin-pwa`, `generateSW`):
- Manifest: name, short_name, start_url `/`, display `standalone`, theme/background colors, icons
  192/512 + maskable 512, `share_target` (GET `/share?title&text&url`) for Android share sheet.
- iOS: `apple-touch-icon`, `apple-mobile-web-app-capable`, status-bar meta tags.
- Precache app shell; runtime CacheFirst for favicon images; SPA navigation fallback to `index.html`.
- Saved links readable offline from IndexedDB.

## 8. Browser extension

- WXT, React popup reusing `packages/ui`. Targets: `chrome-mv3` and `firefox-mv3` (Firefox ≥ 115).
- Permissions: `activeTab`, `scripting`, `contextMenus`, `storage`. No host permissions: the Supabase
  API sends CORS headers, so extension pages can call it directly.
- Popup: sign-in form if no session. Otherwise prefilled form (title, URL, favicon, description),
  category select, tags, notes, Save. If the URL's dedupe key already exists, show "Saved ✓" with
  edit/favorite/delete options instead.
- Context menus: "Save link to Linkstash" (on links), "Save page to Linkstash" (on page). Background
  saves without a category and flashes a ✓/✕ badge on the action icon.
- Keyboard shortcut: `Alt+Shift+S` opens the popup.
- Auth session persisted in `chrome.storage.local` via a supabase-js storage adapter.
- Supabase URL / publishable key injected at build time from `apps/extension/.env` (`WXT_SUPABASE_URL`,
  `WXT_SUPABASE_PUBLISHABLE_KEY`, optional `WXT_APP_URL` for the "Open Linkstash" link).

## 9. Configuration

Per-app `.env` files (gitignored), each mirrored by a committed `.env.example`:
```
# apps/web/.env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...

# apps/extension/.env
WXT_SUPABASE_URL=...
WXT_SUPABASE_PUBLISHABLE_KEY=...
WXT_APP_URL=http://localhost:5173   # optional
```
The live smoke test reads `SMOKE_EMAIL` / `SMOKE_PASSWORD` (and optional `SMOKE_EDGE=1`) from
`apps/web/.env.local`.

Setup: create Supabase project → run `supabase/migrations/0001_init.sql` in SQL editor → (optional)
`npx supabase@3 login` then `npx supabase@3 functions deploy fetch-metadata --remote=<project-ref> --use-api
--no-verify-jwt` (the function checks the user's token itself; the gateway JWT check would block the CORS
preflight) → disable "Confirm email" for quick local testing (optional) → fill both `.env` files.

## 10. Error handling

- All inputs validated with zod in `core` (URL must be http/https; name lengths; color hex).
- Network/sync errors: outbox retains mutations; backoff retry; toast on persistent failure.
- Auth expiry → refresh attempt, then sign-in screen (local data kept). Extension shows inline errors
  (offline, auth, validation).

## 11. Testing

- Vitest (core): `url` normalization/dedupe, `query` filter/sort, `_shared/metadata` HTML parsing
  (test file lives in core, imports the Edge Function's shared module),
  `SyncEngine` (outbox ordering, retry on failure, pull merge, tombstones, pending-local-wins, cursor).
- Vitest + React Testing Library (web): link list filtering/sorting renders; add-link flow writes to
  outbox (fake store).
- Build checks: web build emits `manifest.webmanifest` + `sw.js`; extension builds for chrome-mv3 and
  firefox-mv3 succeed.
- Live smoke test (manual script) against the user's Supabase project: sign up, create category, save
  link via `SupabaseRemote`, pull it back.

## 12. Documentation deliverable

`README.md` with: stack overview, structure, Supabase setup, `.env`, running dev servers, tests,
building, testing PWA installability (desktop Chrome via `pnpm --filter @linkstash/web preview` on localhost; Android/iOS via
HTTPS deploy or tunnel, e.g. `npx cloudflared tunnel --url http://localhost:4173`), and loading the
extension unpacked in Chrome (`chrome://extensions` → Developer mode → Load unpacked
`apps/extension/.output/chrome-mv3`) and Firefox (`about:debugging` → Load Temporary Add-on →
`apps/extension/.output/firefox-mv3/manifest.json`).

## 13. Out of scope (YAGNI)

Nested folders, sharing/collaboration, full-text page archiving, import/export of browser bookmarks,
OAuth/magic link, offline writes in the extension, Safari extension.
