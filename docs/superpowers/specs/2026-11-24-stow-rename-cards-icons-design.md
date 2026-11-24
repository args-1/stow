# Stow: rename, square link cards, category icons

**Date:** 2026-11-24
**Branch:** `feat/stow`, created from `feat/linkstash` at `6d09119`
**Builds on:** `docs/superpowers/specs/2026-11-24-linkstash-design.md`. Everything in that spec still holds unless this document changes it.

## Goals

1. Rename the product from Linkstash to **Stow**, in both visible branding and internal identifiers. Keep each user's local data and sessions.
2. Show saved links as **square cards** in a responsive grid.
3. Give every category an **icon** from a curated set, drawn in the category's colour, replacing the generic colour dot everywhere.

## Non-goals

- Renaming the repository folder, or rewriting the original spec and plan (they are history).
- Emoji or user-uploaded icons, or icons on tags or links.
- A custom dropdown component. Native `<select>` stays.
- Showing descriptions or tags on cards. Search still matches them.

---

## 1. Rename

### 1.1 Visible branding

Every user-facing "Linkstash" becomes "Stow":

| Where | New text |
|---|---|
| `apps/web/vite.config.ts` PWA manifest | `name: 'Stow'`, `short_name: 'Stow'` |
| `apps/web/index.html` | `<title>Stow</title>`, `apple-mobile-web-app-title` = `Stow` |
| `apps/web/src/Library.tsx` brand | `Stow` |
| `apps/web/src/components/AuthScreen.tsx` | `Stow` |
| `apps/web/src/components/SetupNotice.tsx` | `Connect Stow to Supabase` |
| `packages/ui/src/AuthForm.tsx` default title | `Sign in to Stow` |
| `apps/extension/wxt.config.ts` | `name: 'Stow'`, `description: 'Save the current page or any link to your Stow library.'` |
| `apps/extension/entrypoints/popup/index.html` | `<title>Stow</title>` |
| `apps/extension/entrypoints/popup/App.tsx` | `Connect Stow to Supabase`, `Stow`, `Open Stow` |
| `apps/extension/entrypoints/popup/SaveScreen.tsx` | `Stow can only save web pages (http and https).`, `Removed from Stow.`, `Saved to Stow` |
| `apps/extension/entrypoints/background.ts` | action title `Stow`; menu titles `Save link to Stow`, `Save page to Stow` |
| `apps/extension/lib/context-menu.ts` | `Sign in from the Stow toolbar button, then try again.`, `This Stow build has no Supabase settings. See the README.`, `Already in Stow`, `Saved to Stow` |
| `apps/extension/lib/save.ts` | `Can't reach Stow. Check your connection and try again.` |
| `apps/extension/lib/config.ts` comment | `Open Stow` |
| `supabase/functions/fetch-metadata/handler.ts` | `User-Agent: Mozilla/5.0 (compatible; StowBot/1.0)` |
| `supabase/migrations/0001_init.sql` line 1 comment | `-- Stow schema. …` (comment only; the schema is unchanged) |
| `README.md` | Product name throughout |

Tests that assert these strings are updated to match.

### 1.2 Internal identifiers

| Old | New |
|---|---|
| `@linkstash/core`, `@linkstash/ui`, `@linkstash/web`, `@linkstash/extension` (package names, imports, `workspace:*` deps, root script filters) | `@stow/core`, `@stow/ui`, `@stow/web`, `@stow/extension` |
| `createLinkstashClient` | `createStowClient` |
| `LinkstashDb` | `StowDb` |
| Dexie database `linkstash` | `stow` (constant `DB_NAME`) |
| Test databases `linkstash-test-N` | `stow-test-N` |
| `SYNC_LOCK_NAME = 'linkstash-sync'` | `'stow-sync'` |
| Realtime channel `linkstash:${userId}:${n}` | `stow:${userId}:${n}` |
| Context-menu ids `linkstash-save-link`, `linkstash-save-page` | `stow-save-link`, `stow-save-page` |
| Firefox add-on id `linkstash@example.com` | `stow@example.com` |
| Live-test URL `https://example.com/linkstash-smoke/…` | `https://example.com/stow-smoke/…` |

