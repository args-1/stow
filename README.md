# Stow

Save, organize and find your links on every device. Stow is an installable web app (PWA) that works offline, plus a browser extension for Chrome and Firefox. Both sync through your own Supabase project.

## Features

- **Save links** with an optional custom title, notes, tags and category. Stow fetches the page title, description and favicon for you.
- **Edit, favorite, archive and delete** links. Deleting shows an **Undo** button.
- **Categories:** create, rename, recolor and delete color-coded categories. Links in a deleted category become uncategorized.
- **Find links fast:** search matches titles, URLs, descriptions, notes and tags as you type. A leading `#` is ignored, so `#recipes` finds links tagged `recipes`. Switch between All, Favorites and Archive, filter by category, and sort by Newest, Oldest, A–Z or Most visited. Opening a link counts as a visit.
- **Installable and offline:** install the web app on Android, iOS or desktop. Saved links open offline, and changes made offline sync when you reconnect.
- **Share to Stow** on Android: the installed app appears in the share sheet.
- **Browser extension** for Chrome, Edge and other Chromium browsers, and Firefox 115+:
  - Click the toolbar button, or press `Alt+Shift+S`, to save the current page with a category, tags and notes. If the page is already saved, the popup says so and lets you favorite, edit or delete it.
  - Right-click a link or a page and choose **Save link to Stow** or **Save page to Stow**.
- **Sync:** sign in with email and password. While online, changes reach your other devices within seconds.

## Tech stack

| Part | Built with |
| --- | --- |
| Language | TypeScript (strict) |
| Monorepo | pnpm workspaces |
| Web app | React 19, Vite, Tailwind CSS 4, Dexie (IndexedDB), vite-plugin-pwa (Workbox) |
| Extension | WXT (Manifest V3 for Chrome and Firefox), React 19 |
| Shared code | `@stow/core`: types, zod validation, search and sorting, the sync engine, Supabase access. `@stow/ui`: the link form, sign-in form and category picker. |
| Backend | Supabase: Postgres with row-level security, email + password auth, Realtime, one Edge Function (Deno) |
| Tests | Vitest, Testing Library, fake-indexeddb, PGlite (runs the real SQL migration in memory) |

## How sync works

The web app keeps a full copy of your links and categories in IndexedDB. Every change is written there first and added to an outbox, so the app responds at once and works offline. A sync engine sends the outbox to Supabase in order, then pulls whatever changed on the server since the last sync. It runs when you sign in or open the app, every minute, when the window regains focus or the connection comes back, and right after each change. Supabase Realtime also tells the app as soon as another device changes something. If the same link is edited in two places, the edit that reaches the server last wins. Deleted links and categories are kept as markers, so deletes sync too.

The extension keeps no local copy. It reads and writes Supabase directly, so it needs a connection. The web app picks up its changes through Realtime or the next sync.

Row-level security in Postgres means each account can only see its own links and categories. Signing out of the web app removes the local copy from that browser; if some changes have not synced yet, Stow asks first. If the session expires instead and a different account then signs in on that browser, the previous account's unsynced changes are discarded, and Stow says how many.

## Project structure

```text
apps/
  web/                         the PWA: Vite + React + Tailwind, Dexie local store, service worker
  extension/                   the browser extension: WXT popup and background worker
packages/
  core/                        shared types, validation, search, sync engine, Supabase access
  ui/                          React components shared by both apps
supabase/
  migrations/0001_init.sql     tables, row-level security, triggers, Realtime setup
  functions/fetch-metadata/    Edge Function that reads a page's title, description and favicon
docs/superpowers/              design spec and implementation plan
```

The packages ship TypeScript source with no build step of their own. Vite and WXT compile them into each app.

## Prerequisites

- Node.js 24.15 or newer, or Node.js 22.22.2 or newer on the 22 line.
- pnpm 11 or newer: `npm install -g pnpm@latest`.
- A Supabase account. The free plan is enough.
- Chrome, Edge or another Chromium browser, and/or Firefox 115 or newer.
- For phone testing: Android with Chrome, or iOS with Safari.

You don't need Docker, a local Supabase stack or a global Deno install.

## 1. Install

From the repository root:

```powershell
pnpm install
```

If pnpm reports ignored build scripts (for example `sharp`, which generates the app icons), run `pnpm approve-builds`, approve them, and run `pnpm install` again.

## 2. Supabase setup