`pnpm install` regenerates `pnpm-lock.yaml` for the new package names.

**Acceptance check:** `git grep -i linkstash` finds matches only in:
- the original spec and plan;
- this spec and its plan;
- `LEGACY_DB_NAME` and its tests in `apps/web/src/db.ts` / `db.test.ts`;
- the README's "Upgrading from Linkstash" section.

### 1.3 Keeping local data: importing the legacy database

The web app's local data (links, categories, the outbox of unsynced changes, the account owner and the sync cursors) lives in the IndexedDB database `linkstash`. After the rename the app opens `stow`, and a one-time import copies the old data across.

`apps/web/src/db.ts`:

```ts
export const DB_NAME = 'stow';
export const LEGACY_DB_NAME = 'linkstash';

export function openDb(name = DB_NAME, legacyName: string | null = name === DB_NAME ? LEGACY_DB_NAME : null): StowDb
```

- When `legacyName` is set, `openDb` registers `db.on('ready', (vipDb) => importLegacyDb(vipDb as StowDb, legacyName))`. Dexie holds back every other request on `db` until the promise this returns settles, so the app never reads `stow` before the import finishes.
- The import must use the `vipDb` argument, which has exclusive access during the hook. A query through `db` itself would wait for the hook and deadlock.
- Test databases (`stow-test-N`) get `legacyName = null` and never import.

`importLegacyDb(db, legacyName)`:

1. If `!(await Dexie.exists(legacyName))`, return.
2. Open the legacy database with the same version-1 schema (`openDb(legacyName, null)`).
3. Read `links`, `categories`, `outbox` (ordered by `seq`) and `meta`, then close the legacy database.
4. If the legacy database has any rows, run one `rw` transaction over every table of `db`:
   - If any table of `db` already has rows, copy nothing. The import already happened, or this device has used Stow.
   - Otherwise `bulkAdd`:
     - links as-is;
     - categories with `icon: row.icon ?? DEFAULT_CATEGORY_ICON`;
     - outbox entries with their **original `seq`** (keeps push order), where `upsertCategory` rows get the same icon default;
     - meta rows as-is (owner, `cursor:links`, `cursor:categories`).
5. If rows were copied, or the legacy database was empty, start `Dexie.delete(legacyName)` **without awaiting it**. Log and ignore any failure. A tab still running the old build can block the delete, and that must never stall start-up. If `stow` already had data, leave the legacy database alone.
6. If the import throws, opening `db` fails. The existing error screen shows its Reload button. Nothing was committed, so the import runs again on reload.

Concurrent tabs are safe. The emptiness check and the copy are one transaction, so a second tab finds `stow` non-empty and copies nothing.

### 1.4 Sessions and the extension

- **Web:** supabase-js keeps the session under `sb-<project-ref>-auth-token`, which the rename doesn't touch, so users stay signed in.
- **Chrome/Edge:** an unpacked extension's id comes from its folder path, so reloading from the same build folder keeps the stored session. The `onInstalled` handler already calls `contextMenus.removeAll()`, so the old menu ids disappear on update.
- **Firefox:** the new add-on id makes this a different add-on. Remove the old temporary add-on, load the new one and sign in once. The README says so.

---

## 2. Category icons: data and sync

### 2.1 Migration `supabase/migrations/0002_category_icons.sql`

```sql
-- Stow: category icons. Run once, after 0001_init.sql and before using a build with category icons.
alter table public.categories
  add column icon text not null default 'folder'
  constraint categories_icon_format check (icon ~ '^[a-z0-9-]{1,40}$');
```

- Existing rows get `folder`.
- `ALTER TABLE` fires no row triggers, so `updated_at` does not move and other devices are not forced to re-pull. Their local rows either got `folder` through the import (§1.3) or show as `folder` through the fallback (§2.4).
- The database checks only the format. The curated list is enforced by the app, so new icons never need a migration and unknown names never break older clients.

### 2.2 Core model (`@stow/core`)

`schema.ts`:

```ts
export interface Category {
  id: string;
  user_id?: string;
  name: string;
  color: string;
  /** A CATEGORY_ICONS name. Rows from other builds may hold names this build doesn't know; render with categoryIconName(). */
  icon: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const CATEGORY_ICONS = [
  'folder', 'briefcase', 'house', 'book-open', 'graduation-cap', 'code', 'terminal', 'newspaper',
  'video', 'film', 'music', 'image', 'camera', 'gamepad-2', 'shopping-cart', 'wallet',
  'plane', 'map-pin', 'car', 'utensils', 'coffee', 'heart', 'star', 'bookmark',
  'lightbulb', 'wrench', 'palette', 'pen-tool', 'globe', 'users', 'message-circle', 'mail',
  'calendar', 'file-text', 'archive', 'tag', 'flag', 'rocket', 'dumbbell', 'leaf',
] as const;
export type CategoryIconName = (typeof CATEGORY_ICONS)[number];
export const DEFAULT_CATEGORY_ICON: CategoryIconName = 'folder';
export function isCategoryIcon(value: unknown): value is CategoryIconName;
/** The icon to draw or edit: `value` when it is a known name, otherwise DEFAULT_CATEGORY_ICON. */
export function categoryIconName(value: unknown): CategoryIconName;
```

All 40 names were checked against the installed `lucide-react@1.78.0` exports.

`model.ts`:

- `CategoryInput` becomes `{ name: string; color: string; icon: string }`.
- `parseCategoryInput` checks that `icon` is in `CATEGORY_ICONS`, with the error **"Pick an icon"**. Name and colour errors are reported first, as today.
- `createCategory(input)` copies `input.icon`.
- `CategoryPatch` = `Partial<Pick<Category, 'name' | 'color' | 'icon' | 'deleted_at'>>`.

`supabase-remote.ts`:

- `categoryPayload` adds `icon: row.icon ?? DEFAULT_CATEGORY_ICON`. A known-format name this build doesn't recognise is sent unchanged.

`testing/factories.ts`:

- `makeCategory` defaults `icon: 'folder'`.

### 2.3 Error classification: app updated before the migration

If a build with icons pushes a category to a database without the `icon` column, PostgREST answers HTTP 400 with code `PGRST204` ("Could not find the 'icon' column … in the schema cache"). Today any non-retryable 4xx is fatal and the outbox entry is dropped, which would lose the change.

- `RemoteError` gains an optional third constructor argument and a readonly field `code?: string`.
- `run()` in `supabase-remote.ts` passes `result.error.code` through.
- `errorKind` returns `'retryable'` for `code === 'PGRST204'`, checked before the status rules.

The change then waits in the outbox, the usual retry/back-off applies, and it syncs once migration 0002 runs. The README's troubleshooting section names this case.

### 2.4 Rows without a valid icon

A pulled row can lack `icon` (the server is not migrated yet) or hold a name this build doesn't know. Every renderer and the edit form go through `categoryIconName()`, so such rows show and edit as `folder`. Only a save made from the edit form replaces the stored value.

---

## 3. Category icons: UI

### 3.1 `CategoryIcon` (`packages/ui/src/CategoryIcon.tsx`)

```ts
export interface CategoryIconOption { name: CategoryIconName; label: string; Icon: LucideIcon }
/** CATEGORY_ICONS in order, with each name's lucide component and an accessible label. */
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[];

export interface CategoryIconProps { icon: unknown; color: string; className?: string }
/** The category's icon drawn in its colour. Decorative (aria-hidden); always pair it with the category name. */
export function CategoryIcon({ icon, color, className = 'size-4' }: CategoryIconProps): JSX.Element;
```