1. Go to https://supabase.com/dashboard, create a project, and wait until it is ready.
2. Click **Connect** at the top of the project dashboard (or open **Project Settings → API Keys**) and copy:
   - the **Project URL**, which looks like `https://<project-ref>.supabase.co`. The `<project-ref>` part is your project ref.
   - the **publishable key**, which starts with `sb_publishable_`. A legacy `anon` key also works.

   Never use the secret key or the `service_role` key. They bypass row-level security.
3. Open **SQL Editor**, paste the whole of `supabase/migrations/0001_init.sql`, and click **Run**. It creates the tables, the row-level security policies, the triggers, the `increment_visit` function and the Realtime publication. Nothing else needs to be switched on.
4. Decide how new accounts are confirmed, under **Authentication → Sign In / Providers → Email**:
   - For local testing, turn off **Confirm email** and save. New accounts can sign in straight away.
   - To keep it on, set **Authentication → URL Configuration → Site URL** to where the web app runs, for example `http://localhost:5173`. After signing up, click the link in the email, then sign in to Stow with your email and password. Supabase's built-in email service only sends a few emails per hour.
5. Optional but recommended: deploy the `fetch-metadata` Edge Function. It fetches the title, description and favicon of links added in the web app. Without it, those links show their host name as the title, with a favicon from Google's favicon service. The extension reads the title and description from the open tab, so it works either way.

   ```powershell
   npx supabase@3 login
   npx supabase@3 functions deploy fetch-metadata --remote=<project-ref> --use-api --no-verify-jwt
   ```

   `login` opens a browser to authorize the CLI. Answer `y` when `deploy` asks you to confirm. `--use-api` bundles the function on Supabase's servers, so Docker is not needed. `--no-verify-jwt` is required: the function checks the signed-in user itself, and the gateway's own check would block the browser's CORS preflight request.

## 3. Configure the apps