- It renders the component for `categoryIconName(icon)` with `aria-hidden="true"`, `shrink-0` and `style={{ color }}`.
- Labels, in `CATEGORY_ICONS` order: Folder, Briefcase, House, Book, Graduation cap, Code, Terminal, Newspaper, Video, Film, Music, Image, Camera, Gamepad, Shopping cart, Wallet, Plane, Map pin, Car, Utensils, Coffee, Heart, Star, Bookmark, Lightbulb, Wrench, Palette, Pen, Globe, People, Chat, Mail, Calendar, Document, Archive, Tag, Flag, Rocket, Dumbbell, Leaf.
- `@stow/ui` gains the dependency `lucide-react` (same range as `apps/web`: `^1.78.0`).
- `ColorDot.tsx` is deleted and its export removed. All four users switch to `CategoryIcon`:
  - `FilterNav` (the sidebar and drawer category filters);
  - the `CategoryManager` list rows;
  - `LinkCard` (§4);
  - the extension's `SaveScreen` "Saved" view.

### 3.2 `IconPicker` (`apps/web/src/components/IconPicker.tsx`)

It mirrors `ColorPalette`:

```ts
export interface IconPickerProps { value: string; color: string; onChange(icon: CategoryIconName): void; label?: string }
```

- A `<fieldset>` with `<legend>` "Icon" (default), then a wrapping grid of the 40 options.
- Each option is a visually hidden radio with `aria-label` set to the option label, plus a 36 px tile showing the icon in `color`.
- The checked tile gets a ring and focus shows a focus ring, the same as `ColorPalette`.

`CategoryManager`'s `CategoryForm`:

- gains `icon` state, initialised from `categoryIconName(initial.icon)`;
- renders `IconPicker` after `ColorPalette`, previewed in the selected colour;
- submits `{ name, color, icon }`.
- The add form starts on `DEFAULT_CATEGORY_ICON` and resets to it after each add.
- The edit form starts on the category's current icon.

### 3.3 Category select (`packages/ui/src/CategoryPicker.tsx`)

Native `<option>`s can't hold SVG, so options stay text-only.

- The `<select>` is wrapped in a `relative` container.
- When a category is selected, its `CategoryIcon` sits absolutely positioned at the select's left edge (`pointer-events-none`, vertically centred), and the select gets left padding so text clears the icon.
- "No category" shows no icon and normal padding.

---

## 4. Square link cards

### 4.1 Grid (`LinkList.tsx`, `Library.tsx`)

- The `<ul aria-label="Links">` becomes `grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3`.
- With the library's 16 px side padding that gives:
  - 1 column below ~348 px viewport width;
  - 2 on typical phones;
  - about 3 on tablets;
  - up to 6 on wide screens.
- `Library.tsx` widens the header inner container and `<main>` from `max-w-3xl` to `max-w-6xl`, so 6 columns fit beside the 15 rem sidebar.
- The empty-state messages are unchanged.

### 4.2 Card (`LinkCard.tsx`)

The `<li>` is `relative flex aspect-square flex-col gap-2 overflow-hidden rounded-xl border p-2.5 shadow-sm`, keeping today's colours and dark-mode classes. Top to bottom:

1. **Header row** (`flex items-center gap-1.5 text-xs`):
   - the favicon at 24 px, with today's fallback and `onError` behaviour;
   - the hostname (`min-w-0 flex-1 truncate`);
   - when the link has an active category, its `CategoryIcon` in a wrapper with `role="img"`, `aria-label="Category: {name}"`, `title="{name}"` and `relative z-10`, so its tooltip still works.
2. **Title:** the existing `<a>` (`target="_blank"`, `rel="noopener noreferrer"`, `onClick`/`onAuxClick` visit counting unchanged), styled `line-clamp-3 text-sm font-medium`.
   - It is a **stretched link**: `after:absolute after:inset-0`, so tapping anywhere on the card except a button opens it.
   - Its own focus outline is suppressed. The card shows the focus ring instead (`has-[a:focus-visible]:ring-2`).
3. **Actions** (`relative z-10 mt-auto flex items-center justify-between`):
   - favorite, archive/unarchive, edit and delete, with today's labels, `aria-pressed` and icons;
   - always visible, using the compact button size.

`IconButton` gains `size?: 'md' | 'sm'`:
- `'md'` (default) = `size-9`, as today;
- `'sm'` = `size-8`.

The smallest card (152 px, 132 px inside) fits 4 × 32 px buttons and a 24 px header row + 3-line title + 32 px action row with 8 px gaps.

Description and tag chips are no longer rendered on cards. `queryLinks` still searches them.

---

## 5. Error handling summary

| Situation | Behaviour |
|---|---|
| Legacy import throws | DB open fails, the error screen offers Reload, the import retries (nothing committed) |
| Legacy delete blocked or failing | Not awaited; logged; start-up continues |
| `stow` already has data and the legacy DB exists | No copy; the legacy DB is left alone |
| Category push before migration 0002 (`PGRST204`) | Retryable; the change stays in the outbox until the migration runs |
| Category row without a known icon | Drawn and edited as `folder` |
| Invalid icon in the form | "Pick an icon" (cannot happen through the picker; guards the API) |

## 6. Testing

TDD throughout. New and changed tests:

- **core:**
  - `isCategoryIcon` / `categoryIconName`;
  - `parseCategoryInput` icon validation and the "Pick an icon" error;
  - `createCategory` / `updateCategory` with icon;
  - `categoryPayload` includes the icon (defaults when missing);
  - `RemoteError` code passthrough;
  - `errorKind` treats `PGRST204` as retryable and other 400s as fatal;
  - the sync engine keeps a `PGRST204`-failing category entry in the outbox;
  - PGlite `migration.test.ts` applies 0001 + 0002: existing rows get `folder`, `'Bad Icon'` and a 41-char name are rejected, `briefcase` is accepted.
- **ui:**
  - every `CATEGORY_ICONS` name has an option with a component and a non-empty label;
  - `CategoryIcon` falls back to folder for unknown or missing names and applies the colour;
  - `CategoryPicker` shows the selected category's icon and none for "No category".
- **web:**
  - `IconPicker` (selection and labels);
  - `CategoryManager` (add with an icon, edit keeps or changes it, the list shows icons);
  - `db.test.ts` legacy import:
    - copies all tables with icons defaulted and outbox `seq` order preserved;
    - deletes the legacy DB;
    - skips when `stow` has data (legacy kept);
    - deletes an empty legacy DB;
    - no legacy DB is a no-op;
  - `LinkCard` (header, 3-line title link, category label, actions, no description or tags);
  - `LinkList` / `Library` updated for the grid and the new strings.
- **extension:** updated strings and menu ids. `SaveScreen` shows the category icon.
- **Live** (`pnpm test:live`): categories round-trip their icon. This requires the user to run migration 0002 on their Supabase project first.
- **Manual:**
  - the browser at 360 px and 1440 px widths (2 and 6 columns);
  - the icon picker;
  - the dropdown icon;
  - importing a populated legacy DB in a real browser.

`pnpm test`, `pnpm typecheck` and `pnpm build` (including the PWA check) must pass.

## 7. Documentation

README:
- the product name and `@stow/*` filters throughout;
- a setup step to run `0002_category_icons.sql` after `0001_init.sql`;
- an **"Upgrading from Linkstash"** section:
  - run 0002 before updating;
  - local data is imported automatically;
  - Chrome/Edge: reload the unpacked extension;
  - Firefox: remove the old add-on, load the new one, sign in again;
- the feature list mentions category icons and the card grid;
- a troubleshooting note: "category changes not syncing after an update → run migration 0002".

## 8. Acceptance criteria

1. No user-visible "Linkstash" remains. `git grep -i linkstash` only matches the files listed in §1.2.
2. A browser holding Linkstash data opens Stow with the same links, categories (now with folder icons), unsynced changes and sign-in.
3. Categories can be created and edited with any of the 40 icons. The icon syncs between devices and shows in filters, the category list, cards, the dropdown and the extension's "Saved" view. No colour dot remains anywhere.
4. Links display as square cards: 2 columns at 360 px, up to 6 on wide screens, with title, site, favicon, category icon and the 4 actions; tapping the card opens the link.
5. Pushing a category before migration 0002 loses nothing.
6. Tests, typecheck and build pass. The live tests pass after migration 0002.