Copy the example env files, then fill in the two values from [Supabase setup](#2-supabase-setup):

```powershell
Copy-Item apps/web/.env.example apps/web/.env
Copy-Item apps/extension/.env.example apps/extension/.env
```

On macOS or Linux, use `cp` instead of `Copy-Item`.

| File | Variable | Value |
| --- | --- | --- |
| `apps/web/.env` | `VITE_SUPABASE_URL` | Project URL |
| `apps/web/.env` | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (or legacy anon key) |
| `apps/extension/.env` | `WXT_SUPABASE_URL` | Project URL |
| `apps/extension/.env` | `WXT_SUPABASE_PUBLISHABLE_KEY` | Publishable key (or legacy anon key) |
| `apps/extension/.env` | `WXT_APP_URL` | Optional. Where the popup's **Open Stow** link goes. Defaults to `http://localhost:5173`. |

The values are compiled into the apps, so restart the dev server or build again after changing a `.env` file. The publishable key is meant to be public; row-level security protects the data. The `.env` files are gitignored. Don't commit them.

## 4. Run in development

```powershell
pnpm dev                                          # web app at http://localhost:5173
pnpm dev:ext                                      # extension in Chrome, with hot reload
pnpm --filter @stow/extension dev:firefox    # extension in Firefox, with hot reload
```

In the web app, choose **Need an account? Create one** to sign up. Passwords need at least 6 characters. Use the same account in the extension.

`pnpm dev:ext` builds the extension and starts a browser with it loaded. If no browser opens, build the extension and load it by hand as in [Load the browser extension](#9-load-the-browser-extension).

The service worker only exists in production builds. To test installing and offline mode, use the preview server described in [Install the PWA](#7-install-the-pwa).

## 5. Test

```powershell
pnpm test                                                       # unit and component tests in every package
pnpm typecheck                                                  # TypeScript in every package
npx -y deno check supabase/functions/fetch-metadata/index.ts    # the Edge Function
```

These need no Supabase project. The database tests run the real migration in PGlite, an in-memory Postgres.

### Live smoke test (optional)

The live test checks your real project: sign-in, row-level security, saving and reading links and categories, and the Edge Function. Create `apps/web/.env.local` with a dedicated test account:

```text
SMOKE_EMAIL=you+stow-smoke@example.com
SMOKE_PASSWORD=a-long-test-password
SMOKE_EDGE=1
```

Then run `pnpm test:live`. It uses the project in `apps/web/.env` and signs up the test account if it doesn't exist yet. With **Confirm email** on, confirm the address and run it again. The test deletes the links and categories it creates. Leave out `SMOKE_EDGE=1` if you haven't deployed the Edge Function; that test is then skipped.

## 6. Build

```powershell
pnpm build
```

| Output | Contents |
| --- | --- |
| `apps/web/dist/` | The PWA: static files, `manifest.webmanifest` and the `sw.js` service worker |
| `apps/extension/.output/chrome-mv3/` | The extension for Chrome, Edge and other Chromium browsers |
| `apps/extension/.output/firefox-mv3/` | The extension for Firefox |

Generating the service worker can take up to a minute. These build warnings are expected and harmless:

- The web build says some chunks are larger than 500 kB. The service worker caches the app, so it downloads once per version.
- The extension's popup chunk is larger than 500 kB. Extension files load from disk, so the size doesn't matter.
- Firefox asks for `data_collection_permissions`. This only matters when publishing on addons.mozilla.org; see [Troubleshooting](#troubleshooting).

`pnpm --filter @stow/web check:pwa` checks the web build. It prints `PWA check passed.` when the manifest, icons and service worker are in place.

The web app's icons in `apps/web/public/` are generated from `apps/web/public/logo.svg`. After changing the logo, run `pnpm --filter @stow/web icons` and commit the new files. The extension builds its icons from `apps/extension/assets/icon.svg` on every build.

## 7. Install the PWA

Browsers only offer to install a site that is served over HTTPS or from `localhost`.

### Desktop (Chrome or Edge)

```powershell
pnpm build
pnpm --filter @stow/web preview    # http://localhost:4173
```

1. Open http://localhost:4173 and sign in.
2. In DevTools → **Application**, **Manifest** shows Stow with its icons and no errors, and **Service workers** shows `sw.js` as activated.
3. Install the app with the install icon in the address bar, or with the install option in the browser menu. Stow opens in its own window.
4. Test offline mode: in DevTools → **Network**, set throttling to **Offline** and reload. Your links still show. Favorite a link: the header shows **Offline · 1 pending**. Set throttling back to **No throttling**; the badge disappears once the change has synced.

Stop the preview server with Ctrl+C.

### Android and iOS

A phone can't reach `localhost` on your computer, so serve the preview over HTTPS through a temporary Cloudflare tunnel. No Cloudflare account is needed.

```powershell
pnpm --filter @stow/web preview
# in a second terminal:
npx cloudflared tunnel --url http://localhost:4173
```

cloudflared prints an address like `https://<random-words>.trycloudflare.com`. Open it on your phone. (`apps/web/vite.config.ts` lists `.trycloudflare.com` under `preview.allowedHosts`. To use a different tunnel, add its host name there.)

- **Android (Chrome):** sign in, then tap **Install** when Chrome offers it, or use the **⋮** menu → **Add to Home screen** → **Install**. Once installed, Stow appears in the share sheet: share a page from any app, and Stow opens its add-link form with the URL filled in.
- **iOS (Safari):** sign in, then tap **Share** → **Add to Home Screen**. iOS has no share targets for web apps, so add links from inside the app.
- **Offline:** open the installed app once while online. Then turn on airplane mode and open it again. Your links still show, and changes you make sync when you reconnect.

Each tunnel gets a new address, and each address is a separate site with its own storage and its own installed app. Remove the test app from your phone when you are done. For everyday use, deploy the app.

## 8. Deploy the PWA

`apps/web/dist/` is a static site, so any static host with HTTPS works, for example Netlify, Cloudflare Pages or Vercel.

- **Build settings:** build command `pnpm install && pnpm --filter @stow/web build`, output directory `apps/web/dist`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the host's build environment.
- **Fallback to `index.html`:** serve `index.html` for paths that don't match a file, so the Android share link (`/share?…`) works on a first visit. On Netlify, add `apps/web/public/_redirects` containing `/* /index.html 200`. Cloudflare Pages does this by default. On other hosts, add a rewrite from every path to `/index.html`.
- **Own origin:** the app's `start_url` and `scope` are `/`, so serve it from the root of a domain or subdomain, not from a subfolder.
- **Supabase:** set **Authentication → URL Configuration → Site URL** to the deployed address.
- **Extension:** set `WXT_APP_URL` in `apps/extension/.env` to the deployed address and rebuild the extension, so **Open Stow** opens it.

## 9. Load the browser extension

Build it first with `pnpm build`, or `pnpm --filter @stow/extension build` for the extension alone.

### Chrome, Edge and other Chromium browsers

1. Open `chrome://extensions` (in Edge, `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the folder `apps/extension/.output/chrome-mv3`.
4. Pin Stow from the Extensions (puzzle-piece) menu so its button stays in the toolbar.

The extension stays installed when the browser restarts. After rebuilding, click the reload icon on its card in `chrome://extensions`.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose the file `apps/extension/.output/firefox-mv3/manifest.json`.

Firefox removes temporary add-ons when it restarts, so load it again after a restart. After rebuilding, click **Reload** on the add-on. To keep it installed for good, it has to be signed on addons.mozilla.org (it can be unlisted); see the `data_collection_permissions` entry in [Troubleshooting](#troubleshooting).

### Using the extension

- Click the Stow button, or press `Alt+Shift+S` (Option+Shift+S on macOS), and sign in with your Stow account.
- On a web page, the popup shows the page's favicon, title and description. Pick a category, add tags or notes, and click **Save page**. If the page is already saved, the popup shows **Saved to Stow** with buttons to favorite, edit or delete it.
- Right-click a link and choose **Save link to Stow**, or right-click a page and choose **Save page to Stow**. These save without a category. The toolbar icon shows a green ✓ when the link is saved or a red ✕ when saving fails; hover over the icon to see the reason.
- **Open Stow** in the popup opens the web app.
- To change the shortcut, open `chrome://extensions/shortcuts`, or in Firefox `about:addons` → ⚙ → **Manage Extension Shortcuts**.
- To debug, open the background worker's console: in Chrome, click **service worker** on the Stow card in `chrome://extensions`; in Firefox, click **Inspect** on the add-on in `about:debugging`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The app or the popup says **Connect Stow to Supabase** | The `.env` file is missing or incomplete; see [Configure the apps](#3-configure-the-apps). Restart `pnpm dev`, or build again, after editing it. |
| Sign-up says "Check your email to confirm your account, then sign in." | Click the link in the email, then sign in. Or turn off **Confirm email** (Supabase setup, item 4). |
| "Invalid API key", or every request fails with 401 | The key is wrong or comes from a different project than the URL. Use the publishable key, or the legacy anon key, from the same project. |
| pnpm warns about ignored build scripts | Run `pnpm approve-builds`, approve them, then run `pnpm install`. |
| Links added in the web app only show the host name | The `fetch-metadata` Edge Function isn't deployed (Supabase setup, item 5). If it is, look in the dashboard under **Edge Functions → fetch-metadata → Logs**. If the function returns 401, it was deployed without `--no-verify-jwt`; deploy it again with the flag. Some sites block automated requests, so a few links never get a title. |
| A change doesn't show up on another device | Look at the badge in the header. **N pending** means the change hasn't reached the server yet; it syncs once the device is online. Switching back to the app also starts a sync. |
| `vite preview` answers "Blocked request. This host is not allowed." | Add the tunnel's host name to `preview.allowedHosts` in `apps/web/vite.config.ts`. |
| The popup says "Stow can only save web pages (http and https)." | Browser pages such as `chrome://…` and `about:…` can't be saved. |
| A context-menu save shows a red ✕ | Hover over the icon to see the reason. Usually you are signed out: open the popup and sign in. |
| The Firefox build warns about `data_collection_permissions` | Only add-ons published on addons.mozilla.org need it. Before publishing, change the gecko id `stow@example.com` in `apps/extension/wxt.config.ts` to an id you own, and declare the data the add-on sends to Supabase under `browser_specific_settings.gecko.data_collection_permissions`: most likely `browsingActivity`, `websiteContent`, `personallyIdentifyingInfo` and `authenticationInfo` as `required`. Run `pnpm typecheck` afterwards, because WXT's types may not know this key yet. Firefox shows the consent prompt from version 140. See [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/). |

## Limitations

- The extension needs a connection. It doesn't queue saves while offline.
- Saving the same URL on two devices that are both offline can create a duplicate. Delete one of them.
- iOS has no share target for web apps.
- Links without a favicon of their own show one from Google's favicon service (`faviconFallback` in `packages/core/src/url.ts`). The browser sends the host name of each of those links to Google, intranet hosts included.
- The `fetch-metadata` Edge Function refuses private and local addresses, but it only checks the host name or IP written in the URL. It doesn't resolve DNS, so it has no protection against a public name that points at a private address, or against DNS rebinding.
- Not included: nested folders, sharing between accounts, saving page contents, importing or exporting browser bookmarks, OAuth or magic-link sign-in, and a Safari extension.
