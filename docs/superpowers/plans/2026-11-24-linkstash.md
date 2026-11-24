# Linkstash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Linkstash, a bookmark and link manager with three parts: an installable offline-capable PWA, a Chrome MV3 + Firefox browser extension, and Supabase cloud sync between them.

**Architecture:** A pnpm monorepo. `packages/core` is pure TypeScript and holds the types, validation, URL dedupe, querying, the `Remote` interface with its Supabase implementation, and a `SyncEngine` that replays a local outbox. `packages/ui` holds the shared React forms. `apps/web` is a Vite + React + Tailwind PWA with a Dexie (IndexedDB) local store. `apps/extension` is a WXT extension that talks to Supabase directly. `supabase/` holds the SQL migration and one Edge Function for fetching page metadata.

**Tech Stack:** TypeScript 7, pnpm 11 workspaces, Vite 8, Vitest 5, React 19, Tailwind CSS 4, zod 4, Dexie 4, supabase-js 2, vite-plugin-pwa 2 (Workbox), WXT 0.21, Supabase (Postgres, Auth, Realtime, Edge Functions on Deno).

**Spec:** `docs/superpowers/specs/2026-11-24-linkstash-design.md`

## Global Constraints

- Node ≥ 20.19 (tested on Node 25). Package manager: pnpm ≥ 11, workspace globs `packages/*` and `apps/*`.
- Dependency versions, used as caret ranges: typescript ^7.0.2, vite ^8.3.8, vitest ^5.1.1, react/react-dom ^19.3.1, @types/react ^19.3.0, @types/react-dom ^19, @vitejs/plugin-react ^6.3.0, tailwindcss/@tailwindcss/vite ^4.3.5, zod ^4.6.7, dexie ^4.4.7, dexie-react-hooks ^4.4.0, @supabase/supabase-js ^2.119.2, vite-plugin-pwa ^2.0.0, @vite-pwa/assets-generator ^2.0.0, workbox-window ^7.4.1, wxt ^0.21.5, @wxt-dev/module-react ^1.2.2, @wxt-dev/auto-icons ^2.0.0, fake-indexeddb ^6.2.8, jsdom ^31.0.1, @testing-library/react ^16.3.3, @testing-library/dom ^10.4.2, lucide-react ^1.78.0, @types/node ^26.6.6, @electric-sql/pglite ^0.6.0 (core devDependency: runs the migration in tests). Deno is not installed globally; type-check the Edge Function with `npx -y deno check`.
- Every package that runs tests must use the same `vitest` version. `@linkstash/core/testing` imports `vitest`, so a version mismatch would load two copies.
- Workspace packages ship TypeScript source with no build step: `"exports": { ".": "./src/index.ts" }`.
- All TS is `strict`. Imports inside packages are extensionless (`./url`). The one exception is the Edge Function's shared module, imported with a `.ts` extension because Deno needs it.
- Env var names, exactly:
  - `apps/web/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
  - `apps/extension/.env`: `WXT_SUPABASE_URL`, `WXT_SUPABASE_PUBLISHABLE_KEY`, `WXT_APP_URL` (optional, default `http://localhost:5173`)
  - `apps/web/.env.local`: `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `SMOKE_EDGE` (live test only)
- `.env`, `.env.local`, `.env.*.local` are gitignored. Only `.env.example` files are committed. Never commit real keys.
- Saved URLs are http/https only. Category names are 1–50 chars. Category colors are `#RRGGBB` from a 10-color palette.
- Extension permissions are exactly `activeTab`, `scripting`, `contextMenus`, `storage`, with no `host_permissions`. Firefox gecko id is `linkstash@example.com` with `strict_min_version` `115.0`.
- Out of scope (do not build): nested folders, sharing, page archiving, bookmark import/export, OAuth/magic link, offline writes in the extension, Safari.
- Commits use Conventional Commits, and every commit ends with the trailer `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`. In PowerShell, add it with a second `-m`.
- The dev machine runs Windows/PowerShell. Commands below work in PowerShell. Run them from the repo root unless a step says otherwise.

## File Structure

```
package.json                     root scripts: dev, dev:ext, build, test, typecheck, test:live
pnpm-workspace.yaml              workspace globs
tsconfig.base.json               shared strict TS options
.gitignore                       node_modules, dist, .output, .wxt, .env files
README.md                        setup / build / install / deploy docs (Task 19)
packages/core/                   pure TS shared by web + extension
  package.json, tsconfig.json, vitest.config.ts, vitest.live.config.ts
  src/url.ts                     isHttpUrl, normalizeUrl, dedupeKey, hostname, faviconFallback
  src/schema.ts                  Link, Category, Mutation, OutboxEntry, SyncTable, CATEGORY_COLORS, mutationTargetId
  src/model.ts                   Result, LIMITS, Clock, link/category parsing + create/update, tags, metadata patches, displayTitle
  src/query.ts                   LinkView, LinkSort, queryLinks, findByUrl, activeCategories, countByCategory
  src/local.ts                   LocalStore interface, LocalChange, MemoryLocalStore
  src/remote.ts                  Remote interface, RemoteError, ErrorKind, errorKind
  src/sync.ts                    SyncEngine, SyncResult, PULL_OVERLAP_MS
  src/supabase.ts                createLinkstashClient, AuthStorage, isAuthRetryableFetchError (+ Session/User types)
  src/supabase-remote.ts         SupabaseRemote (Remote + findLinkByUrlKey + listCategories)
  src/metadata-client.ts         fetchMetadata via the Edge Function
  src/index.ts                   public exports
  src/testing/                   factories (makeLink, makeCategory), FakeRemote, describeLocalStoreContract
  src/url|model|query|local|sync|metadata|supabase-remote.test.ts   unit tests
  src/migration.test.ts          runs supabase/migrations/0001_init.sql in PGlite (RLS, triggers, RPC)
  src/fetch-metadata.test.ts     Edge Function handler with a fake fetch
  src/supabase.live.test.ts      opt-in live smoke test against a real project (pnpm test:live)
packages/ui/                     shared React pieces
  package.json, tsconfig.json, vitest.config.ts
  src/styles.ts, ColorDot.tsx, Field.tsx, CategoryPicker.tsx, LinkForm.tsx, AuthForm.tsx, index.ts
  src/AuthForm.test.tsx, LinkForm.test.tsx
apps/web/                        Vite + React + Tailwind PWA
  package.json, tsconfig.json, index.html, vite.config.ts (PWA + preview.allowedHosts), vitest.config.ts, .env.example
  public/logo.svg (+ icons generated by @vite-pwa/assets-generator), scripts/check-pwa.mjs
  src/main.tsx, App.tsx, Library.tsx, index.css, vite-env.d.ts
  src/env.ts, services.ts, db.ts (Dexie LocalStore), actions.ts, hooks.ts, toast.ts, share.ts
  src/sync/scheduler.ts, useSyncLifecycle.ts
  src/components/                Toolbar, FilterNav, LinkList, LinkCard, IconButton, Sheet, LinkSheet,
                                 CategoryManager, ColorPalette, StatusBadge, Toaster, AuthScreen, SetupNotice
  src/test/setup.ts, fakeServices.tsx
  src/**/*.test.ts(x)            env, db, actions, toast, share, scheduler, useSyncLifecycle, App, Library,
                                 LinkList, LinkSheet, CategoryManager, Toaster
apps/extension/                  WXT browser extension (Chrome MV3 + Firefox)
  package.json, tsconfig.json, wxt.config.ts, vitest.config.ts, env.d.ts, .env.example, assets/icon.svg
  lib/config.ts, storage.ts, services.ts, page.ts, save.ts, context-menu.ts
  lib/config.test.ts, save.test.ts, context-menu.test.ts
  entrypoints/popup/index.html, main.tsx, style.css, App.tsx, SignIn.tsx, SaveScreen.tsx, PagePreview.tsx
  entrypoints/background.ts      context menus + toolbar badge feedback
supabase/
  migrations/0001_init.sql       tables, RLS, triggers, RPC
  functions/_shared/metadata.ts  parseHtmlMetadata, isFetchableUrl (pure, dependency-free)
  functions/fetch-metadata/handler.ts  createHandler (auth, SSRF-safe redirects, timeout, byte cap), supabaseAuthenticator
  functions/fetch-metadata/index.ts    Deno entry: Deno.serve(createHandler(...))
```

---

### Task 1: Monorepo scaffold + core URL utilities

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/url.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`@linkstash/core`):
  - `isHttpUrl(value: string): boolean`
  - `normalizeUrl(input: string): string | null`
  - `dedupeKey(url: string): string` (throws on an invalid URL, so pass normalized URLs)
  - `hostname(url: string): string`
  - `faviconFallback(url: string): string`

- [ ] **Step 1: Create the workspace files**

`package.json`:
```json
{
  "name": "linkstash",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.19" },
  "scripts": {
    "dev": "pnpm --filter @linkstash/web dev",
    "dev:ext": "pnpm --filter @linkstash/extension dev",
    "build": "pnpm -r --if-present build",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "test:live": "pnpm --filter @linkstash/core test:live"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - apps/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "types": []
  }
}
```

`.gitignore`:
```
node_modules/
dist/
dev-dist/
.output/
.wxt/
coverage/
*.log
.env
.env.local
.env.*.local
```

`packages/core/package.json`:
```json
{
  "name": "@linkstash/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "devDependencies": {
    "@types/node": "^26.6.6",
    "typescript": "^7.0.2",
    "vitest": "^5.1.1"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "vitest.config.ts"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
  },
});
```

`packages/core/src/index.ts`:
```ts
export * from './url';
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: it completes and creates `pnpm-lock.yaml`. If pnpm reports ignored build scripts, run `pnpm approve-builds` and approve them.

- [ ] **Step 3: Write the failing test**

`packages/core/src/url.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { dedupeKey, faviconFallback, hostname, isHttpUrl, normalizeUrl } from './url';

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/x')).toBe(true);
  });
  it('rejects other schemes and garbage', () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('adds https:// when no scheme is given', () => {
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
  });
  it('keeps an explicit http scheme, lowercases the host, and trims', () => {
    expect(normalizeUrl('  http://Example.com  ')).toBe('http://example.com/');
  });
  it('accepts localhost with a port', () => {
    expect(normalizeUrl('localhost:5173')).toBe('https://localhost:5173/');
  });
  it('accepts single-label hosts only when the scheme is explicit', () => {
    expect(normalizeUrl('http://nas:8080/')).toBe('http://nas:8080/');
    expect(normalizeUrl('hello')).toBeNull();
  });
  it('rejects empty input, non-http schemes, and junk', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('ftp://example.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('hello world')).toBeNull();
    expect(normalizeUrl('mailto:me@example.com')).toBeNull();
  });
});

describe('dedupeKey', () => {
  it('ignores scheme, www, host case, trailing slashes, and fragments', () => {
    const key = dedupeKey('https://example.com/a/b');
    expect(key).toBe('example.com/a/b');
    expect(dedupeKey('http://WWW.Example.com/a/b/')).toBe(key);
    expect(dedupeKey('https://example.com/a/b#section')).toBe(key);
  });
  it('drops tracking params but keeps meaningful ones', () => {
    expect(
      dedupeKey('https://example.com/p?id=7&utm_source=x&UTM_Medium=y&fbclid=1&gclid=2&mc_cid=3&mc_eid=4'),
    ).toBe('example.com/p?id=7');
  });
  it('keeps the port and treats the root path as empty', () => {
    expect(dedupeKey('http://localhost:3000/')).toBe('localhost:3000');
    expect(dedupeKey('https://example.com')).toBe('example.com');
  });
});

describe('hostname / faviconFallback', () => {
  it('strips www and returns the input when it cannot be parsed', () => {
    expect(hostname('https://www.example.com/x')).toBe('example.com');
    expect(hostname('nope')).toBe('nope');
  });
  it('builds a Google s2 favicon URL', () => {
    expect(faviconFallback('https://www.example.com/x')).toBe(
      'https://www.google.com/s2/favicons?domain=example.com&sz=64',
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @linkstash/core test`
Expected: FAIL. Vite can't resolve the import "./url".

- [ ] **Step 5: Implement `packages/core/src/url.ts`**

```ts
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Returns a canonical http(s) URL, or null if the input is not a usable web URL. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hadScheme = HAS_SCHEME.test(trimmed);
  const candidate = hadScheme ? trimmed : `https://${trimmed}`;
  if (!isHttpUrl(candidate)) return null;
  const u = new URL(candidate);
  if (!hadScheme) {
    // Guess-mode input ("example.com") must look like a real host, not "hello" or "mailto:x@y".
    if (u.username || u.password) return null;
    const h = u.hostname;
    if (h !== 'localhost' && !h.includes('.') && !h.startsWith('[')) return null;
  }
  return u.href;
}

/** Key used to detect the same page saved twice. Pass a normalized URL. */
export function dedupeKey(url: string): string {
  const u = new URL(url);
  const host = u.host.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  const kept = [...u.searchParams].filter(([k]) => {
    const key = k.toLowerCase();
    return !key.startsWith('utm_') && !TRACKING_PARAMS.has(key);
  });
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  return `${host}${path}${query}`;
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function faviconFallback(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname(url))}&sz=64`;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @linkstash/core test; pnpm --filter @linkstash/core typecheck`
Expected: every url test passes and tsc reports no errors.

- [ ] **Step 7: Commit**

```powershell
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore packages/core
git commit -m "chore: scaffold monorepo and core url utilities" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Core schema + model (validation, factories, tags, categories)

**Files:**
- Create: `packages/core/src/schema.ts`, `packages/core/src/model.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json` (add zod)
- Test: `packages/core/src/model.test.ts`

**Interfaces:**
- Consumes: `dedupeKey`, `hostname`, `isHttpUrl`, `normalizeUrl` from `./url` (Task 1).
- Produces (`@linkstash/core`):
  - Types `Link`, `Category`, `Mutation`, `OutboxEntry`, `SyncTable`.
  - `CATEGORY_COLORS: readonly string[10]`.
  - `mutationTargetId(m: Mutation): string`.
  - `Result<T> = { ok: true; value: T } | { ok: false; error: string }`.
  - `LIMITS`.
  - `Clock { now(): string; id(): string }`, `systemClock`.
  - `LinkInput`, `ParsedLinkInput`, `PageMetadataInput`, `CleanMetadata`.
  - `parseLinkInput(input: LinkInput): Result<ParsedLinkInput>`.
  - `cleanMetadata(meta: PageMetadataInput): CleanMetadata`.
  - `normalizeTags(tags: readonly string[]): string[]`, `parseTagString(s: string): string[]`, `formatTags(tags): string`.
  - `createLink(input: ParsedLinkInput, clock?: Clock): Link`.
  - `LinkPatch`, `updateLink(link: Link, patch: LinkPatch, clock?: Clock): Link`.
  - `editPatch(input: ParsedLinkInput): LinkPatch`.
  - `metadataPatch(link, meta: PageMetadataInput): LinkPatch`: fetched metadata for the fields the link still lacks. The title counts as lacking while it equals the hostname placeholder.
  - `needsMetadata(link): boolean`: true unless title, description and favicon are all filled.
  - `displayTitle(link): string`.
  - `CategoryInput { name; color }`, `parseCategoryInput(input): Result<CategoryInput>`.
  - `createCategory(input: CategoryInput, clock?): Category`.
  - `CategoryPatch`, `updateCategory(category, patch, clock?): Category`.
  - `nextCategoryColor(existing: readonly Category[]): string`.

- [ ] **Step 1: Add zod**

Run: `pnpm --filter @linkstash/core add zod@^4.6.7`
Expected: `packages/core/package.json` now lists `"zod": "^4.6.7"` under `dependencies`.

- [ ] **Step 2: Write `packages/core/src/schema.ts`**

This file is types and constants only, so its behaviour is covered by the model tests.

```ts
export interface Link {
  id: string;
  /** Filled by the server (default auth.uid()); absent on rows created on this device. */
  user_id?: string;
  url: string;
  url_key: string;
  title: string;
  custom_title: string | null;
  description: string | null;
  favicon_url: string | null;
  notes: string | null;
  tags: string[];
  category_id: string | null;
  is_favorite: boolean;
  is_archived: boolean;
  visit_count: number;
  last_visited_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Category {
  id: string;
  user_id?: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type Mutation =
  | { type: 'upsertLink'; row: Link }
  | { type: 'upsertCategory'; row: Category }
  | { type: 'visit'; id: string };

export interface OutboxEntry {
  seq: number;
  mutation: Mutation;
}

export type SyncTable = 'links' | 'categories';

export const CATEGORY_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
] as const;

export function mutationTargetId(m: Mutation): string {
  return m.type === 'visit' ? m.id : m.row.id;
}
```

- [ ] **Step 3: Write the failing test**

`packages/core/src/model.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  cleanMetadata,
  createCategory,
  createLink,
  displayTitle,
  editPatch,
  metadataPatch,
  needsMetadata,
  nextCategoryColor,
  normalizeTags,
  parseCategoryInput,
  parseLinkInput,
  parseTagString,
  updateCategory,
  updateLink,
  type Clock,
  type LinkInput,
} from './model';
import { CATEGORY_COLORS } from './schema';

const T0 = '2026-01-01T00:00:00.000Z';
const clock = (now = T0, id = 'id-1'): Clock => ({ now: () => now, id: () => id });

function parsed(input: LinkInput) {
  const r = parseLinkInput(input);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('normalizeTags / parseTagString', () => {
  it('trims, lowercases, strips #, hyphenates spaces, and dedupes', () => {
    expect(normalizeTags([' Read Later ', '#JS', 'js', '', '  '])).toEqual(['read-later', 'js']);
  });
  it('splits a comma-separated string', () => {
    expect(parseTagString('a, B ,#c,,a')).toEqual(['a', 'b', 'c']);
  });
});

describe('parseLinkInput', () => {
  it('normalizes the URL and fills defaults', () => {
    expect(parsed({ url: 'example.com' })).toEqual({
      url: 'https://example.com/',
      customTitle: null,
      notes: null,
      tags: [],
      categoryId: null,
      title: null,
      description: null,
      faviconUrl: null,
    });
  });
  it('trims text, turns blanks into null, and normalizes tags', () => {
    const v = parsed({ url: 'https://a.io', customTitle: '  Mine ', notes: '   ', tags: ['X', 'x'], categoryId: '' });
    expect(v).toMatchObject({ customTitle: 'Mine', notes: null, tags: ['x'], categoryId: null });
  });
  it('rejects invalid URLs', () => {
    expect(parseLinkInput({ url: 'not a url' })).toEqual({ ok: false, error: 'Enter a valid http(s) URL' });
  });
  it('rejects notes that are too long', () => {
    expect(parseLinkInput({ url: 'https://a.io', notes: 'x'.repeat(5001) }).ok).toBe(false);
  });
  it('rejects more than 20 tags', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(parseLinkInput({ url: 'https://a.io', tags })).toEqual({ ok: false, error: 'Use at most 20 tags' });
  });
  it('clips metadata and drops non-http favicons', () => {
    const v = parsed({
      url: 'https://a.io',
      title: ` ${'t'.repeat(400)} `,
      description: 'a\n   b',
      faviconUrl: 'data:image/png;base64,xx',
    });
    expect(v.title).toHaveLength(300);
    expect(v.description).toBe('a b');
    expect(v.faviconUrl).toBeNull();
  });
});

describe('cleanMetadata', () => {
  it('keeps http favicons and nulls empty strings', () => {
    expect(cleanMetadata({ title: '  ', description: null, faviconUrl: 'https://a.io/f.ico' })).toEqual({
      title: null,
      description: null,
      faviconUrl: 'https://a.io/f.ico',
    });
  });
});

describe('createLink / updateLink / editPatch / displayTitle', () => {
  it('creates a link with a url_key and a hostname fallback title', () => {
    expect(createLink(parsed({ url: 'https://www.example.com/a/', tags: ['x'] }), clock())).toEqual({
      id: 'id-1',
      url: 'https://www.example.com/a/',
      url_key: 'example.com/a',
      title: 'example.com',
      custom_title: null,
      description: null,
      favicon_url: null,
      notes: null,
      tags: ['x'],
      category_id: null,
      is_favorite: false,
      is_archived: false,
      visit_count: 0,
      last_visited_at: null,
      created_at: T0,
      updated_at: T0,
      deleted_at: null,
    });
  });
  it('uses the fetched page title when present', () => {
    expect(createLink(parsed({ url: 'https://a.io', title: 'Page' }), clock()).title).toBe('Page');
  });
  it('updateLink bumps updated_at and recomputes url_key when the URL changes', () => {
    const link = createLink(parsed({ url: 'https://a.io/x' }), clock());
    const next = updateLink(link, { url: 'https://b.io/y', is_favorite: true }, clock('2026-02-01T00:00:00.000Z'));
    expect(next).toMatchObject({
      url: 'https://b.io/y',
      url_key: 'b.io/y',
      is_favorite: true,
      updated_at: '2026-02-01T00:00:00.000Z',
    });
    expect(link.url_key).toBe('a.io/x');
  });
  it('editPatch maps form fields onto link columns', () => {
    expect(editPatch(parsed({ url: 'a.io', customTitle: 'T', notes: 'n', tags: ['t'], categoryId: 'c1' }))).toEqual({
      url: 'https://a.io/',
      custom_title: 'T',
      notes: 'n',
      tags: ['t'],
      category_id: 'c1',
    });
  });
  it('displayTitle prefers custom title, then title, then hostname', () => {
    expect(displayTitle({ custom_title: 'C', title: 'T', url: 'https://a.io' })).toBe('C');
    expect(displayTitle({ custom_title: null, title: 'T', url: 'https://a.io' })).toBe('T');
    expect(displayTitle({ custom_title: null, title: '', url: 'https://www.a.io' })).toBe('a.io');
  });
});

describe('metadataPatch / needsMetadata', () => {
  const bare = () => createLink(parsed({ url: 'https://www.a.io/x' }), clock());
  const full = () =>
    createLink(
      parsed({ url: 'https://a.io', title: 'Mine', description: 'Mine too', faviconUrl: 'https://a.io/1.png' }),
      clock(),
    );

  it('fills the placeholder title, a missing description and a missing favicon', () => {
    expect(metadataPatch(bare(), { title: ' Page ', description: 'About', faviconUrl: 'https://a.io/f.png' })).toEqual({
      title: 'Page',
      description: 'About',
      favicon_url: 'https://a.io/f.png',
    });
  });
  it('never overwrites values the link already has', () => {
    expect(metadataPatch(full(), { title: 'New', description: 'New', faviconUrl: 'https://a.io/2.png' })).toEqual({});
  });
  it('needsMetadata is false only when title, description and favicon are all filled', () => {
    expect(needsMetadata(bare())).toBe(true);
    expect(needsMetadata(full())).toBe(false);
  });
});

describe('categories', () => {
  it('validates name and color', () => {
    expect(parseCategoryInput({ name: '  Work ', color: '#3B82F6' })).toEqual({
      ok: true,
      value: { name: 'Work', color: '#3b82f6' },
    });
    expect(parseCategoryInput({ name: ' ', color: '#3b82f6' })).toEqual({ ok: false, error: 'Name is required' });
    expect(parseCategoryInput({ name: 'x'.repeat(51), color: '#3b82f6' }).ok).toBe(false);
    expect(parseCategoryInput({ name: 'Work', color: 'blue' })).toEqual({ ok: false, error: 'Pick a color' });
  });
  it('creates and updates categories', () => {
    const c = createCategory({ name: 'Work', color: '#3b82f6' }, clock());
    expect(c).toEqual({ id: 'id-1', name: 'Work', color: '#3b82f6', created_at: T0, updated_at: T0, deleted_at: null });
    expect(updateCategory(c, { name: 'Jobs' }, clock('2026-03-01T00:00:00.000Z'))).toMatchObject({
      name: 'Jobs',
      updated_at: '2026-03-01T00:00:00.000Z',
    });
  });
  it('nextCategoryColor picks the first unused palette color', () => {
    expect(nextCategoryColor([])).toBe(CATEGORY_COLORS[0]);
    const c = createCategory({ name: 'A', color: CATEGORY_COLORS[0] }, clock());
    expect(nextCategoryColor([c])).toBe(CATEGORY_COLORS[1]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @linkstash/core test`
Expected: FAIL. Vite can't resolve the import "./model".

- [ ] **Step 5: Implement `packages/core/src/model.ts`**

```ts
import { z } from 'zod';
import { CATEGORY_COLORS, type Category, type Link } from './schema';
import { dedupeKey, hostname, isHttpUrl, normalizeUrl } from './url';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const LIMITS = {
  title: 300,
  description: 1000,
  notes: 5000,
  tag: 40,
  tags: 20,
  categoryName: 50,
} as const;

export interface Clock {
  now(): string;
  id(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
};

export interface PageMetadataInput {
  title?: string | null;
  description?: string | null;
  faviconUrl?: string | null;
}

export interface CleanMetadata {
  title: string | null;
  description: string | null;
  faviconUrl: string | null;
}

export interface LinkInput extends PageMetadataInput {
  url: string;
  customTitle?: string | null;
  notes?: string | null;
  tags?: string[];
  categoryId?: string | null;
}

export interface ParsedLinkInput extends CleanMetadata {
  url: string;
  customTitle: string | null;
  notes: string | null;
  tags: string[];
  categoryId: string | null;
}

const limitedText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be at most ${max} characters`).nullish();

const linkInputSchema = z.object({
  url: z.string(),
  customTitle: limitedText(LIMITS.title, 'Title'),
  notes: limitedText(LIMITS.notes, 'Notes'),
  tags: z.array(z.string()).optional(),
  categoryId: z.string().nullish(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  faviconUrl: z.string().nullish(),
});

function clip(value: string | null | undefined, max: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/** Sanitizes metadata from a tab or the Edge Function: collapse whitespace, clip, http-only favicon. */
export function cleanMetadata(meta: PageMetadataInput): CleanMetadata {
  return {
    title: clip(meta.title, LIMITS.title),
    description: clip(meta.description, LIMITS.description),
    faviconUrl: meta.faviconUrl && isHttpUrl(meta.faviconUrl) ? meta.faviconUrl : null,
  };
}

export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw
      .trim()
      .replace(/^#+/, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .slice(0, LIMITS.tag);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export const parseTagString = (value: string): string[] => normalizeTags(value.split(','));

export const formatTags = (tags: readonly string[]): string => tags.join(', ');

export function parseLinkInput(input: LinkInput): Result<ParsedLinkInput> {
  const parsed = linkInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const url = normalizeUrl(d.url);
  if (!url) return { ok: false, error: 'Enter a valid http(s) URL' };
  const tags = normalizeTags(d.tags ?? []);
  if (tags.length > LIMITS.tags) return { ok: false, error: `Use at most ${LIMITS.tags} tags` };
  return {
    ok: true,
    value: {
      url,
      customTitle: d.customTitle || null,
      notes: d.notes || null,
      tags,
      categoryId: d.categoryId || null,
      ...cleanMetadata(d),
    },
  };
}

export function createLink(input: ParsedLinkInput, clock: Clock = systemClock): Link {
  const now = clock.now();
  return {
    id: clock.id(),
    url: input.url,
    url_key: dedupeKey(input.url),
    title: input.title ?? hostname(input.url),
    custom_title: input.customTitle,
    description: input.description,
    favicon_url: input.faviconUrl,
    notes: input.notes,
    tags: input.tags,
    category_id: input.categoryId,
    is_favorite: false,
    is_archived: false,
    visit_count: 0,
    last_visited_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

export type LinkPatch = Partial<
  Pick<
    Link,
    | 'url'
    | 'title'
    | 'custom_title'
    | 'description'
    | 'favicon_url'
    | 'notes'
    | 'tags'
    | 'category_id'
    | 'is_favorite'
    | 'is_archived'
    | 'deleted_at'
  >
>;

export function updateLink(link: Link, patch: LinkPatch, clock: Clock = systemClock): Link {
  const next: Link = { ...link, ...patch, updated_at: clock.now() };
  if (patch.url !== undefined && patch.url !== link.url) next.url_key = dedupeKey(patch.url);
  return next;
}

/** The columns a user can change through the link form. */
export function editPatch(input: ParsedLinkInput): LinkPatch {
  return {
    url: input.url,
    custom_title: input.customTitle,
    notes: input.notes,
    tags: input.tags,
    category_id: input.categoryId,
  };
}

/**
 * The fetched metadata a link can take. It only fills fields the link still lacks, so it never
 * overwrites what the user or the page provided. The title counts as lacking while it equals the
 * hostname placeholder that createLink uses.
 */
export function metadataPatch(
  link: Pick<Link, 'url' | 'title' | 'description' | 'favicon_url'>,
  meta: PageMetadataInput,
): LinkPatch {
  const clean = cleanMetadata(meta);
  const patch: LinkPatch = {};
  if (clean.title && link.title === hostname(link.url)) patch.title = clean.title;
  if (clean.description && !link.description) patch.description = clean.description;
  if (clean.faviconUrl && !link.favicon_url) patch.favicon_url = clean.faviconUrl;
  return patch;
}

export function needsMetadata(link: Pick<Link, 'url' | 'title' | 'description' | 'favicon_url'>): boolean {
  return link.title === hostname(link.url) || !link.description || !link.favicon_url;
}

export function displayTitle(link: Pick<Link, 'custom_title' | 'title' | 'url'>): string {
  return link.custom_title || link.title || hostname(link.url);
}

export interface CategoryInput {
  name: string;
  color: string;
}

const categoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(LIMITS.categoryName, `Name must be at most ${LIMITS.categoryName} characters`),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Pick a color'),
});

export function parseCategoryInput(input: CategoryInput): Result<CategoryInput> {
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid category' };
  return { ok: true, value: { name: parsed.data.name, color: parsed.data.color.toLowerCase() } };
}

/** Pass input that already went through parseCategoryInput. */
export function createCategory(input: CategoryInput, clock: Clock = systemClock): Category {
  const now = clock.now();
  return { id: clock.id(), name: input.name, color: input.color, created_at: now, updated_at: now, deleted_at: null };
}

export type CategoryPatch = Partial<Pick<Category, 'name' | 'color' | 'deleted_at'>>;

export function updateCategory(category: Category, patch: CategoryPatch, clock: Clock = systemClock): Category {
  return { ...category, ...patch, updated_at: clock.now() };
}

export function nextCategoryColor(existing: readonly Category[]): string {
  const used = new Set(existing.filter((c) => !c.deleted_at).map((c) => c.color.toLowerCase()));
  return CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[existing.length % CATEGORY_COLORS.length];
}
```

Then update `packages/core/src/index.ts`:
```ts
export * from './url';
export * from './schema';
export * from './model';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @linkstash/core test; pnpm --filter @linkstash/core typecheck`
Expected: all tests pass (url + model) and tsc is clean.

- [ ] **Step 7: Commit**

```powershell
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): add schema types, validation, and link/category model" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Core query (search, filter, sort, dedupe lookup)

**Files:**
- Create: `packages/core/src/query.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/query.test.ts`

**Interfaces:**
- Consumes: `Link`, `Category` (Task 2), `displayTitle` (Task 2), `normalizeUrl`, `dedupeKey` (Task 1).
- Produces (`@linkstash/core`):
  - `type LinkView = 'all' | 'favorites' | 'archive'`
  - `type LinkSort = 'newest' | 'oldest' | 'alpha' | 'visits'`
  - `interface LinkQuery { search?: string; categoryId?: string | null; view?: LinkView; sort?: LinkSort }`
  - `queryLinks(links: readonly Link[], query?: LinkQuery): Link[]`. Never returns deleted links. The `archive` view returns only archived links; `all` and `favorites` hide archived ones. Default sort is `newest`.
  - `findByUrl(links: readonly Link[], rawUrl: string): Link | undefined`. Matches on the dedupe key and ignores deleted links.
  - `activeCategories(categories: readonly Category[]): Category[]`. Returns non-deleted categories sorted by name (case-insensitive).
  - `countByCategory(links: readonly Link[]): Record<string, number>`. Counts non-deleted, non-archived links per `category_id`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/query.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { activeCategories, countByCategory, findByUrl, queryLinks } from './query';
import type { Category, Link } from './schema';

const T = '2026-01-01T00:00:00.000Z';
let n = 0;
function link(over: Partial<Link> = {}): Link {
  n += 1;
  return {
    id: `l${n}`,
    url: `https://site${n}.com/`,
    url_key: `site${n}.com`,
    title: `Site ${n}`,
    custom_title: null,
    description: null,
    favicon_url: null,
    notes: null,
    tags: [],
    category_id: null,
    is_favorite: false,
    is_archived: false,
    visit_count: 0,
    last_visited_at: null,
    created_at: T,
    updated_at: T,
    deleted_at: null,
    ...over,
  };
}
const cat = (over: Partial<Category>): Category => ({
  id: 'c',
  name: 'n',
  color: '#3b82f6',
  created_at: T,
  updated_at: T,
  deleted_at: null,
  ...over,
});
const ids = (links: Link[]) => links.map((l) => l.id);

describe('queryLinks filtering', () => {
  const a = link({ id: 'a', title: 'React docs', tags: ['js', 'ui'], category_id: 'c1', created_at: '2026-01-03T00:00:00.000Z' });
  const b = link({
    id: 'b',
    title: 'Rust book',
    notes: 'Systems programming',
    category_id: 'c2',
    is_favorite: true,
    created_at: '2026-01-02T00:00:00.000Z',
  });
  const c = link({ id: 'c', title: 'Old news', is_archived: true, is_favorite: true });
  const d = link({ id: 'd', title: 'Gone', deleted_at: '2026-01-04T00:00:00.000Z' });
  const all = [c, a, d, b];

  it('hides archived and deleted links in the default view, newest first', () => {
    expect(ids(queryLinks(all))).toEqual(['a', 'b']);
  });
  it('favorites view shows non-archived favorites', () => {
    expect(ids(queryLinks(all, { view: 'favorites' }))).toEqual(['b']);
  });
  it('archive view shows only archived links', () => {
    expect(ids(queryLinks(all, { view: 'archive' }))).toEqual(['c']);
  });
  it('filters by category', () => {
    expect(ids(queryLinks(all, { categoryId: 'c2' }))).toEqual(['b']);
    expect(ids(queryLinks(all, { categoryId: null }))).toEqual(['a', 'b']);
  });
  it('requires every search term to match, case-insensitively, across fields', () => {
    expect(ids(queryLinks(all, { search: 'SYSTEMS rust' }))).toEqual(['b']);
    expect(ids(queryLinks(all, { search: '#js' }))).toEqual(['a']);
    expect(ids(queryLinks(all, { search: '  ' }))).toEqual(['a', 'b']);
    expect(queryLinks(all, { search: 'react rust' })).toEqual([]);
  });
  it('searches custom title, description, and url too', () => {
    const x = link({ id: 'x', custom_title: 'Mine', description: 'A deep dive', url: 'https://deep.dev/post' });
    expect(ids(queryLinks([x, a], { search: 'mine dive' }))).toEqual(['x']);
    expect(ids(queryLinks([x, a], { search: 'deep.dev' }))).toEqual(['x']);
  });
});

describe('queryLinks sorting', () => {
  const x = link({ id: 'x', title: 'banana', visit_count: 3, created_at: '2026-01-02T00:00:00.000Z' });
  const y = link({ id: 'y', title: 'Apple', visit_count: 2, created_at: '2026-01-01T00:00:00.000Z' });
  const z = link({ id: 'z', title: 'cherry', custom_title: 'Avocado', visit_count: 2, created_at: '2026-01-03T00:00:00.000Z' });
  const all = [x, y, z];

  it('sorts newest and oldest', () => {
    expect(ids(queryLinks(all, { sort: 'newest' }))).toEqual(['z', 'x', 'y']);
    expect(ids(queryLinks(all, { sort: 'oldest' }))).toEqual(['y', 'x', 'z']);
  });
  it('sorts alphabetically by display title, ignoring case', () => {
    expect(ids(queryLinks(all, { sort: 'alpha' }))).toEqual(['y', 'z', 'x']);
  });
  it('sorts by visits, breaking ties by newest', () => {
    expect(ids(queryLinks(all, { sort: 'visits' }))).toEqual(['x', 'z', 'y']);
  });
  it('compares timestamps as instants, not strings', () => {
    const p = link({ id: 'p', created_at: '2026-01-02T10:00:00+02:00' });
    const q = link({ id: 'q', created_at: '2026-01-02T09:00:00.000Z' });
    expect(ids(queryLinks([p, q]))).toEqual(['q', 'p']);
  });
  it('does not mutate the input array', () => {
    const input = [y, x];
    queryLinks(input, { sort: 'alpha' });
    expect(ids(input)).toEqual(['y', 'x']);
    queryLinks(input);
    expect(ids(input)).toEqual(['y', 'x']);
  });
});

describe('findByUrl', () => {
  const saved = link({ id: 's', url: 'https://a.io/x', url_key: 'a.io/x' });
  const gone = link({ id: 'g', url: 'https://b.io/', url_key: 'b.io', deleted_at: T });
  it('matches on the dedupe key', () => {
    expect(findByUrl([saved, gone], 'http://www.a.io/x/?utm_source=t')?.id).toBe('s');
  });
  it('ignores deleted links and invalid input', () => {
    expect(findByUrl([saved, gone], 'https://b.io')).toBeUndefined();
    expect(findByUrl([saved], 'not a url')).toBeUndefined();
  });
});

describe('activeCategories / countByCategory', () => {
  it('drops deleted categories and sorts by name', () => {
    const list = [cat({ id: '2', name: 'work' }), cat({ id: '1', name: 'Art' }), cat({ id: '3', name: 'Zed', deleted_at: T })];
    expect(activeCategories(list).map((c) => c.id)).toEqual(['1', '2']);
  });
  it('counts visible links per category', () => {
    const links = [
      link({ category_id: 'c1' }),
      link({ category_id: 'c1' }),
      link({ category_id: 'c2', is_archived: true }),
      link({ category_id: 'c2', deleted_at: T }),
      link({ category_id: null }),
    ];
    expect(countByCategory(links)).toEqual({ c1: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @linkstash/core test`
Expected: FAIL. Vite can't resolve the import "./query".

- [ ] **Step 3: Implement `packages/core/src/query.ts`**

```ts
import { displayTitle } from './model';
import type { Category, Link } from './schema';
import { dedupeKey, normalizeUrl } from './url';

export type LinkView = 'all' | 'favorites' | 'archive';
export type LinkSort = 'newest' | 'oldest' | 'alpha' | 'visits';

export interface LinkQuery {
  search?: string;
  categoryId?: string | null;
  view?: LinkView;
  sort?: LinkSort;
}

// Server rows ("…+00:00", microseconds) and local rows ("…Z") use different formats, so compare instants.
const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

const byNewest = (a: Link, b: Link) => time(b.created_at) - time(a.created_at) || a.id.localeCompare(b.id);

const COMPARATORS: Record<LinkSort, (a: Link, b: Link) => number> = {
  newest: byNewest,
  oldest: (a, b) => -byNewest(a, b),
  alpha: (a, b) => displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' }) || byNewest(a, b),
  visits: (a, b) => b.visit_count - a.visit_count || byNewest(a, b),
};

function searchTerms(search: string): string[] {
  return search
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^#+/, ''))
    .filter(Boolean);
}

function haystack(link: Link): string {
  return [link.title, link.custom_title, link.url, link.description, link.notes, link.tags.join(' ')]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function queryLinks(links: readonly Link[], query: LinkQuery = {}): Link[] {
  const view = query.view ?? 'all';
  const terms = searchTerms(query.search ?? '');
  return links
    .filter((link) => {
      if (link.deleted_at) return false;
      if (view === 'archive' ? !link.is_archived : link.is_archived) return false;
      if (view === 'favorites' && !link.is_favorite) return false;
      if (query.categoryId && link.category_id !== query.categoryId) return false;
      if (terms.length === 0) return true;
      const text = haystack(link);
      return terms.every((t) => text.includes(t));
    })
    .sort(COMPARATORS[query.sort ?? 'newest']);
}

export function findByUrl(links: readonly Link[], rawUrl: string): Link | undefined {
  const url = normalizeUrl(rawUrl);
  if (!url) return undefined;
  const key = dedupeKey(url);
  return links.find((l) => !l.deleted_at && l.url_key === key);
}

export function activeCategories(categories: readonly Category[]): Category[] {
  return categories
    .filter((c) => !c.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function countByCategory(links: readonly Link[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const l of links) {
    if (l.deleted_at || l.is_archived || !l.category_id) continue;
    counts[l.category_id] = (counts[l.category_id] ?? 0) + 1;
  }
  return counts;
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './query';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @linkstash/core test; pnpm --filter @linkstash/core typecheck`
Expected: all tests pass and tsc is clean.

- [ ] **Step 5: Commit**

```powershell
git add packages/core
git commit -m "feat(core): add link search, filtering, sorting, and dedupe lookup" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Shared HTML metadata parser + fetchable-URL guard

**Files:**
- Create: `supabase/functions/_shared/metadata.ts`. It has no imports, so it runs unchanged in Deno (Edge Function) and Node (Vitest).
- Test: `packages/core/src/metadata.test.ts`. The test lives in core, which already has Vitest, and imports the shared module by relative path.

**Interfaces:**
- Consumes: nothing.
- Produces (imported by Task 7's Edge Function as `../_shared/metadata.ts`):
  - `interface PageMetadata { title: string | null; description: string | null; faviconUrl: string | null }`
  - `parseHtmlMetadata(html: string, pageUrl: string): PageMetadata`. Only `<head>` is read.
    - Title: `<title>`, then `og:title`, then `twitter:title`.
    - Description: `description`, then `og:description`, then `twitter:description`.
    - Icon: the first `rel~=icon`, then `apple-touch-icon(-precomposed)`, then `/favicon.ico`. Resolved against `<base href>` and kept only if http(s).
    - Text is entity-decoded, whitespace-collapsed and clipped: title to 300 chars, description to 1000.
  - `isFetchableUrl(url: string): boolean`. True only for http(s) URLs without credentials whose host is a public DNS name or a public IP literal.

- [ ] **Step 1: Write the failing test**

`packages/core/src/metadata.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isFetchableUrl, parseHtmlMetadata } from '../../../supabase/functions/_shared/metadata.ts';

const page = 'https://example.com/blog/post';

describe('parseHtmlMetadata', () => {
  it('reads title, description, and icon from the head only', () => {
    const html = `<!doctype html><html><head>
      <title>  Hello &amp; welcome  </title>
      <meta name="description" content="A &quot;great&quot;
        post">
      <link rel="icon" href="/static/icon.png">
    </head><body><svg><title>ignored</title></svg><link rel="icon" href="/nope.png"></body></html>`;
    expect(parseHtmlMetadata(html, page)).toEqual({
      title: 'Hello & welcome',
      description: 'A "great" post',
      faviconUrl: 'https://example.com/static/icon.png',
    });
  });

  it('falls back to Open Graph / Twitter tags and /favicon.ico', () => {
    const html = `<head><meta property="og:title" content="OG Title"><meta name='twitter:description' content='Tweet desc'></head>`;
    expect(parseHtmlMetadata(html, page)).toEqual({
      title: 'OG Title',
      description: 'Tweet desc',
      faviconUrl: 'https://example.com/favicon.ico',
    });
  });

  it('prefers <title> over og:title and description over og:description', () => {
    const html = `<head><meta property="og:title" content="OG"><title>Real</title>
      <meta property="og:description" content="og desc"><meta name="Description" content="plain desc"></head>`;
    expect(parseHtmlMetadata(html, page)).toMatchObject({ title: 'Real', description: 'plain desc' });
  });

  it('uses apple-touch-icon when there is no rel=icon, resolved against <base>', () => {
    const html = `<head><base href="https://cdn.example.net/assets/"><link href="touch.png" rel="apple-touch-icon"></head>`;
    expect(parseHtmlMetadata(html, page).faviconUrl).toBe('https://cdn.example.net/assets/touch.png');
  });

  it('accepts "shortcut icon" and unquoted attributes, skips data: icons and mask-icon', () => {
    const html = `<head><link rel="mask-icon" href="/mask.svg"><link rel=icon href="data:image/png;base64,AAA"><link rel="shortcut icon" href=/fav.ico></head>`;
    expect(parseHtmlMetadata(html, page).faviconUrl).toBe('https://example.com/fav.ico');
  });

  it('decodes numeric entities, keeps invalid ones, and clips long values', () => {
    const html = `<title>It&#39;s &#x1F600; &#99999999;</title><meta name="description" content="${'d'.repeat(1200)}">`;
    const meta = parseHtmlMetadata(html, page);
    expect(meta.title).toBe("It's 😀 &#99999999;");
    expect(meta.description).toHaveLength(1000);
  });

  it('returns null text fields for an empty document', () => {
    expect(parseHtmlMetadata('', page)).toEqual({
      title: null,
      description: null,
      faviconUrl: 'https://example.com/favicon.ico',
    });
  });
});

describe('isFetchableUrl', () => {
  it('allows public http(s) hosts and IPs', () => {
    for (const u of [
      'https://example.com/x',
      'http://news.ycombinator.com',
      'https://93.184.216.34/',
      'http://172.32.0.1',
      'http://100.128.0.1',
      'https://[2606:4700::1111]/',
    ]) {
      expect(isFetchableUrl(u), u).toBe(true);
    }
  });

  it('blocks other schemes, credentials, and local names', () => {
    for (const u of [
      'ftp://example.com',
      'file:///etc/passwd',
      'https://user:pw@example.com',
      'http://localhost:54321',
      'http://localhost.',
      'http://app.localhost',
      'http://printer.local',
      'http://metadata.google.internal',
      'http://intranet',
      'not a url',
    ]) {
      expect(isFetchableUrl(u), u).toBe(false);
    }
  });

  it('blocks private, loopback, link-local, CGNAT, and multicast IPs, including encoded forms', () => {
    for (const u of [
      'http://127.0.0.1',
      'http://0.0.0.0',
      'http://10.1.2.3',
      'http://172.16.0.1',
      'http://172.31.255.255',
      'http://192.168.1.1',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1',
      'http://224.0.0.1',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
    ]) {
      expect(isFetchableUrl(u), u).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @linkstash/core test`
Expected: FAIL. The import `../../../supabase/functions/_shared/metadata.ts` can't be resolved.

- [ ] **Step 3: Implement `supabase/functions/_shared/metadata.ts`**

```ts
// Pure, dependency-free helpers shared by the fetch-metadata Edge Function (Deno) and core's tests (Node).

export interface PageMetadata {
  title: string | null;
  description: string | null;
  faviconUrl: string | null;
}

// These mirror LIMITS in packages/core/src/model.ts. The Edge Function can't import workspace packages.
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 1000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    const c = code.toLowerCase();
    try {
      if (c.startsWith('#x')) return String.fromCodePoint(parseInt(c.slice(2), 16));
      if (c.startsWith('#')) return String.fromCodePoint(parseInt(c.slice(1), 10));
    } catch {
      return match; // out-of-range code point
    }
    return NAMED_ENTITIES[c] ?? match;
  });
}

function cleanText(raw: string | undefined, max: number): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function tagAttributes(tag: string): Record<string, string> {
  const body = tag.replace(/^<[a-z]+/i, '').replace(/\/?>$/, '');
  const attrs: Record<string, string> = {};
  for (const m of body.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function tags(head: string, name: string): Record<string, string>[] {
  return [...head.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => tagAttributes(m[0]));
}

function resolveHttp(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function parseHtmlMetadata(html: string, pageUrl: string): PageMetadata {
  const head = html.split(/<\/head\s*>/i)[0];

  const metas: Record<string, string> = {};
  for (const a of tags(head, 'meta')) {
    const key = (a.property ?? a.name ?? a.itemprop)?.toLowerCase();
    if (key && a.content !== undefined && !(key in metas)) metas[key] = a.content;
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];
  const title =
    cleanText(titleTag, MAX_TITLE) ?? cleanText(metas['og:title'], MAX_TITLE) ?? cleanText(metas['twitter:title'], MAX_TITLE);
  const description =
    cleanText(metas['description'], MAX_DESCRIPTION) ??
    cleanText(metas['og:description'], MAX_DESCRIPTION) ??
    cleanText(metas['twitter:description'], MAX_DESCRIPTION);

  const baseHref = tags(head, 'base').find((a) => a.href)?.href;
  const base = resolveHttp(baseHref, pageUrl) ?? pageUrl;

  const links = tags(head, 'link').map((a) => ({ rel: (a.rel ?? '').toLowerCase().split(/\s+/), href: a.href }));
  const firstIcon = (accept: (rel: string[]) => boolean) =>
    links.filter((l) => accept(l.rel)).map((l) => resolveHttp(l.href, base)).find((u) => u !== null) ?? null;

  const faviconUrl =
    firstIcon((rel) => rel.includes('icon')) ??
    firstIcon((rel) => rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) ??
    resolveHttp('/favicon.ico', base);

  return { title, description, faviconUrl };
}

function isPublicIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(ip: string): boolean {
  // The URL parser has already lowercased and compressed the address.
  if (ip.startsWith('::')) return false; // ::, ::1, ::ffff:x (IPv4-mapped), and other 0::/8 addresses
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return false; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return false; // fe80::/10 link-local
  return true;
}

/**
 * Cheap SSRF guard on the URL itself. It does not resolve DNS, so a public name that points at a
 * private address still passes. That is acceptable here because the function runs on Supabase's
 * network, not the user's.
 */
export function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host.startsWith('[')) return isPublicIpv6(host.slice(1, -1));
  // WHATWG URL parsing already turned decimal/hex/short IPv4 forms into dotted quads.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPublicIpv4(host);
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
  return host.includes('.');
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @linkstash/core test; pnpm --filter @linkstash/core typecheck`
Expected: all tests pass and tsc is clean. tsc follows the import, so it checks the shared module too.
If Vitest refuses to load a file outside the package root, add `server: { fs: { allow: ['../..'] } }` to `packages/core/vitest.config.ts` and re-run.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/_shared packages/core/src/metadata.test.ts
git commit -m "feat(supabase): add shared HTML metadata parser and fetchable-url guard" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: LocalStore interface, in-memory store, and shared test helpers

**Files:**
- Create: `packages/core/src/local.ts`
- Create: `packages/core/src/testing/factories.ts`, `packages/core/src/testing/local-store-contract.ts`, `packages/core/src/testing/index.ts`
- Modify: `packages/core/src/index.ts`, and `packages/core/package.json` (add the `./testing` export)
- Test: `packages/core/src/local.test.ts`

**Interfaces:**
- Consumes: `Link`, `Category`, `Mutation`, `OutboxEntry`, `SyncTable` (Task 2), `dedupeKey` (Task 1).
- Produces:
  - From `@linkstash/core`:
    - `interface LocalChange { links?: Link[]; categories?: Category[]; mutations?: Mutation[] }`
    - `interface LocalStore`:
      - `getLink(id): Promise<Link | undefined>`, `getCategory(id): Promise<Category | undefined>`
      - `listLinks(): Promise<Link[]>`, `listCategories(): Promise<Category[]>` (order unspecified)
      - `apply(change: LocalChange): Promise<void>`: one atomic step that upserts rows by id and appends mutations to the outbox in order
      - `peekOutbox(): Promise<OutboxEntry[]>`: all entries in ascending `seq`, nothing removed
      - `removeOutbox(seq: number): Promise<void>`
      - `getCursor(table: SyncTable): Promise<string | null>`, `setCursor(table: SyncTable, cursor: string): Promise<void>`
      - `clear(): Promise<void>`: wipes rows, outbox and cursors. `seq` values never go back down, even after a clear.
    - `class MemoryLocalStore implements LocalStore`, which returns copies.
  - From `@linkstash/core/testing` (test-only; imports `vitest`):
    - `makeLink(over?: Partial<Link>): Link`, with ids `link-1, link-2, …`, `url_key` derived from `url`, and dates `2026-01-01T00:00:00.000Z`
    - `makeCategory(over?: Partial<Category>): Category`, with ids `cat-1, …`
    - `describeLocalStoreContract(name: string, makeStore: () => LocalStore | Promise<LocalStore>): void`
    - Task 6 adds `FakeRemote` to this entry point.

- [ ] **Step 1: Add the `./testing` export**

In `packages/core/package.json`, replace the `exports` block with:
```json
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/index.ts"
  },
```

- [ ] **Step 2: Write the test factories**

`packages/core/src/testing/factories.ts`:
```ts
import type { Category, Link } from '../schema';
import { dedupeKey } from '../url';

const T0 = '2026-01-01T00:00:00.000Z';
let linkSeq = 0;
let categorySeq = 0;

export function makeLink(over: Partial<Link> = {}): Link {
  linkSeq += 1;
  const url = over.url ?? `https://example${linkSeq}.com/`;
  return {
    id: `link-${linkSeq}`,
    url,
    url_key: dedupeKey(url),
    title: `Example ${linkSeq}`,
    custom_title: null,
    description: null,
    favicon_url: null,
    notes: null,
    tags: [],
    category_id: null,
    is_favorite: false,
    is_archived: false,
    visit_count: 0,
    last_visited_at: null,
    created_at: T0,
    updated_at: T0,
    deleted_at: null,
    ...over,
  };
}

export function makeCategory(over: Partial<Category> = {}): Category {
  categorySeq += 1;
  return {
    id: `cat-${categorySeq}`,
    name: `Category ${categorySeq}`,
    color: '#3b82f6',
    created_at: T0,
    updated_at: T0,
    deleted_at: null,
    ...over,
  };
}
```

- [ ] **Step 3: Write the reusable LocalStore contract**

Task 10 runs this same suite against `DexieLocalStore`.

`packages/core/src/testing/local-store-contract.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { LocalStore } from '../local';
import type { Mutation } from '../schema';
import { makeCategory, makeLink } from './factories';

export function describeLocalStoreContract(
  name: string,
  makeStore: () => LocalStore | Promise<LocalStore>,
): void {
  describe(`${name} satisfies the LocalStore contract`, () => {
    it('starts empty', async () => {
      const s = await makeStore();
      expect(await s.listLinks()).toEqual([]);
      expect(await s.listCategories()).toEqual([]);
      expect(await s.peekOutbox()).toEqual([]);
      expect(await s.getLink('missing')).toBeUndefined();
      expect(await s.getCategory('missing')).toBeUndefined();
      expect(await s.getCursor('links')).toBeNull();
    });

    it('upserts rows by id', async () => {
      const s = await makeStore();
      const link = makeLink();
      const cat = makeCategory();
      await s.apply({ links: [link], categories: [cat] });
      expect(await s.getLink(link.id)).toEqual(link);
      expect(await s.getCategory(cat.id)).toEqual(cat);

      const renamed = { ...link, title: 'Renamed' };
      await s.apply({ links: [renamed] });
      expect(await s.listLinks()).toEqual([renamed]);
      expect(await s.listCategories()).toEqual([cat]);
    });

    it('stores copies, not live references', async () => {
      const s = await makeStore();
      const link = makeLink({ tags: ['a'] });
      await s.apply({ links: [link] });
      link.tags.push('changed-after-save');
      (await s.getLink(link.id))!.tags.push('changed-after-read');
      expect((await s.getLink(link.id))!.tags).toEqual(['a']);
    });

    it('appends mutations in order and removes them by seq', async () => {
      const s = await makeStore();
      const a = makeLink();
      const b = makeLink();
      const m1: Mutation = { type: 'upsertLink', row: a };
      const m2: Mutation = { type: 'visit', id: a.id };
      const m3: Mutation = { type: 'upsertLink', row: b };
      await s.apply({ links: [a], mutations: [m1] });
      await s.apply({ mutations: [m2, m3] });

      const entries = await s.peekOutbox();
      expect(entries.map((e) => e.mutation)).toEqual([m1, m2, m3]);
      expect(entries[0].seq).toBeLessThan(entries[1].seq);
      expect(entries[1].seq).toBeLessThan(entries[2].seq);
      expect(await s.listLinks()).toEqual([a]);

      await s.removeOutbox(entries[1].seq);
      expect((await s.peekOutbox()).map((e) => e.mutation)).toEqual([m1, m3]);

      await s.removeOutbox(entries[2].seq);
      await s.apply({ mutations: [m2] });
      const after = await s.peekOutbox();
      expect(after.map((e) => e.mutation)).toEqual([m1, m2]);
      expect(after[1].seq).toBeGreaterThan(entries[2].seq);
    });

    it('keeps one cursor per table', async () => {
      const s = await makeStore();
      await s.setCursor('links', '2026-01-02T00:00:00.000Z');
      expect(await s.getCursor('links')).toBe('2026-01-02T00:00:00.000Z');
      expect(await s.getCursor('categories')).toBeNull();
      await s.setCursor('categories', '2026-01-03T00:00:00.000Z');
      await s.setCursor('links', '2026-01-04T00:00:00.000Z');
      expect(await s.getCursor('links')).toBe('2026-01-04T00:00:00.000Z');
      expect(await s.getCursor('categories')).toBe('2026-01-03T00:00:00.000Z');
    });

    it('clear() wipes rows, outbox, and cursors', async () => {
      const s = await makeStore();
      const link = makeLink();
      await s.apply({ links: [link], categories: [makeCategory()], mutations: [{ type: 'visit', id: link.id }] });
      await s.setCursor('links', '2026-01-02T00:00:00.000Z');
      await s.clear();
      expect(await s.listLinks()).toEqual([]);
      expect(await s.listCategories()).toEqual([]);
      expect(await s.peekOutbox()).toEqual([]);
      expect(await s.getCursor('links')).toBeNull();
    });
  });
}
```

`packages/core/src/testing/index.ts`:
```ts
export * from './factories';
export * from './local-store-contract';
```

- [ ] **Step 4: Write the failing test**

`packages/core/src/local.test.ts`:
```ts
import { MemoryLocalStore } from './local';
import { describeLocalStoreContract } from './testing';

describeLocalStoreContract('MemoryLocalStore', () => new MemoryLocalStore());
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @linkstash/core test`
Expected: FAIL. Vite can't resolve the import "./local".

- [ ] **Step 6: Implement `packages/core/src/local.ts`**

```ts
import type { Category, Link, Mutation, OutboxEntry, SyncTable } from './schema';

export interface LocalChange {
  links?: Link[];
  categories?: Category[];
  mutations?: Mutation[];
}

/** Device-local storage for the PWA: rows, the pending-write outbox, and pull cursors. */
export interface LocalStore {
  getLink(id: string): Promise<Link | undefined>;
  getCategory(id: string): Promise<Category | undefined>;
  listLinks(): Promise<Link[]>;
  listCategories(): Promise<Category[]>;
  /** Upserts rows and appends mutations to the outbox as one atomic step. */
  apply(change: LocalChange): Promise<void>;
  /** All outbox entries in ascending seq order, without removing them. */
  peekOutbox(): Promise<OutboxEntry[]>;
  removeOutbox(seq: number): Promise<void>;
  getCursor(table: SyncTable): Promise<string | null>;
  setCursor(table: SyncTable, cursor: string): Promise<void>;
  /** Removes rows, outbox entries, and cursors. Seq numbers keep increasing afterwards. */
  clear(): Promise<void>;
}

export class MemoryLocalStore implements LocalStore {
  private links = new Map<string, Link>();
  private categories = new Map<string, Category>();
  private outbox: OutboxEntry[] = [];
  private cursors = new Map<SyncTable, string>();
  private seq = 0;

  async getLink(id: string) {
    const row = this.links.get(id);
    return row && structuredClone(row);
  }

  async getCategory(id: string) {
    const row = this.categories.get(id);
    return row && structuredClone(row);
  }

  async listLinks() {
    return [...this.links.values()].map((r) => structuredClone(r));
  }

  async listCategories() {
    return [...this.categories.values()].map((r) => structuredClone(r));
  }

  async apply(change: LocalChange) {
    for (const row of change.links ?? []) this.links.set(row.id, structuredClone(row));
    for (const row of change.categories ?? []) this.categories.set(row.id, structuredClone(row));
    for (const mutation of change.mutations ?? []) {
      this.seq += 1;
      this.outbox.push({ seq: this.seq, mutation: structuredClone(mutation) });
    }
  }

  async peekOutbox() {
    return structuredClone(this.outbox);
  }

  async removeOutbox(seq: number) {
    this.outbox = this.outbox.filter((e) => e.seq !== seq);
  }

  async getCursor(table: SyncTable) {
    return this.cursors.get(table) ?? null;
  }

  async setCursor(table: SyncTable, cursor: string) {
    this.cursors.set(table, cursor);
  }

  async clear() {
    this.links.clear();
    this.categories.clear();
    this.outbox = [];
    this.cursors.clear();
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './local';
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @linkstash/core test; pnpm --filter @linkstash/core typecheck`
Expected: all tests pass, including 6 contract tests for `MemoryLocalStore`, and tsc is clean.

- [ ] **Step 8: Commit**

```powershell
git add packages/core
git commit -m "feat(core): add LocalStore interface, memory store, and test helpers" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Remote interface, error classification, FakeRemote, and SyncEngine

**Files:**
- Create: `packages/core/src/remote.ts`, `packages/core/src/sync.ts`, `packages/core/src/testing/fake-remote.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/testing/index.ts`
- Test: `packages/core/src/sync.test.ts`

**Interfaces:**
- Consumes:
  - `LocalStore`, `LocalChange`, `MemoryLocalStore` (Task 5)
  - `Link`, `Category`, `Mutation`, `SyncTable`, `mutationTargetId` (Task 2)
  - `makeLink`, `makeCategory` (Task 5)
- Produces (`@linkstash/core`):
  - `class RemoteError extends Error { readonly status: number }`, built with `new RemoteError(message, status)`. Status `0` means a network failure.
  - `type ErrorKind = 'auth' | 'retryable' | 'fatal'` and `errorKind(error: unknown): ErrorKind`:
    - 401 → `auth`
    - 0, 408, 429 and ≥500 → `retryable`
    - any other status → `fatal`
    - anything that isn't a `RemoteError` → `retryable`
  - `interface Remote`:
    - `pullLinks(since: string | null): Promise<Link[]>` and `pullCategories(since): Promise<Category[]>`. Both return rows with `updated_at > since`, tombstones included, in ascending `updated_at`.
    - `upsertLink(row: Link): Promise<void>`, `upsertCategory(row: Category): Promise<void>`
    - `incrementVisit(id: string): Promise<void>`
  - `type SyncResult = 'ok' | 'retry' | 'auth'`, `PULL_OVERLAP_MS = 5000`.
  - `class SyncEngine`, built with `new SyncEngine(local, remote, { onFatalError?(error, mutation) })`:
    - `saveLink(row: Link): Promise<void>` and `saveCategory(row: Category): Promise<void>`. Each writes the row and queues an upsert.
    - `recordVisit(id: string, now: string): Promise<void>`. Bumps the local count and queues `visit`; a no-op for unknown ids.
    - `flush(): Promise<SyncResult>`. Pushes the outbox in order. Stops on `retry`/`auth`. A `fatal` failure drops the entry, calls `onFatalError` and continues.
    - `pull(): Promise<void>`. Pulls categories, then links. Throws a `RemoteError` on failure.
    - `sync(): Promise<SyncResult>`. Runs flush and then pull. It is single-flight: overlapping calls share one run, which repeats once if requests arrived meanwhile. A `fatal` pull error is re-thrown.
- Produces (`@linkstash/core/testing`): `class FakeRemote implements Remote` with:
  - `links: Map<string, Link>`, `categories: Map<string, Category>`
  - `calls: string[]`, e.g. `'upsertLink:<id>'`, `'pullLinks'`, `'incrementVisit:<id>'`, logged even when a call fails
  - `sinceLog: { table: SyncTable; since: string | null }[]`
  - `failNext(...errors: unknown[])`
  - `serverWriteLink(row): Link` and `serverWriteCategory(row): Category`, which return the stored row
  - It stamps `updated_at` from 2026-01-01T00:00:01Z, one second per write. `upsertLink` keeps the server's `visit_count` and `last_visited_at`, like the real payload does.

- [ ] **Step 1: Write `packages/core/src/remote.ts`**

These are types plus one small function. `errorKind` is tested in Step 4.

```ts
import type { Category, Link } from './schema';

export class RemoteError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RemoteError';
    this.status = status;
  }
}

export type ErrorKind = 'auth' | 'retryable' | 'fatal';

export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof RemoteError)) return 'retryable';
  const { status } = error;
  if (status === 401) return 'auth';
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'retryable';
  return 'fatal';
}

/** Server operations the sync engine needs. Implemented by SupabaseRemote and FakeRemote. */
export interface Remote {
  /** Rows with updated_at > since (all rows when since is null), tombstones included, oldest first. */
  pullLinks(since: string | null): Promise<Link[]>;
  pullCategories(since: string | null): Promise<Category[]>;
  upsertLink(row: Link): Promise<void>;
  upsertCategory(row: Category): Promise<void>;
  incrementVisit(id: string): Promise<void>;
}
```

- [ ] **Step 2: Write `packages/core/src/testing/fake-remote.ts`**

```ts
import type { Remote } from '../remote';
import type { Category, Link, SyncTable } from '../schema';

const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');

function rowsSince<T extends { updated_at: string }>(rows: Map<string, T>, since: string | null): T[] {
  const after = since === null ? -Infinity : Date.parse(since);
  return [...rows.values()]
    .filter((r) => Date.parse(r.updated_at) > after)
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
    .map((r) => structuredClone(r));
}

/** In-memory Remote that behaves like the server: stamps updated_at, preserves visit counts, fails on demand. */
export class FakeRemote implements Remote {
  readonly links = new Map<string, Link>();
  readonly categories = new Map<string, Category>();
  /** Every call in order, including ones that failed. */
  readonly calls: string[] = [];
  readonly sinceLog: { table: SyncTable; since: string | null }[] = [];
  private failures: unknown[] = [];
  private tick = 0;

  /** Makes the next calls throw these errors, one per call, in order. */
  failNext(...errors: unknown[]): void {
    this.failures.push(...errors);
  }

  /** Simulates a write from another device. */
  serverWriteLink(row: Link): Link {
    const saved = { ...structuredClone(row), updated_at: this.stamp() };
    this.links.set(saved.id, saved);
    return structuredClone(saved);
  }

  serverWriteCategory(row: Category): Category {
    const saved = { ...structuredClone(row), updated_at: this.stamp() };
    this.categories.set(saved.id, saved);
    return structuredClone(saved);
  }

  async pullLinks(since: string | null): Promise<Link[]> {
    await this.step('pullLinks');
    this.sinceLog.push({ table: 'links', since });
    return rowsSince(this.links, since);
  }

  async pullCategories(since: string | null): Promise<Category[]> {
    await this.step('pullCategories');
    this.sinceLog.push({ table: 'categories', since });
    return rowsSince(this.categories, since);
  }

  async upsertLink(row: Link): Promise<void> {
    await this.step(`upsertLink:${row.id}`);
    const existing = this.links.get(row.id);
    this.links.set(row.id, {
      ...structuredClone(row),
      visit_count: existing?.visit_count ?? 0,
      last_visited_at: existing?.last_visited_at ?? null,
      updated_at: this.stamp(),
    });
  }

  async upsertCategory(row: Category): Promise<void> {
    await this.step(`upsertCategory:${row.id}`);
    this.categories.set(row.id, { ...structuredClone(row), updated_at: this.stamp() });
  }

  async incrementVisit(id: string): Promise<void> {
    await this.step(`incrementVisit:${id}`);
    const link = this.links.get(id);
    if (!link) return;
    const now = this.stamp();
    this.links.set(id, { ...link, visit_count: link.visit_count + 1, last_visited_at: now, updated_at: now });
  }

  private stamp(): string {
    this.tick += 1;
    return new Date(EPOCH + this.tick * 1000).toISOString();
  }

  private async step(call: string): Promise<void> {
    this.calls.push(call);
    if (this.failures.length > 0) throw this.failures.shift();
  }
}
```

Replace `packages/core/src/testing/index.ts` with:
```ts
export * from './factories';
export * from './fake-remote';
export * from './local-store-contract';
```

- [ ] **Step 3: Write the failing test**

`packages/core/src/sync.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryLocalStore } from './local';
import { RemoteError, errorKind } from './remote';
import { mutationTargetId, type Mutation } from './schema';
import { PULL_OVERLAP_MS, SyncEngine } from './sync';
import { FakeRemote, makeCategory, makeLink } from './testing';

type FatalHandler = (error: unknown, mutation: Mutation) => void;

let local: MemoryLocalStore;
let remote: FakeRemote;
let fatal: Mock<FatalHandler>;
let engine: SyncEngine;

beforeEach(() => {
  local = new MemoryLocalStore();
  remote = new FakeRemote();
  fatal = vi.fn<FatalHandler>();
  engine = new SyncEngine(local, remote, { onFatalError: fatal });
});

const offline = () => new RemoteError('Failed to fetch', 0);
const pendingIds = async () => (await local.peekOutbox()).map((e) => mutationTargetId(e.mutation));

describe('errorKind', () => {
  it('classifies errors', () => {
    expect(errorKind(new RemoteError('x', 401))).toBe('auth');
    for (const s of [0, 408, 429, 500, 503]) expect(errorKind(new RemoteError('x', s)), String(s)).toBe('retryable');
    for (const s of [400, 403, 404, 409, 422]) expect(errorKind(new RemoteError('x', s)), String(s)).toBe('fatal');
    expect(errorKind(new TypeError('boom'))).toBe('retryable');
  });
});

describe('SyncEngine.flush', () => {
  it('pushes outbox entries in order and empties the outbox', async () => {
    const cat = makeCategory();
    const link = makeLink({ category_id: cat.id });
    await engine.saveCategory(cat);
    await engine.saveLink(link);
    expect(await local.getLink(link.id)).toEqual(link);

    expect(await engine.flush()).toBe('ok');
    expect(remote.calls).toEqual([`upsertCategory:${cat.id}`, `upsertLink:${link.id}`]);
    expect(remote.links.get(link.id)?.title).toBe(link.title);
    expect(await local.peekOutbox()).toEqual([]);
  });

  it('stops at a retryable error and keeps that entry and the rest', async () => {
    const a = makeLink();
    const b = makeLink();
    await engine.saveLink(a);
    await engine.saveLink(b);
    remote.failNext(offline());

    expect(await engine.flush()).toBe('retry');
    expect(await pendingIds()).toEqual([a.id, b.id]);

    expect(await engine.flush()).toBe('ok');
    expect(remote.calls).toEqual([`upsertLink:${a.id}`, `upsertLink:${a.id}`, `upsertLink:${b.id}`]);
  });

  it('returns auth on 401 without dropping anything', async () => {
    const a = makeLink();
    await engine.saveLink(a);
    remote.failNext(new RemoteError('JWT expired', 401));
    expect(await engine.flush()).toBe('auth');
    expect(await pendingIds()).toEqual([a.id]);
  });

  it('drops an entry the server rejects, reports it, and continues', async () => {
    const a = makeLink();
    const b = makeLink();
    await engine.saveLink(a);
    await engine.saveLink(b);
    const error = new RemoteError('violates check constraint', 400);
    remote.failNext(error);

    expect(await engine.flush()).toBe('ok');
    expect(fatal).toHaveBeenCalledWith(error, { type: 'upsertLink', row: a });
    expect(remote.links.has(a.id)).toBe(false);
    expect(remote.links.has(b.id)).toBe(true);
    expect(await local.peekOutbox()).toEqual([]);
  });
});

describe('SyncEngine.recordVisit', () => {
  it('bumps the local count and queues a server increment', async () => {
    const link = remote.serverWriteLink(makeLink());
    await engine.pull();
    await engine.recordVisit(link.id, '2026-02-01T00:00:00.000Z');
    expect(await local.getLink(link.id)).toMatchObject({ visit_count: 1, last_visited_at: '2026-02-01T00:00:00.000Z' });

    expect(await engine.flush()).toBe('ok');
    expect(remote.calls.at(-1)).toBe(`incrementVisit:${link.id}`);
    expect(remote.links.get(link.id)?.visit_count).toBe(1);
  });

  it('ignores unknown links', async () => {
    await engine.recordVisit('missing', '2026-02-01T00:00:00.000Z');
    expect(await local.peekOutbox()).toEqual([]);
  });
});

describe('SyncEngine.pull', () => {
  it('merges categories then links, including tombstones', async () => {
    const cat = remote.serverWriteCategory(makeCategory());
    const live = remote.serverWriteLink(makeLink({ category_id: cat.id }));
    const dead = remote.serverWriteLink(makeLink({ deleted_at: '2026-01-01T00:00:00.000Z' }));
    await engine.pull();
    expect(remote.calls).toEqual(['pullCategories', 'pullLinks']);
    expect(await local.getCategory(cat.id)).toEqual(cat);
    expect(await local.getLink(live.id)).toEqual(live);
    expect(await local.getLink(dead.id)).toEqual(dead);
  });

  it('keeps a pending local change instead of the server copy', async () => {
    const server = remote.serverWriteLink(makeLink({ title: 'server' }));
    await engine.saveLink({ ...server, title: 'mine' });
    await engine.pull();
    expect((await local.getLink(server.id))?.title).toBe('mine');

    await engine.flush();
    await engine.pull();
    expect(await local.getLink(server.id)).toEqual(remote.links.get(server.id));
    expect((await local.getLink(server.id))?.title).toBe('mine');
  });

  it('advances the cursor and re-reads with an overlap window', async () => {
    remote.serverWriteLink(makeLink());
    const second = remote.serverWriteLink(makeLink());
    await engine.pull();
    expect(remote.sinceLog).toEqual([
      { table: 'categories', since: null },
      { table: 'links', since: null },
    ]);
    expect(await local.getCursor('links')).toBe(second.updated_at);

    await engine.pull();
    const expected = new Date(Date.parse(second.updated_at) - PULL_OVERLAP_MS).toISOString();
    expect(remote.sinceLog.at(-1)).toEqual({ table: 'links', since: expected });
    expect(await local.getCursor('links')).toBe(second.updated_at);
  });

  it('never moves the cursor backwards', async () => {
    const row = remote.serverWriteLink(makeLink());
    const later = new Date(Date.parse(row.updated_at) + 2000).toISOString();
    await local.setCursor('links', later);
    await engine.pull();
    expect(await local.getLink(row.id)).toBeDefined();
    expect(await local.getCursor('links')).toBe(later);
  });

  it('does not overwrite a save that lands while pulled rows are being merged', async () => {
    const server = remote.serverWriteLink(makeLink({ title: 'server' }));
    let save: Promise<void> | undefined;
    const peek = local.peekOutbox.bind(local);
    local.peekOutbox = async () => {
      const entries = await peek();
      save ??= engine.saveLink({ ...server, title: 'mine' });
      return entries;
    };
    await engine.pull();
    await save;
    expect((await local.getLink(server.id))?.title).toBe('mine');
  });
});

describe('SyncEngine.sync', () => {
  it('pushes, then pulls the server copy back', async () => {
    const link = makeLink();
    await engine.saveLink(link);
    expect(await engine.sync()).toBe('ok');
    expect(remote.calls).toEqual([`upsertLink:${link.id}`, 'pullCategories', 'pullLinks']);
    expect((await local.getLink(link.id))?.updated_at).toBe(remote.links.get(link.id)?.updated_at);
  });

  it('skips the pull when the push must be retried', async () => {
    const link = makeLink();
    await engine.saveLink(link);
    remote.failNext(offline());
    expect(await engine.sync()).toBe('retry');
    expect(remote.calls).toEqual([`upsertLink:${link.id}`]);
  });

  it('maps pull failures to results and re-throws fatal ones', async () => {
    remote.failNext(offline());
    expect(await engine.sync()).toBe('retry');
    remote.failNext(new RemoteError('JWT expired', 401));
    expect(await engine.sync()).toBe('auth');
    remote.failNext(new RemoteError('bad request', 400));
    await expect(engine.sync()).rejects.toThrow('bad request');
    expect(await engine.sync()).toBe('ok');
  });

  it('runs one sync at a time and reruns once for overlapping requests', async () => {
    const results = await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
    expect(results).toEqual(['ok', 'ok', 'ok']);
    expect(remote.calls.filter((c) => c === 'pullLinks')).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @linkstash/core test`
Expected: FAIL. Vite can't resolve the import "./sync".

- [ ] **Step 5: Implement `packages/core/src/sync.ts`**

```ts
import type { LocalChange, LocalStore } from './local';
import { errorKind, type Remote } from './remote';
import { mutationTargetId, type Category, type Link, type Mutation, type SyncTable } from './schema';

export type SyncResult = 'ok' | 'retry' | 'auth';

/** Each pull re-reads this window before the cursor so rows committed slightly out of order are not missed. */
export const PULL_OVERLAP_MS = 5000;

export interface SyncEngineOptions {
  /** Called when the server permanently rejects a mutation. The mutation is dropped. */
  onFatalError?: (error: unknown, mutation: Mutation) => void;
}

export class SyncEngine {
  private readonly local: LocalStore;
  private readonly remote: Remote;
  private readonly options: SyncEngineOptions;
  /** Serializes local read-modify-write steps so pulled rows never clobber a concurrent save. */
  private lock: Promise<unknown> = Promise.resolve();
  private running: Promise<SyncResult> | null = null;
  private dirty = false;

  constructor(local: LocalStore, remote: Remote, options: SyncEngineOptions = {}) {
    this.local = local;
    this.remote = remote;
    this.options = options;
  }

  saveLink(row: Link): Promise<void> {
    return this.exclusive(() => this.local.apply({ links: [row], mutations: [{ type: 'upsertLink', row }] }));
  }

  saveCategory(row: Category): Promise<void> {
    return this.exclusive(() => this.local.apply({ categories: [row], mutations: [{ type: 'upsertCategory', row }] }));
  }

  recordVisit(id: string, now: string): Promise<void> {
    return this.exclusive(async () => {
      const link = await this.local.getLink(id);
      if (!link) return;
      await this.local.apply({
        links: [{ ...link, visit_count: link.visit_count + 1, last_visited_at: now }],
        mutations: [{ type: 'visit', id }],
      });
    });
  }

  async flush(): Promise<SyncResult> {
    for (;;) {
      const entries = await this.local.peekOutbox();
      if (entries.length === 0) return 'ok';
      for (const entry of entries) {
        try {
          await this.push(entry.mutation);
        } catch (error) {
          const kind = errorKind(error);
          if (kind === 'auth') return 'auth';
          if (kind === 'retryable') return 'retry';
          this.options.onFatalError?.(error, entry.mutation);
        }
        await this.local.removeOutbox(entry.seq);
      }
    }
  }

  async pull(): Promise<void> {
    await this.pullTable('categories', (since) => this.remote.pullCategories(since), (rows) => ({ categories: rows }));
    await this.pullTable('links', (since) => this.remote.pullLinks(since), (rows) => ({ links: rows }));
  }

  sync(): Promise<SyncResult> {
    if (this.running) {
      this.dirty = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        let result: SyncResult;
        do {
          this.dirty = false;
          result = await this.cycle();
        } while (this.dirty && result === 'ok');
        return result;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async cycle(): Promise<SyncResult> {
    const pushed = await this.flush();
    if (pushed !== 'ok') return pushed;
    try {
      await this.pull();
      return 'ok';
    } catch (error) {
      const kind = errorKind(error);
      if (kind === 'fatal') throw error;
      return kind === 'auth' ? 'auth' : 'retry';
    }
  }

  private push(mutation: Mutation): Promise<void> {
    switch (mutation.type) {
      case 'upsertLink':
        return this.remote.upsertLink(mutation.row);
      case 'upsertCategory':
        return this.remote.upsertCategory(mutation.row);
      case 'visit':
        return this.remote.incrementVisit(mutation.id);
    }
  }

  private async pullTable<T extends { id: string; updated_at: string }>(
    table: SyncTable,
    fetchSince: (since: string | null) => Promise<T[]>,
    toChange: (rows: T[]) => LocalChange,
  ): Promise<void> {
    const cursor = await this.local.getCursor(table);
    const since = cursor === null ? null : new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString();
    const rows = await fetchSince(since);
    if (rows.length === 0) return;
    await this.exclusive(async () => {
      // Read pending ids after the fetch so writes made during the request are respected.
      const pending = new Set((await this.local.peekOutbox()).map((e) => mutationTargetId(e.mutation)));
      await this.local.apply(toChange(rows.filter((r) => !pending.has(r.id))));
      let max = cursor === null ? 0 : Date.parse(cursor);
      for (const r of rows) max = Math.max(max, Date.parse(r.updated_at));
      await this.local.setCursor(table, new Date(max).toISOString());
    });
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lock.then(fn);
    this.lock = result.catch(() => undefined);
    return result;
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './remote';
export * from './sync';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @linkstash/core test; pnpm --filter @linkstash/core typecheck`
Expected: all tests pass and tsc is clean.

- [ ] **Step 7: Commit**

```powershell
git add packages/core
git commit -m "feat(core): add Remote interface, FakeRemote, and outbox SyncEngine" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Database migration + `fetch-metadata` Edge Function

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `supabase/functions/fetch-metadata/handler.ts` (pure, dependency-free, tested in Node) and `supabase/functions/fetch-metadata/index.ts` (Deno entry)
- Modify: `packages/core/package.json` (dev dependency `@electric-sql/pglite`)
- Test: `packages/core/src/migration.test.ts`, `packages/core/src/fetch-metadata.test.ts`

**Interfaces:**
- Consumes:
  - `PageMetadata`, `parseHtmlMetadata`, `isFetchableUrl` from `supabase/functions/_shared/metadata.ts` (Task 4)
  - The `Link` / `Category` fields (Task 2) and `LIMITS` (Task 2). The SQL checks mirror these limits.
- Produces:
  - Tables `public.categories` and `public.links`, whose columns match `Category` and `Link` exactly. The server owns two columns:
    - `user_id` defaults to `auth.uid()`
    - `updated_at` is set by a trigger on every insert and update
    - Clients never need to send either.
  - Soft-deleting a category (setting `deleted_at`) clears `category_id` on that user's links, which bumps their `updated_at`.
  - RPC `public.increment_visit(link_id uuid)`, callable by `authenticated` only.
  - Row Level Security: each user sees and writes only their own rows. Both tables are in the `supabase_realtime` publication.
  - Edge Function `fetch-metadata` (Task 8 calls it):
    - Request: `POST {"url": string}` with header `Authorization: Bearer <user access token>`.
    - Responses:
      - `200 PageMetadata`, with nulls when the page can't be read
      - `400` for a bad or non-public URL
      - `401` with no valid user
      - `405` for other methods
    - CORS is open to any origin.
  - `handler.ts` exports:
    - `type FetchLike = (url: string, init: RequestInit) => Promise<Response>`
    - `interface HandlerDeps { authenticate(token): Promise<string | null>; fetch: FetchLike; timeoutMs?: number; maxBytes?: number }`
    - `CORS_HEADERS`
    - `createHandler(deps): (req: Request) => Promise<Response>`
    - `supabaseAuthenticator(supabaseUrl, apiKey, fetch): (token: string) => Promise<string | null>`
    - `edgeApiKey(env: (name: string) => string | undefined): string | null`. It returns the `default` key in `SUPABASE_PUBLISHABLE_KEYS`, which Supabase injects as JSON, or falls back to the legacy `SUPABASE_ANON_KEY` that older projects still inject.

- [ ] **Step 1: Add PGlite (Postgres compiled to WASM) for the migration test**

Run: `pnpm --filter @linkstash/core add -D @electric-sql/pglite@^0.6.0`
Expected: `packages/core/package.json` lists it under `devDependencies`. If pnpm prints that it added a `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml`, keep that change.

- [ ] **Step 2: Write the failing migration test**

The test loads the migration into an in-memory Postgres. It first adds stubs for the parts of a Supabase database the migration relies on: the `anon`/`authenticated` roles, `auth.users`, `auth.uid()`, the default grants and the Realtime publication. It then acts as different users by switching role and JWT subject.

`packages/core/src/migration.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0001_init.sql', import.meta.url), 'utf8');

/** The pieces of a Supabase database that the migration relies on. */
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create publication supabase_realtime;
`;

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const CAT = '10000000-0000-4000-8000-000000000001';
const LINK = '20000000-0000-4000-8000-000000000001';

let db: PGlite;

/** Runs fn as a signed-in user, or as the anon role when user is null. */
async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function aliceLink() {
  const [link] = await as(ALICE, () =>
    rows<{ title: string; category_id: string | null; visit_count: number; updated_at: Date }>(
      'select title, category_id, visit_count, updated_at from public.links where id = $1',
      [LINK],
    ),
  );
  return link;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(MIGRATION);
  await db.query('insert into auth.users (id) values ($1), ($2)', [ALICE, BOB]);
  await as(ALICE, async () => {
    await db.query(`insert into public.categories (id, name, color) values ($1, 'Work', '#3b82f6')`, [CAT]);
    await db.query(
      `insert into public.links (id, url, url_key, title, category_id, updated_at)
       values ($1, 'https://a.io/', 'a.io', 'A', $2, '2000-01-01T00:00:00Z')`,
      [LINK, CAT],
    );
  });
});

afterAll(async () => {
  await db.close();
});

describe('0001_init.sql', () => {
  it('fills user_id from the session and stamps updated_at on the server', async () => {
    const [row] = await as(ALICE, () => rows<{ user_id: string }>('select user_id from public.links where id = $1', [LINK]));
    expect(row.user_id).toBe(ALICE);
    expect((await aliceLink()).updated_at.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("hides other users' rows and ignores their writes", async () => {
    const before = await aliceLink();
    await as(BOB, async () => {
      expect(await rows('select id from public.links')).toEqual([]);
      expect(await rows('select id from public.categories')).toEqual([]);
      const update = await db.query(`update public.links set title = 'pwned' where id = $1`, [LINK]);
      expect(update.affectedRows).toBe(0);
      await db.query('select public.increment_visit($1)', [LINK]);
    });
    expect(await aliceLink()).toMatchObject({ title: before.title, visit_count: before.visit_count });
  });

  it('rejects rows written on behalf of another user', async () => {
    await expect(
      as(BOB, () =>
        db.query(`insert into public.links (id, user_id, url, url_key) values (gen_random_uuid(), $1, 'https://b.io/', 'b.io')`, [
          ALICE,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('gives anonymous clients nothing', async () => {
    await as(null, async () => {
      expect(await rows('select id from public.links')).toEqual([]);
      await expect(db.query('select public.increment_visit($1)', [LINK])).rejects.toThrow(/permission denied/);
    });
  });

  it('enforces the same limits as the client', async () => {
    await as(ALICE, async () => {
      await expect(
        db.query(`insert into public.links (id, url, url_key) values (gen_random_uuid(), 'ftp://x.io/', 'x.io')`),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query(`insert into public.categories (id, name, color) values (gen_random_uuid(), 'X', 'blue')`),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query(`insert into public.categories (id, name, color) values (gen_random_uuid(), '', '#3b82f6')`),
      ).rejects.toThrow(/check constraint/);
    });
  });

  it('counts visits and keeps them through an upsert that omits them, as SupabaseRemote sends', async () => {
    const before = await aliceLink();
    await as(ALICE, async () => {
      await db.query('select public.increment_visit($1)', [LINK]);
      await db.query(
        `insert into public.links (id, url, url_key, title) values ($1, 'https://a.io/', 'a.io', 'A2')
         on conflict (id) do update set url = excluded.url, url_key = excluded.url_key, title = excluded.title`,
        [LINK],
      );
    });
    expect(await aliceLink()).toMatchObject({ title: 'A2', visit_count: before.visit_count + 1 });
  });

  it('uncategorizes links when their category is soft-deleted', async () => {
    const before = await aliceLink();
    expect(before.category_id).toBe(CAT);
    await as(ALICE, () => db.query('update public.categories set deleted_at = now() where id = $1', [CAT]));
    const after = await aliceLink();
    expect(after.category_id).toBeNull();
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  it('publishes both tables to Realtime', async () => {
    const tables = await rows<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`,
    );
    expect(tables.map((t) => t.tablename)).toEqual(['categories', 'links']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @linkstash/core test migration`
Expected: FAIL with `ENOENT: no such file or directory` for `0001_init.sql`.

- [ ] **Step 4: Write `supabase/migrations/0001_init.sql`**

```sql
-- Linkstash schema. Run once per project: paste into the Supabase SQL editor and press Run.

create table public.categories (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.links (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (url ~ '^https?://'),
  url_key text not null,
  title text not null default '' check (char_length(title) <= 300),
  custom_title text check (char_length(custom_title) <= 300),
  description text check (char_length(description) <= 1000),
  favicon_url text,
  notes text check (char_length(notes) <= 5000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  category_id uuid references public.categories (id) on delete set null,
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  visit_count integer not null default 0 check (visit_count >= 0),
  last_visited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Pull queries (updated_at > cursor), duplicate lookup by url_key, and category clean-up.
create index categories_user_updated_idx on public.categories (user_id, updated_at);
create index links_user_updated_idx on public.links (user_id, updated_at);
create index links_user_url_key_idx on public.links (user_id, url_key) where deleted_at is null;
create index links_category_idx on public.links (category_id);

-- The server owns updated_at so every client sees one clock. clock_timestamp() (not now())
-- keeps it close to commit time, which the clients' 5 s pull overlap relies on.
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger categories_set_updated_at before insert or update on public.categories
  for each row execute function public.set_updated_at();
create trigger links_set_updated_at before insert or update on public.links
  for each row execute function public.set_updated_at();

-- Deletes are soft (deleted_at), so "on delete set null" never fires; do the same by hand.
create function public.clear_deleted_category() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.links set category_id = null
  where category_id = new.id and user_id = new.user_id;
  return null;
end;
$$;

create trigger categories_clear_deleted after update of deleted_at on public.categories
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.clear_deleted_category();

-- Atomic visit counter, so visits from several devices add up instead of overwriting each other.
-- security invoker: row level security still limits it to the caller's own links.
create function public.increment_visit(link_id uuid) returns void
language sql
security invoker
set search_path = ''
as $$
  update public.links
  set visit_count = visit_count + 1, last_visited_at = now()
  where id = link_id;
$$;

revoke execute on function public.increment_visit(uuid) from public, anon;
grant execute on function public.increment_visit(uuid) to authenticated;

alter table public.categories enable row level security;
alter table public.links enable row level security;

create policy "Users read own categories" on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own categories" on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own categories" on public.categories
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own categories" on public.categories
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users read own links" on public.links
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own links" on public.links
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own links" on public.links
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own links" on public.links
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.categories, public.links to authenticated;

alter publication supabase_realtime add table public.categories, public.links;
```

- [ ] **Step 5: Run the migration test**

Run: `pnpm --filter @linkstash/core test migration`
Expected: 8 tests pass.

- [ ] **Step 6: Write the failing Edge Function handler test**

`packages/core/src/fetch-metadata.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import {
  createHandler,
  edgeApiKey,
  supabaseAuthenticator,
  type FetchLike,
  type HandlerDeps,
} from '../../../supabase/functions/fetch-metadata/handler.ts';

const EMPTY = { title: null, description: null, faviconUrl: null };
const PAGE =
  '<html><head><title>Hello</title><meta name="description" content="World"><link rel="icon" href="/i.png"></head></html>';

const html = (body: BodyInit = PAGE, type = 'text/html; charset=utf-8') =>
  new Response(body, { headers: { 'Content-Type': type } });

const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location } });

function post(body: unknown, token: string | null = 'good-token'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('https://fn.test/fetch-metadata', { method: 'POST', headers, body: JSON.stringify(body) });
}

/** Builds a handler whose fetch answers with the given responses, in order. */
function setup(responses: (Response | Error)[], options: Partial<HandlerDeps> = {}) {
  const fetch = vi.fn<FetchLike>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  const authenticate = vi.fn(async (token: string) => (token === 'good-token' ? 'user-1' : null));
  return { fetch, authenticate, handle: createHandler({ fetch, authenticate, ...options }) };
}

async function metadataFor(responses: (Response | Error)[], options: Partial<HandlerDeps> = {}) {
  const res = await setup(responses, options).handle(post({ url: 'https://a.io/page' }));
  expect(res.status).toBe(200);
  return res.json();
}

describe('fetch-metadata handler', () => {
  it('answers CORS preflight and rejects other methods', async () => {
    const { handle } = setup([]);
    const preflight = await handle(new Request('https://fn.test/', { method: 'OPTIONS' }));
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect((await handle(new Request('https://fn.test/'))).status).toBe(405);
  });

  it('requires a valid user token before fetching anything', async () => {
    const { handle, fetch, authenticate } = setup([]);
    expect((await handle(post({ url: 'https://a.io/' }, null))).status).toBe(401);
    expect((await handle(post({ url: 'https://a.io/' }, 'bad-token'))).status).toBe(401);
    expect(authenticate).toHaveBeenCalledWith('bad-token');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects missing, non-http, and private URLs without fetching', async () => {
    const { handle, fetch } = setup([]);
    for (const url of [undefined, 42, 'file:///etc/passwd', 'http://127.0.0.1/admin', 'http://10.0.0.1/']) {
      const res = await handle(post({ url }));
      expect(res.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns parsed metadata with CORS headers', async () => {
    const { handle, fetch } = setup([html()]);
    const res = await handle(post({ url: 'https://a.io/page' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ title: 'Hello', description: 'World', faviconUrl: 'https://a.io/i.png' });
    expect(fetch).toHaveBeenCalledWith('https://a.io/page', expect.objectContaining({ redirect: 'manual' }));
  });

  it('follows public redirects and resolves relative URLs against the final page', async () => {
    expect(await metadataFor([redirect('https://b.io/x'), html()])).toMatchObject({ faviconUrl: 'https://b.io/i.png' });
  });

  it('refuses redirects to private hosts and gives up after 5 redirects', async () => {
    const internal = setup([redirect('http://169.254.169.254/latest/meta-data')]);
    expect(await (await internal.handle(post({ url: 'https://a.io/' }))).json()).toEqual(EMPTY);
    expect(internal.fetch).toHaveBeenCalledTimes(1);

    const loop = setup(Array.from({ length: 6 }, (_, i) => redirect(`https://a.io/${i}`)));
    expect(await (await loop.handle(post({ url: 'https://a.io/' }))).json()).toEqual(EMPTY);
    expect(loop.fetch).toHaveBeenCalledTimes(6);
  });

  it('returns empty metadata for non-HTML responses, HTTP errors, and network errors', async () => {
    expect(await metadataFor([html('{}', 'application/json')])).toEqual(EMPTY);
    expect(await metadataFor([new Response('nope', { status: 404, headers: { 'Content-Type': 'text/html' } })])).toEqual(EMPTY);
    expect(await metadataFor([new Error('ECONNRESET')])).toEqual(EMPTY);
  });

  it('times out slow pages', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const handle = createHandler({ fetch: hang, authenticate: async () => 'user-1', timeoutMs: 20 });
    expect(await (await handle(post({ url: 'https://a.io/' }))).json()).toEqual(EMPTY);
  });

  it('stops reading the body after maxBytes', async () => {
    let chunks = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new TextEncoder().encode('<head><title>Big</title>'.padEnd(1000, ' ')));
      },
    });
    expect(await metadataFor([html(endless)], { maxBytes: 4096 })).toMatchObject({ title: 'Big' });
    expect(chunks).toBeLessThan(10);
  });
});

describe('supabaseAuthenticator', () => {
  it('asks Supabase Auth who owns the token', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ id: 'user-1' })));
    const authenticate = supabaseAuthenticator('https://p.supabase.co/', 'sb_publishable_key', fetch);
    expect(await authenticate('tok')).toBe('user-1');
    expect(fetch).toHaveBeenCalledWith('https://p.supabase.co/auth/v1/user', {
      headers: { Authorization: 'Bearer tok', apikey: 'sb_publishable_key' },
    });
    fetch.mockResolvedValueOnce(new Response('{"message":"invalid JWT"}', { status: 401 }));
    expect(await authenticate('expired')).toBeNull();
  });
});

describe('edgeApiKey', () => {
  const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

  it('prefers the default publishable key', () => {
    const env = envOf({
      SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_abc","mobile":"sb_publishable_xyz"}',
      SUPABASE_ANON_KEY: 'legacy-jwt',
    });
    expect(edgeApiKey(env)).toBe('sb_publishable_abc');
  });

  it('falls back to the legacy anon key when there is no usable publishable key', () => {
    expect(edgeApiKey(envOf({ SUPABASE_ANON_KEY: 'legacy-jwt' }))).toBe('legacy-jwt');
    expect(edgeApiKey(envOf({ SUPABASE_PUBLISHABLE_KEYS: 'not json', SUPABASE_ANON_KEY: 'legacy-jwt' }))).toBe('legacy-jwt');
    expect(edgeApiKey(envOf({ SUPABASE_PUBLISHABLE_KEYS: '{"mobile":"x"}', SUPABASE_ANON_KEY: 'legacy-jwt' }))).toBe('legacy-jwt');
  });

  it('returns null when neither key is set', () => {
    expect(edgeApiKey(envOf({}))).toBeNull();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @linkstash/core test fetch-metadata`
Expected: FAIL. Vite can't resolve the import `../../../supabase/functions/fetch-metadata/handler.ts`.

- [ ] **Step 8: Implement `supabase/functions/fetch-metadata/handler.ts`**

The handler has no imports beyond the shared parser, so it runs in Deno (deployed) and Node (tests). It follows redirects by hand so each hop gets the same public-host check as the first URL.

```ts
import { isFetchableUrl, parseHtmlMetadata, type PageMetadata } from '../_shared/metadata.ts';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HandlerDeps {
  /** Returns the user id for a valid access token, otherwise null. */
  authenticate(token: string): Promise<string | null>;
  fetch: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const EMPTY: PageMetadata = { title: null, description: null, faviconUrl: null };
const MAX_REDIRECTS = 5;
const HTML_TYPE = /^\s*(text\/html|application\/xhtml\+xml)/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** The key the function sends to Supabase Auth: the default publishable key, or the legacy anon key on older projects. */
export function edgeApiKey(env: (name: string) => string | undefined): string | null {
  try {
    const keys: unknown = JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') ?? 'null');
    if (keys && typeof keys === 'object' && 'default' in keys && typeof keys.default === 'string' && keys.default) {
      return keys.default;
    }
  } catch {
    // Malformed JSON: use the legacy key below.
  }
  return env('SUPABASE_ANON_KEY') || null;
}

/** Resolves an access token to a user id through Supabase Auth (the same call as auth.getUser(token)). */
export function supabaseAuthenticator(supabaseUrl: string, apiKey: string, fetch: FetchLike) {
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`;
  return async (token: string): Promise<string | null> => {
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, apikey: apiKey } });
    if (!res.ok) return null;
    const user: unknown = await res.json();
    return user && typeof user === 'object' && 'id' in user && typeof user.id === 'string' ? user.id : null;
  };
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const timeoutMs = deps.timeoutMs ?? 5000;
  const maxBytes = deps.maxBytes ?? 1_000_000;

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
    const userId = token ? await deps.authenticate(token).catch(() => null) : null;
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    const body: unknown = await req.json().catch(() => null);
    const url = body && typeof body === 'object' && 'url' in body ? body.url : undefined;
    if (typeof url !== 'string' || !isFetchableUrl(url)) return json({ error: 'Invalid url' }, 400);

    try {
      return json(await readPage(url, deps.fetch, timeoutMs, maxBytes));
    } catch {
      return json(EMPTY);
    }
  };
}

async function readPage(url: string, fetch: FetchLike, timeoutMs: number, maxBytes: number): Promise<PageMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; LinkstashBot/1.0)',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const location = res.headers.get('Location');
        const next = location ? new URL(location, current).href : null;
        if (!next || !isFetchableUrl(next)) return EMPTY;
        current = next;
        continue;
      }
      const type = res.headers.get('Content-Type') ?? '';
      if (!res.ok || !HTML_TYPE.test(type)) {
        await res.body?.cancel();
        return EMPTY;
      }
      return parseHtmlMetadata(await readText(res, type, maxBytes), current);
    }
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

async function readText(res: Response, contentType: string, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const buffer = new Uint8Array(maxBytes);
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, maxBytes - length);
      buffer.set(value.subarray(0, take), length);
      length += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return decoderFor(contentType).decode(buffer.subarray(0, length));
}

function decoderFor(contentType: string): TextDecoder {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}
```

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm --filter @linkstash/core test; pnpm --filter @linkstash/core typecheck`
Expected: all tests pass, including the 13 in `fetch-metadata.test.ts`, and tsc is clean.

- [ ] **Step 10: Write the Deno entry `supabase/functions/fetch-metadata/index.ts`**

Supabase injects `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEYS` into every Edge Function. Projects that still have legacy keys also get `SUPABASE_ANON_KEY`. Supabase is retiring legacy keys, so `edgeApiKey` prefers the publishable key.

```ts
import { createHandler, edgeApiKey, supabaseAuthenticator } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const apiKey = edgeApiKey((name) => Deno.env.get(name));
if (!supabaseUrl || !apiKey) {
  throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEYS (or the legacy SUPABASE_ANON_KEY) must be set');
}

Deno.serve(createHandler({ authenticate: supabaseAuthenticator(supabaseUrl, apiKey, fetch), fetch }));
```

Type-check it with Deno. The first run downloads Deno through npm and takes about 30 s:

Run: `npx -y deno check supabase/functions/fetch-metadata/index.ts`
Expected: `Check …/index.ts` and exit code 0.

The function is deployed with `--no-verify-jwt` (see the README in Task 19). The handler verifies the user itself, and turning the gateway check off lets CORS preflight requests through. It also keeps the function working with Supabase's newer non-JWT API keys.

- [ ] **Step 11: Commit**

```powershell
git add supabase packages/core pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(supabase): add schema migration with RLS and fetch-metadata edge function" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Supabase client, `SupabaseRemote`, metadata client, live smoke test

**Files:**
- Create: `packages/core/src/supabase.ts`, `packages/core/src/supabase-remote.ts`, `packages/core/src/metadata-client.ts`
- Create: `packages/core/vitest.live.config.ts`, `packages/core/src/supabase.live.test.ts`
- Modify: `packages/core/package.json` (dependency, dev dependency, `test:live` script), `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Test: `packages/core/src/supabase-remote.test.ts`

**Interfaces:**
- Consumes:
  - `Remote`, `RemoteError`, `errorKind` (Task 6)
  - `Link`, `Category`, `SyncTable` (Task 2), `PageMetadataInput` (Task 2)
  - `makeLink`, `makeCategory` (Task 5)
  - The tables, the RPC `increment_visit(link_id)` and the `fetch-metadata` function contract (Task 7)
- Produces (`@linkstash/core`):
  - `interface AuthStorage { getItem(key): string | null | Promise<string | null>; setItem(key, value): void | Promise<void>; removeItem(key): void | Promise<void> }`
  - `createLinkstashClient(url: string, publishableKey: string, authStorage?: AuthStorage): SupabaseClient`. It persists and auto-refreshes the session and never reads tokens from the page URL.
  - Type re-exports `SupabaseClient`, `Session`, `User` from supabase-js, plus the function `isAuthRetryableFetchError(error: unknown): boolean`. Apps import these from `@linkstash/core`, not from supabase-js.
  - `class SupabaseRemote implements Remote`, built with `new SupabaseRemote(client, { pageSize? })` (default page size 1000). On top of `Remote` it has:
    - `findLinkByUrlKey(urlKey: string): Promise<Link | null>`: the newest live link with that key
    - `listCategories(): Promise<Category[]>`: live categories sorted by name
    - Every method throws `RemoteError`. Its status is the HTTP status, or `0` when the request never reached the server.
  - `fetchMetadata(client: SupabaseClient, url: string): Promise<PageMetadataInput | null>`. It returns `null` on any failure and never throws.
  - Root script `pnpm test:live` runs `supabase.live.test.ts` against the real project. It reads `apps/web/.env` and `apps/web/.env.local`.

- [ ] **Step 1: Add dependencies, the live-test script and the tsconfig entry**

Run:
```powershell
pnpm --filter @linkstash/core add @supabase/supabase-js@^2.119.2
pnpm --filter @linkstash/core add -D vite@^8.3.8
```

In `packages/core/package.json`, make `scripts` read:
```json
"scripts": {
  "test": "vitest run",
  "test:live": "vitest run -c vitest.live.config.ts",
  "typecheck": "tsc -p ."
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "vitest.config.ts", "vitest.live.config.ts"]
}
```

- [ ] **Step 2: Write the failing unit test**

The test builds a real supabase-js client whose `fetch` is a fake server. The fake records each request and replies from a queue, so the test checks the exact HTTP requests `SupabaseRemote` produces. Two facts about supabase-js shape the test:
- It reports a failed `fetch` as a result with `status: 0` instead of throwing.
- It retries GET requests after network failures, with delays. The network-failure test therefore uses a POST (`incrementVisit`), which supabase-js does not retry.

`packages/core/src/supabase-remote.test.ts`:
```ts
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { fetchMetadata } from './metadata-client';
import { errorKind, RemoteError } from './remote';
import { SupabaseRemote } from './supabase-remote';
import { makeCategory, makeLink } from './testing';

interface Recorded {
  method: string;
  path: string;
  params: URLSearchParams;
  prefer: string | null;
  body: unknown;
}

type Reply = { status: number; body?: unknown } | Error;

/** A supabase-js client backed by a fake server that records requests and answers from a queue (default: 200 []). */
function fakeSupabase(...replies: Reply[]) {
  const requests: Recorded[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = await req.text();
    requests.push({
      method: req.method,
      path: url.pathname,
      params: url.searchParams,
      prefer: req.headers.get('prefer'),
      body: text ? JSON.parse(text) : undefined,
    });
    const reply = replies.shift() ?? { status: 200, body: [] };
    if (reply instanceof Error) throw reply;
    const body = reply.body === undefined ? null : JSON.stringify(reply.body);
    return new Response(body, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const client = createClient('https://proj.supabase.co', 'sb_publishable_key', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, requests };
}

// Postgres returns microsecond timestamps. They must round-trip unchanged.
const T1 = '2026-01-01T00:00:01.000001+00:00';
const T2 = '2026-01-01T00:00:02.000002+00:00';

describe('SupabaseRemote pulls', () => {
  it('pulls all rows oldest first in one request when there is no cursor', async () => {
    const rows = [makeLink({ updated_at: T1 }), makeLink({ updated_at: T2 })];
    const { client, requests } = fakeSupabase({ status: 200, body: rows });

    expect(await new SupabaseRemote(client).pullLinks(null)).toEqual(rows);

    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/rest/v1/links');
    expect(req.params.get('updated_at')).toBeNull();
    expect(req.params.get('order')).toBe('updated_at.asc,id.asc');
    expect(req.params.get('limit')).toBe('1000');
  });

  it('pages after the last (updated_at, id) so rows sharing a timestamp are not skipped', async () => {
    const a = makeCategory({ updated_at: T1 });
    const b = makeCategory({ updated_at: T2 });
    const c = makeCategory({ updated_at: T2 });
    const { client, requests } = fakeSupabase({ status: 200, body: [a, b] }, { status: 200, body: [c] });
    const since = '2026-01-01T00:00:00.000Z';

    expect(await new SupabaseRemote(client, { pageSize: 2 }).pullCategories(since)).toEqual([a, b, c]);

    expect(requests.map((r) => r.path)).toEqual(['/rest/v1/categories', '/rest/v1/categories']);
    expect(requests[0].params.get('updated_at')).toBe(`gt.${since}`);
    expect(requests[0].params.get('or')).toBeNull();
    expect(requests[0].params.get('limit')).toBe('2');
    expect(requests[1].params.get('updated_at')).toBe(`gt.${since}`);
    expect(requests[1].params.get('or')).toBe(`(updated_at.gt."${T2}",and(updated_at.eq."${T2}",id.gt."${b.id}"))`);
  });

  it('asks for one more page after a full page and stops on an empty one', async () => {
    const rows = [makeLink(), makeLink()];
    const { client, requests } = fakeSupabase({ status: 200, body: rows }, { status: 200, body: [] });

    expect(await new SupabaseRemote(client, { pageSize: 2 }).pullLinks(null)).toEqual(rows);
    expect(requests).toHaveLength(2);
  });
});

describe('SupabaseRemote writes', () => {
  it('upserts links on id without the columns the server owns', async () => {
    const link = makeLink({ user_id: 'user-1', visit_count: 7, last_visited_at: T1, updated_at: T2, tags: ['a'] });
    const { client, requests } = fakeSupabase({ status: 201 });

    await new SupabaseRemote(client).upsertLink(link);

    const [req] = requests;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/rest/v1/links');
    expect(req.params.get('on_conflict')).toBe('id');
    expect(req.prefer).toContain('resolution=merge-duplicates');
    const { user_id, visit_count, last_visited_at, updated_at, ...writable } = link;
    expect(req.body).toEqual(writable);
  });

  it('upserts categories on id without user_id and updated_at', async () => {
    const category = makeCategory({ user_id: 'user-1', updated_at: T2 });
    const { client, requests } = fakeSupabase({ status: 201 });

    await new SupabaseRemote(client).upsertCategory(category);

    const [req] = requests;
    expect(req.path).toBe('/rest/v1/categories');
    expect(req.params.get('on_conflict')).toBe('id');
    const { user_id, updated_at, ...writable } = category;
    expect(req.body).toEqual(writable);
  });

  it('records a visit through the increment_visit RPC', async () => {
    const { client, requests } = fakeSupabase({ status: 204 });

    await new SupabaseRemote(client).incrementVisit('link-1');

    expect(requests[0]).toMatchObject({ method: 'POST', path: '/rest/v1/rpc/increment_visit', body: { link_id: 'link-1' } });
  });
});

describe('SupabaseRemote errors', () => {
  it.each([
    [401, 'auth'],
    [403, 'fatal'],
    [409, 'fatal'],
    [429, 'retryable'],
    [503, 'retryable'],
  ] as const)('turns HTTP %i into a RemoteError the sync engine treats as %s', async (status, kind) => {
    const { client } = fakeSupabase({ status, body: { code: 'X', message: 'boom' } });

    const error = await new SupabaseRemote(client).upsertLink(makeLink()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).status).toBe(status);
    expect((error as RemoteError).message).toContain('boom');
    expect(errorKind(error)).toBe(kind);
  });

  it('reports a network failure as status 0, which is retryable', async () => {
    const { client } = fakeSupabase(new TypeError('fetch failed'));

    const error = await new SupabaseRemote(client).incrementVisit('link-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).status).toBe(0);
    expect(errorKind(error)).toBe('retryable');
  });
});

describe('SupabaseRemote lookups for the extension', () => {
  it('finds the newest live link with a url_key, or null', async () => {
    const link = makeLink();
    const { client, requests } = fakeSupabase({ status: 200, body: [link] }, { status: 200, body: [] });
    const remote = new SupabaseRemote(client);

    expect(await remote.findLinkByUrlKey(link.url_key)).toEqual(link);
    expect(await remote.findLinkByUrlKey('nothing.example')).toBeNull();

    const params = requests[0].params;
    expect(params.get('url_key')).toBe(`eq.${link.url_key}`);
    expect(params.get('deleted_at')).toBe('is.null');
    expect(params.get('order')).toBe('updated_at.desc');
    expect(params.get('limit')).toBe('1');
  });

  it('lists live categories by name', async () => {
    const categories = [makeCategory({ name: 'A' }), makeCategory({ name: 'B' })];
    const { client, requests } = fakeSupabase({ status: 200, body: categories });

    expect(await new SupabaseRemote(client).listCategories()).toEqual(categories);

    expect(requests[0].path).toBe('/rest/v1/categories');
    expect(requests[0].params.get('deleted_at')).toBe('is.null');
    expect(requests[0].params.get('order')).toBe('name.asc');
  });
});

describe('fetchMetadata', () => {
  it('posts the URL to the fetch-metadata function and keeps only string fields', async () => {
    const { client, requests } = fakeSupabase({
      status: 200,
      body: { title: 'Example', description: 42, faviconUrl: 'https://example.com/favicon.ico', extra: true },
    });

    expect(await fetchMetadata(client, 'https://example.com/')).toEqual({
      title: 'Example',
      description: null,
      faviconUrl: 'https://example.com/favicon.ico',
    });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/functions/v1/fetch-metadata',
      body: { url: 'https://example.com/' },
    });
  });

  it('returns null when the function rejects the request or cannot be reached', async () => {
    const { client } = fakeSupabase({ status: 401, body: { error: 'Unauthorized' } }, new TypeError('fetch failed'));

    expect(await fetchMetadata(client, 'https://example.com/')).toBeNull();
    expect(await fetchMetadata(client, 'https://example.com/')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @linkstash/core test supabase-remote`
Expected: FAIL. Vite cannot resolve `./metadata-client` or `./supabase-remote`.

- [ ] **Step 4: Write `packages/core/src/supabase.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type { Session, SupabaseClient, User } from '@supabase/supabase-js';
/** True when an auth call failed because the server could not be reached, so the session may still be valid. */
export { isAuthRetryableFetchError } from '@supabase/supabase-js';

/** Where supabase-js keeps the session: localStorage on the web, browser.storage.local in the extension. */
export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

// Not named `storage`: the extension build (WXT) adds an import for any bare identifier that shares a name with one of its APIs.
export function createLinkstashClient(url: string, publishableKey: string, authStorage?: AuthStorage): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Email + password only, so there are never tokens in the URL to pick up.
      detectSessionInUrl: false,
      ...(authStorage ? { storage: authStorage } : {}),
    },
  });
}
```

- [ ] **Step 5: Write `packages/core/src/supabase-remote.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { RemoteError, type Remote } from './remote';
import type { Category, Link, SyncTable } from './schema';

const DEFAULT_PAGE_SIZE = 1000;

/** The part of a supabase-js query result this module reads. */
interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  status: number;
}

/** Awaits a supabase-js query and turns any failure into a RemoteError. Status 0 means the server was never reached. */
async function run(operation: string, query: PromiseLike<QueryResult>): Promise<unknown> {
  let result: QueryResult;
  try {
    result = await query;
  } catch (error) {
    throw new RemoteError(`${operation}: ${error instanceof Error ? error.message : String(error)}`, 0);
  }
  if (result.error) throw new RemoteError(`${operation}: ${result.error.message}`, result.status);
  return result.data;
}

/**
 * The link columns a client may write. The server owns user_id (default auth.uid()) and updated_at (trigger),
 * and increment_visit owns visit_count and last_visited_at, so re-saving a link never resets its visits.
 */
function linkPayload(row: Link) {
  return {
    id: row.id,
    url: row.url,
    url_key: row.url_key,
    title: row.title,
    custom_title: row.custom_title,
    description: row.description,
    favicon_url: row.favicon_url,
    notes: row.notes,
    tags: row.tags,
    category_id: row.category_id,
    is_favorite: row.is_favorite,
    is_archived: row.is_archived,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

function categoryPayload(row: Category) {
  return { id: row.id, name: row.name, color: row.color, created_at: row.created_at, deleted_at: row.deleted_at };
}

export interface SupabaseRemoteOptions {
  /** Rows per pull request. Tests pass a small value to exercise paging. */
  pageSize?: number;
}

export class SupabaseRemote implements Remote {
  private readonly client: SupabaseClient;
  private readonly pageSize: number;

  constructor(client: SupabaseClient, options: SupabaseRemoteOptions = {}) {
    this.client = client;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  pullLinks(since: string | null): Promise<Link[]> {
    return this.pull<Link>('links', since);
  }

  pullCategories(since: string | null): Promise<Category[]> {
    return this.pull<Category>('categories', since);
  }

  async upsertLink(row: Link): Promise<void> {
    await run('save link', this.client.from('links').upsert(linkPayload(row), { onConflict: 'id' }));
  }

  async upsertCategory(row: Category): Promise<void> {
    await run('save category', this.client.from('categories').upsert(categoryPayload(row), { onConflict: 'id' }));
  }

  async incrementVisit(id: string): Promise<void> {
    await run('record visit', this.client.rpc('increment_visit', { link_id: id }));
  }

  /** The most recently updated live link with this dedupe key. The extension uses it to spot duplicates. */
  async findLinkByUrlKey(urlKey: string): Promise<Link | null> {
    const query = this.client
      .from('links')
      .select('*')
      .eq('url_key', urlKey)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1);
    const rows = (await run('find link', query)) as Link[];
    return rows[0] ?? null;
  }

  /** Live categories sorted by name. The extension has no local store, so it reads them from the server. */
  async listCategories(): Promise<Category[]> {
    const query = this.client.from('categories').select('*').is('deleted_at', null).order('name', { ascending: true });
    return (await run('list categories', query)) as Category[];
  }

  /**
   * Reads rows with updated_at > since, ordered by (updated_at, id), one page at a time. Each page starts
   * after the previous page's last (updated_at, id) pair, so rows sharing a timestamp across a page boundary
   * are neither skipped nor repeated. Values in an `or` filter are double-quoted because they contain `.` and `:`.
   */
  private async pull<T extends { id: string; updated_at: string }>(table: SyncTable, since: string | null): Promise<T[]> {
    const rows: T[] = [];
    let last: T | undefined;
    for (;;) {
      let query = this.client.from(table).select('*');
      if (since !== null) query = query.gt('updated_at', since);
      if (last) {
        const at = `"${last.updated_at}"`;
        query = query.or(`updated_at.gt.${at},and(updated_at.eq.${at},id.gt."${last.id}")`);
      }
      const ordered = query.order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(this.pageSize);
      const page = (await run(`pull ${table}`, ordered)) as T[];
      rows.push(...page);
      if (page.length < this.pageSize) return rows;
      last = page[page.length - 1];
    }
  }
}
```

- [ ] **Step 6: Write `packages/core/src/metadata-client.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageMetadataInput } from './model';

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Asks the fetch-metadata Edge Function for a page's title, description and favicon.
 * Returns null on any failure (function not deployed, signed out, offline). Saving never waits on this.
 */
export async function fetchMetadata(client: SupabaseClient, url: string): Promise<PageMetadataInput | null> {
  try {
    const { data, error } = await client.functions.invoke('fetch-metadata', { body: { url } });
    if (error || typeof data !== 'object' || data === null) return null;
    const meta = data as Record<string, unknown>;
    return { title: text(meta.title), description: text(meta.description), faviconUrl: text(meta.faviconUrl) };
  } catch {
    return null;
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './supabase';
export * from './supabase-remote';
export * from './metadata-client';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @linkstash/core test supabase-remote`
Expected: PASS, 16 tests.

- [ ] **Step 8: Write the live smoke test and its config**

The live test runs only through `pnpm test:live`. The normal `vitest.config.ts` already excludes `*.live.test.ts`. It reuses the web app's env files, so the project URL and key live in one place. It runs in Task 19, once those files exist.

`packages/core/vitest.live.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// apps/web/.env holds the project URL and publishable key; apps/web/.env.local holds SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_EDGE.
const webDir = fileURLToPath(new URL('../../apps/web/', import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.live.test.ts'],
    env: loadEnv('development', webDir, ''),
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

`packages/core/src/supabase.live.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchMetadata } from './metadata-client';
import { createCategory, createLink, parseLinkInput, updateCategory, updateLink } from './model';
import { CATEGORY_COLORS, type Category, type Link } from './schema';
import { createLinkstashClient, type AuthStorage } from './supabase';
import { SupabaseRemote } from './supabase-remote';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Put VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in apps/web/.env, ` +
        'and SMOKE_EMAIL and SMOKE_PASSWORD in apps/web/.env.local.',
    );
  }
  return value;
}

function memoryStorage(): AuthStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

const url = requireEnv('VITE_SUPABASE_URL');
const publishableKey = requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY');
const email = requireEnv('SMOKE_EMAIL');
const password = requireEnv('SMOKE_PASSWORD');

const client = createLinkstashClient(url, publishableKey, memoryStorage());
const remote = new SupabaseRemote(client);
const createdLinks: string[] = [];
const createdCategories: string[] = [];

async function saveCategory(name: string): Promise<Category> {
  const category = createCategory({ name: `${name} ${Date.now()}`, color: CATEGORY_COLORS[0] });
  createdCategories.push(category.id);
  await remote.upsertCategory(category);
  return category;
}

async function saveLink(categoryId: string): Promise<Link> {
  const parsed = parseLinkInput({
    url: `https://example.com/linkstash-smoke/${crypto.randomUUID()}`,
    tags: ['smoke'],
    categoryId,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  const link = createLink(parsed.value);
  createdLinks.push(link.id);
  await remote.upsertLink(link);
  return link;
}

async function pulledLink(id: string): Promise<Link | undefined> {
  return (await remote.pullLinks(null)).find((l) => l.id === id);
}

beforeAll(async () => {
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (!signIn.error) return;
  const signUp = await client.auth.signUp({ email, password });
  if (signUp.error) {
    throw new Error(`Sign-in failed (${signIn.error.message}) and sign-up failed (${signUp.error.message}).`);
  }
  if (!signUp.data.session) {
    throw new Error(
      `Created ${email}, but the project requires email confirmation. Confirm the address from the email, ` +
        'or turn off "Confirm email" in Supabase (Authentication > Sign In / Providers > Email), then rerun.',
    );
  }
});

afterAll(async () => {
  if (createdLinks.length > 0) await client.from('links').delete().in('id', createdLinks);
  if (createdCategories.length > 0) await client.from('categories').delete().in('id', createdCategories);
  await client.auth.signOut();
});

describe('live Supabase project', () => {
  it('round-trips a category and a link, and keeps the visit count when the link is saved again', async () => {
    const category = await saveCategory('Smoke');
    const link = await saveLink(category.id);
    await remote.incrementVisit(link.id);
    await remote.incrementVisit(link.id);
    await remote.upsertLink(updateLink(link, { is_favorite: true }));

    const saved = await pulledLink(link.id);
    const { data } = await client.auth.getSession();
    expect(saved).toMatchObject({
      url: link.url,
      url_key: link.url_key,
      category_id: category.id,
      tags: ['smoke'],
      is_favorite: true,
      visit_count: 2,
      user_id: data.session?.user.id,
    });
    expect(saved?.last_visited_at).not.toBeNull();
    expect(await remote.findLinkByUrlKey(link.url_key)).toMatchObject({ id: link.id });
    expect((await remote.listCategories()).map((c) => c.id)).toContain(category.id);
  });

  it('uncategorizes links when their category is soft-deleted', async () => {
    const category = await saveCategory('Smoke delete');
    const link = await saveLink(category.id);

    await remote.upsertCategory(updateCategory(category, { deleted_at: new Date().toISOString() }));

    expect((await pulledLink(link.id))?.category_id).toBeNull();
    expect((await remote.listCategories()).map((c) => c.id)).not.toContain(category.id);
    const tombstone = (await remote.pullCategories(null)).find((c) => c.id === category.id);
    expect(tombstone?.deleted_at).not.toBeNull();
  });

  it('shows nothing to a signed-out client', async () => {
    const anon = createLinkstashClient(url, publishableKey, memoryStorage());
    const { data } = await anon.from('links').select('id').limit(1);
    expect(data ?? []).toEqual([]);
    expect(await fetchMetadata(anon, 'https://example.com/')).toBeNull();
  });

  it.runIf(process.env.SMOKE_EDGE === '1')('fetches page metadata through the Edge Function', async () => {
    const meta = await fetchMetadata(client, 'https://example.com/');
    expect(meta?.title).toBe('Example Domain');
  });
});
```

- [ ] **Step 9: Run all core tests and typecheck**

Run: `pnpm --filter @linkstash/core test; pnpm --filter @linkstash/core typecheck`
Expected: all tests pass (the live test is not collected), and tsc is clean, including the live test and its config.

- [ ] **Step 10: Commit**

```powershell
git add packages/core pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(core): add Supabase client, SupabaseRemote, and live smoke test" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Shared UI package (`packages/ui`)

Both the PWA and the extension popup use these forms, so they live in one package. They are styled with Tailwind utility classes. Each app's Tailwind build scans `packages/ui/src` (Tasks 10 and 15), so the package itself ships no CSS.

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/styles.ts`, `ColorDot.tsx`, `Field.tsx`, `CategoryPicker.tsx`, `LinkForm.tsx`, `AuthForm.tsx`, `index.ts`
- Test: `packages/ui/src/LinkForm.test.tsx`, `packages/ui/src/AuthForm.test.tsx`

**Interfaces:**
- Consumes (`@linkstash/core`): `Category`, `Link`, `PageMetadataInput`, `ParsedLinkInput`, `parseLinkInput`, `parseTagString`, `formatTags`, `activeCategories`. From `@linkstash/core/testing` (tests only): `makeCategory`.
- Produces (`@linkstash/ui`):
  - Class strings: `inputClass`, `buttonClass`, `secondaryButtonClass`, `labelClass`
  - `ColorDot({ color: string | null | undefined, className?: string })`
  - `Field({ id, label, hint?, children })`: a label plus its control
  - `CategoryPicker({ id, categories: readonly Category[], value: string, onChange(value: string), disabled? })`
    - `''` means "No category".
    - Only active categories are listed, sorted by name.
    - A `value` that is not an active category shows as "No category".
  - `LinkFormValues { url, customTitle, categoryId, tags, notes }`: all strings; `tags` is comma-separated
  - `linkFormValues(link: Link): LinkFormValues`: the starting values for editing a saved link (`null` fields become `''`)
  - `LinkForm` props:
    ```
    {
      initial?: Partial<LinkFormValues>,
      metadata?: PageMetadataInput,
      categories: readonly Category[],
      submitLabel?: string,
      busy?: boolean,
      urlReadOnly?: boolean,
      titlePlaceholder?: string,
      onSubmit(input: ParsedLinkInput): void | Promise<void>,
      onCancel?(): void,
    }
    ```
    - `initial` is read once, on mount. Remount with a React `key` to reset it.
    - `metadata` is merged into the parsed input as page title, description and favicon.
    - A category that is no longer active is submitted as `null`.
    - Validation errors, and errors thrown by `onSubmit`, render in `role="alert"`.
  - `AuthResult { error?: string; info?: string }`, `MIN_PASSWORD_LENGTH` (6)
  - `AuthForm({ title?, onSignIn(email, password): Promise<AuthResult>, onSignUp(email, password): Promise<AuthResult> })`
    - Errors render in `role="alert"`; info renders in `role="status"`.

- [ ] **Step 1: Create the package**

`packages/ui/package.json`:
```json
{
  "name": "@linkstash/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@linkstash/core": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.3.1"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.2",
    "@testing-library/react": "^16.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^6.3.0",
    "jsdom": "^31.0.1",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "typescript": "^7.0.2",
    "vitest": "^5.1.1"
  }
}
```

`packages/ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src", "vitest.config.ts"]
}
```

`globals: true` lets React Testing Library register its automatic `cleanup` after each test. The tests still import `describe`/`it`/`expect` from `vitest` explicitly.

`packages/ui/vitest.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.tsx'],
  },
});
```

Run: `pnpm install`
Expected: it completes, and `packages/ui/node_modules/@linkstash/core` links to `packages/core`.

- [ ] **Step 2: Write the failing tests**

`packages/ui/src/LinkForm.test.tsx`:
```tsx
import { makeCategory } from '@linkstash/core/testing';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkForm } from './LinkForm';

const reading = makeCategory({ id: 'cat-reading', name: 'Reading' });
const archived = makeCategory({ id: 'cat-old', name: 'Old', deleted_at: '2026-01-02T00:00:00.000Z' });
const recipes = makeCategory({ id: 'cat-recipes', name: 'Recipes' });

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('LinkForm', () => {
  it('submits normalized input', async () => {
    const onSubmit = vi.fn();
    render(<LinkForm categories={[reading, recipes]} onSubmit={onSubmit} />);

    type('URL', 'example.com/a');
    type('Title', '  My title ');
    type('Category', 'cat-recipes');
    type('Tags', 'Read, #Later, read');
    type('Notes', 'remember this');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      url: 'https://example.com/a',
      customTitle: 'My title',
      categoryId: 'cat-recipes',
      tags: ['read', 'later'],
      notes: 'remember this',
      title: null,
      description: null,
      faviconUrl: null,
    });
  });

  it('shows a validation error and does not submit', () => {
    const onSubmit = vi.fn();
    render(<LinkForm categories={[]} onSubmit={onSubmit} />);

    type('URL', 'ftp://example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid http(s) URL');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills values and merges page metadata', async () => {
    const onSubmit = vi.fn();
    render(
      <LinkForm
        categories={[reading]}
        initial={{ url: 'https://news.example/story', categoryId: 'cat-reading', tags: 'news' }}
        metadata={{ title: 'Big story', description: 'All about it', faviconUrl: 'https://news.example/f.ico' }}
        urlReadOnly
        submitLabel="Save page"
        onSubmit={onSubmit}
      />,
    );

    expect((screen.getByLabelText('URL') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('cat-reading');
    fireEvent.click(screen.getByRole('button', { name: 'Save page' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://news.example/story',
      customTitle: null,
      categoryId: 'cat-reading',
      tags: ['news'],
      title: 'Big story',
      description: 'All about it',
      faviconUrl: 'https://news.example/f.ico',
    });
  });

  it('lists only active categories and drops a deleted one on submit', async () => {
    const onSubmit = vi.fn();
    render(
      <LinkForm
        categories={[recipes, archived, reading]}
        initial={{ url: 'https://a.example/', categoryId: 'cat-old' }}
        onSubmit={onSubmit}
      />,
    );

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['No category', 'Reading', 'Recipes']);
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ categoryId: null });
  });

  it('shows an error thrown by onSubmit and lets the user retry', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(undefined);
    render(<LinkForm categories={[]} initial={{ url: 'https://a.example/' }} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Network down');

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('disables saving while busy and offers cancel', () => {
    const onCancel = vi.fn();
    render(<LinkForm categories={[]} busy onSubmit={vi.fn()} onCancel={onCancel} />);

    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

`packages/ui/src/AuthForm.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthForm } from './AuthForm';

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('AuthForm', () => {
  it('signs in with a trimmed email and shows the returned error', async () => {
    const onSignIn = vi.fn().mockResolvedValue({ error: 'Invalid login credentials' });
    const onSignUp = vi.fn();
    render(<AuthForm onSignIn={onSignIn} onSignUp={onSignUp} />);

    fill('  me@example.com ', 'secret123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid login credentials');
    expect(onSignIn).toHaveBeenCalledWith('me@example.com', 'secret123');
    expect(onSignUp).not.toHaveBeenCalled();
  });

  it('switches to sign-up and shows the returned info', async () => {
    const onSignUp = vi.fn().mockResolvedValue({ info: 'Check your email to confirm your account.' });
    render(<AuthForm onSignIn={vi.fn()} onSignUp={onSignUp} />);

    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    fill('new@example.com', 'secret123');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect((await screen.findByRole('status')).textContent).toBe('Check your email to confirm your account.');
    expect(onSignUp).toHaveBeenCalledWith('new@example.com', 'secret123');
  });

  it('validates locally before calling the server', () => {
    const onSignIn = vi.fn();
    render(<AuthForm onSignIn={onSignIn} onSignUp={vi.fn()} />);

    fill('me@example.com', '123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('alert').textContent).toBe('Enter your email and a password of at least 6 characters');
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('shows an error when the callback throws', async () => {
    const onSignIn = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    render(<AuthForm onSignIn={onSignIn} onSignUp={vi.fn()} />);

    fill('me@example.com', 'secret123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Failed to fetch');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @linkstash/ui test`
Expected: FAIL, because `./LinkForm` and `./AuthForm` cannot be resolved.

- [ ] **Step 4: Implement the components**

`packages/ui/src/styles.ts`:
```ts
export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 read-only:bg-slate-50 read-only:text-slate-500 ' +
  'disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:read-only:bg-slate-800';

export const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white ' +
  'hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium ' +
  'text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ' +
  'disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

export const labelClass = 'block text-xs font-medium text-slate-600 dark:text-slate-400';
```

`packages/ui/src/ColorDot.tsx`:
```tsx
export interface ColorDotProps {
  color: string | null | undefined;
  className?: string;
}

export function ColorDot({ color, className = '' }: ColorDotProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color ?? '#94a3b8' }}
    />
  );
}
```

`packages/ui/src/Field.tsx`:
```tsx
import type { ReactNode } from 'react';
import { labelClass } from './styles';

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
```

`packages/ui/src/CategoryPicker.tsx`:
```tsx
import { activeCategories, type Category } from '@linkstash/core';
import { inputClass } from './styles';

export interface CategoryPickerProps {
  id: string;
  categories: readonly Category[];
  /** '' means "No category". */
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}

export function CategoryPicker({ id, categories, value, onChange, disabled }: CategoryPickerProps) {
  const options = activeCategories(categories);
  const selected = options.some((c) => c.id === value) ? value : '';
  return (
    <select
      id={id}
      className={inputClass}
      value={selected}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">No category</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
```

`packages/ui/src/LinkForm.tsx`:
```tsx
import {
  activeCategories,
  formatTags,
  parseLinkInput,
  parseTagString,
  type Category,
  type Link,
  type PageMetadataInput,
  type ParsedLinkInput,
} from '@linkstash/core';
import { useId, useState, type FormEvent } from 'react';
import { CategoryPicker } from './CategoryPicker';
import { Field } from './Field';
import { buttonClass, inputClass, secondaryButtonClass } from './styles';

export interface LinkFormValues {
  url: string;
  customTitle: string;
  /** '' means "No category". */
  categoryId: string;
  /** Comma-separated. */
  tags: string;
  notes: string;
}

export interface LinkFormProps {
  /** Read once, on mount. Remount with a React `key` to reset the form. */
  initial?: Partial<LinkFormValues>;
  /** Page title, description and favicon, sent along with the form values. */
  metadata?: PageMetadataInput;
  categories: readonly Category[];
  submitLabel?: string;
  busy?: boolean;
  urlReadOnly?: boolean;
  titlePlaceholder?: string;
  onSubmit(input: ParsedLinkInput): void | Promise<void>;
  onCancel?(): void;
}

const EMPTY: LinkFormValues = { url: '', customTitle: '', categoryId: '', tags: '', notes: '' };

/** The starting values for editing a saved link. */
export function linkFormValues(link: Link): LinkFormValues {
  return {
    url: link.url,
    customTitle: link.custom_title ?? '',
    categoryId: link.category_id ?? '',
    tags: formatTags(link.tags),
    notes: link.notes ?? '',
  };
}

export function LinkForm({
  initial,
  metadata,
  categories,
  submitLabel = 'Save',
  busy = false,
  urlReadOnly = false,
  titlePlaceholder = 'Defaults to the page title',
  onSubmit,
  onCancel,
}: LinkFormProps) {
  const id = useId();
  const [values, setValues] = useState<LinkFormValues>(() => ({ ...EMPTY, ...initial }));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (key: keyof LinkFormValues, value: string) => setValues((v) => ({ ...v, [key]: value }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const categoryIsActive = activeCategories(categories).some((c) => c.id === values.categoryId);
    const parsed = parseLinkInput({
      ...metadata,
      url: values.url,
      customTitle: values.customTitle,
      notes: values.notes,
      tags: parseTagString(values.tags),
      categoryId: categoryIsActive ? values.categoryId : null,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit(parsed.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-3">
      <Field id={`${id}-url`} label="URL">
        <input
          id={`${id}-url`}
          className={inputClass}
          inputMode="url"
          autoComplete="url"
          placeholder="https://example.com"
          readOnly={urlReadOnly}
          value={values.url}
          onChange={(e) => update('url', e.target.value)}
        />
      </Field>
      <Field id={`${id}-title`} label="Title">
        <input
          id={`${id}-title`}
          className={inputClass}
          placeholder={titlePlaceholder}
          value={values.customTitle}
          onChange={(e) => update('customTitle', e.target.value)}
        />
      </Field>
      <Field id={`${id}-category`} label="Category">
        <CategoryPicker
          id={`${id}-category`}
          categories={categories}
          value={values.categoryId}
          onChange={(value) => update('categoryId', value)}
        />
      </Field>
      <Field id={`${id}-tags`} label="Tags" hint="Comma-separated, e.g. recipes, to-read">
        <input
          id={`${id}-tags`}
          className={inputClass}
          value={values.tags}
          onChange={(e) => update('tags', e.target.value)}
        />
      </Field>
      <Field id={`${id}-notes`} label="Notes">
        <textarea
          id={`${id}-notes`}
          className={inputClass}
          rows={3}
          value={values.notes}
          onChange={(e) => update('notes', e.target.value)}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={buttonClass} disabled={busy || pending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
```

`packages/ui/src/AuthForm.tsx`:
```tsx
import { useId, useState, type FormEvent } from 'react';
import { Field } from './Field';
import { buttonClass, inputClass } from './styles';

export interface AuthResult {
  error?: string;
  info?: string;
}

export interface AuthFormProps {
  title?: string;
  onSignIn(email: string, password: string): Promise<AuthResult>;
  onSignUp(email: string, password: string): Promise<AuthResult>;
}

/** Supabase Auth's default minimum. */
export const MIN_PASSWORD_LENGTH = 6;

export function AuthForm({ title = 'Sign in to Linkstash', onSignIn, onSignUp }: AuthFormProps) {
  const id = useId();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AuthResult>({});
  const signingUp = mode === 'signUp';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed.includes('@') || password.length < MIN_PASSWORD_LENGTH) {
      setResult({ error: `Enter your email and a password of at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    setPending(true);
    setResult({});
    try {
      setResult(await (signingUp ? onSignUp : onSignIn)(trimmed, password));
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-3">
      <h1 className="text-lg font-semibold">{title}</h1>
      <Field id={`${id}-email`} label="Email">
        <input
          id={`${id}-email`}
          className={inputClass}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field id={`${id}-password`} label="Password">
        <input
          id={`${id}-password`}
          className={inputClass}
          type="password"
          autoComplete={signingUp ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {result.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {result.error}
        </p>
      )}
      {result.info && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {result.info}
        </p>
      )}
      <button type="submit" className={`${buttonClass} w-full`} disabled={pending}>
        {signingUp ? 'Create account' : 'Sign in'}
      </button>
      <button
        type="button"
        className="w-full text-center text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        onClick={() => {
          setMode(signingUp ? 'signIn' : 'signUp');
          setResult({});
        }}
      >
        {signingUp ? 'Already have an account? Sign in' : 'Need an account? Create one'}
      </button>
    </form>
  );
}
```

`packages/ui/src/index.ts`:
```ts
export * from './styles';
export * from './ColorDot';
export * from './Field';
export * from './CategoryPicker';
export * from './LinkForm';
export * from './AuthForm';
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @linkstash/ui test; pnpm --filter @linkstash/ui typecheck`
Expected: PASS, 10 tests, and tsc is clean.

- [ ] **Step 6: Commit**

```powershell
git add packages/ui pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(ui): add shared link, category, and auth form components" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Web app scaffold and Dexie local store

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`
- Create: `apps/web/index.html`, `apps/web/.env.example`
- Create: `apps/web/src/vite-env.d.ts`, `apps/web/src/index.css`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx` (placeholder; Task 15 replaces it)
- Create: `apps/web/src/test/setup.ts`, `apps/web/src/db.ts`
- Test: `apps/web/src/db.test.ts`

**Interfaces:**
- Consumes:
  - From `@linkstash/core`: `LocalStore`, `LocalChange`, `Link`, `Category`, `OutboxEntry`, `SyncTable` (Tasks 2 and 5).
  - From `@linkstash/core/testing`: `describeLocalStoreContract`, `makeLink`, `makeCategory` (Task 5).
- Produces (`apps/web/src/db.ts`):
  - `interface MetaRow { key: string; value: string }`
  - `type LinkstashDb`: a Dexie instance with tables `links` (key `id`), `categories` (key `id`), `outbox` (auto-increment key `seq`), `meta` (key `key`)
  - `openDb(name = 'linkstash'): LinkstashDb`
  - `class DexieLocalStore implements LocalStore`:
    - `constructor(db: LinkstashDb)` and a `readonly db: LinkstashDb` field, for live queries
    - `getOwner(): Promise<string | null>`
    - `ensureOwner(userId: string): Promise<boolean>`: records the signed-in user. Unless this user already owns the local data, it first wipes everything, including rows that have no owner. Returns `true` only when it wiped a different user's data.
    - `clear()` also forgets the owner.
  - Meta keys: `owner`, `cursor:links`, `cursor:categories`.
  - `apps/web/src/index.css` scans `packages/ui/src` for Tailwind classes.

- [ ] **Step 1: Create the web app package**

`apps/web/package.json`:
```json
{
  "name": "@linkstash/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p . && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@linkstash/core": "workspace:*",
    "@linkstash/ui": "workspace:*",
    "dexie": "^4.4.7",
    "dexie-react-hooks": "^4.4.0",
    "lucide-react": "^1.78.0",
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.5",
    "@testing-library/dom": "^10.4.2",
    "@testing-library/react": "^16.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^6.3.0",
    "fake-indexeddb": "^6.2.8",
    "jsdom": "^31.0.1",
    "tailwindcss": "^4.3.5",
    "typescript": "^7.0.2",
    "vite": "^8.3.8",
    "vitest": "^5.1.1"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

Tests use their own config, so the PWA plugin added in Task 16 never runs under Vitest.

`apps/web/vitest.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

Task 16 adds the icon and iOS tags to `index.html`, once the icon files exist.

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="Save, organize, and find your links on every device." />
    <meta name="theme-color" content="#4f46e5" />
    <title>Linkstash</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/.env.example`:
```
# Supabase dashboard → Connect (or Project Settings → API Keys).
# Use the publishable key (sb_publishable_…). A legacy anon key also works.
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
```

`apps/web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Tailwind only scans the Vite project, so `@source` adds the shared UI package's classes. `dark:` utilities follow `prefers-color-scheme` by default.

`apps/web/src/index.css`:
```css
@import "tailwindcss";
@source "../../../packages/ui/src";

@layer base {
  html {
    color-scheme: light dark;
  }
  body {
    @apply bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100;
  }
}
```

`apps/web/src/App.tsx`:
```tsx
export function App() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Linkstash</h1>
    </main>
  );
}
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/test/setup.ts`:
```ts
import 'fake-indexeddb/auto';
```

Run: `pnpm install`
Expected: it completes. If pnpm lists ignored build scripts, run `pnpm approve-builds` and approve them.

- [ ] **Step 2: Write the failing test**

Each store gets a fresh database name, so tests never share data.

`apps/web/src/db.test.ts`:
```ts
import { describeLocalStoreContract, makeCategory, makeLink } from '@linkstash/core/testing';
import { describe, expect, it } from 'vitest';
import { DexieLocalStore, openDb } from './db';

let dbCount = 0;
const freshStore = () => new DexieLocalStore(openDb(`linkstash-test-${++dbCount}`));

describeLocalStoreContract('DexieLocalStore', freshStore);

describe('DexieLocalStore owner', () => {
  it('records the first owner and keeps data for the same user', async () => {
    const store = freshStore();
    expect(await store.getOwner()).toBeNull();

    expect(await store.ensureOwner('user-a')).toBe(false);
    const link = makeLink();
    await store.apply({ links: [link], mutations: [{ type: 'visit', id: link.id }] });

    expect(await store.ensureOwner('user-a')).toBe(false);
    expect(await store.getOwner()).toBe('user-a');
    expect(await store.listLinks()).toEqual([link]);
    expect(await store.peekOutbox()).toHaveLength(1);
  });

  it('wipes everything when a different user signs in', async () => {
    const store = freshStore();
    await store.ensureOwner('user-a');
    await store.apply({ links: [makeLink()], categories: [makeCategory()], mutations: [{ type: 'visit', id: 'x' }] });
    await store.setCursor('links', '2026-01-02T00:00:00.000Z');

    expect(await store.ensureOwner('user-b')).toBe(true);
    expect(await store.getOwner()).toBe('user-b');
    expect(await store.listLinks()).toEqual([]);
    expect(await store.listCategories()).toEqual([]);
    expect(await store.peekOutbox()).toEqual([]);
    expect(await store.getCursor('links')).toBeNull();
  });

  it('forgets the owner on clear()', async () => {
    const store = freshStore();
    await store.ensureOwner('user-a');
    await store.clear();
    expect(await store.getOwner()).toBeNull();
  });

  it('wipes rows that have no owner', async () => {
    const store = freshStore();
    await store.apply({ links: [makeLink()], mutations: [{ type: 'visit', id: 'x' }] });

    expect(await store.ensureOwner('user-a')).toBe(false);
    expect(await store.listLinks()).toEqual([]);
    expect(await store.peekOutbox()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @linkstash/web test`
Expected: FAIL, because `./db` cannot be resolved.

- [ ] **Step 4: Implement `apps/web/src/db.ts`**

IndexedDB structured-clones values on write and read, so callers always get copies. `outbox.clear()` does not reset the `++seq` key generator, so `seq` keeps increasing after a clear, as the contract requires.

`ensureOwner` also wipes rows that have no owner. They can exist because a sync that was already running when the user signed out can still write pulled rows after `clear()`.

```ts
import type { Category, Link, LocalChange, LocalStore, OutboxEntry, SyncTable } from '@linkstash/core';
import { Dexie, type EntityTable } from 'dexie';

export interface MetaRow {
  key: string;
  value: string;
}

export type LinkstashDb = Dexie & {
  links: EntityTable<Link, 'id'>;
  categories: EntityTable<Category, 'id'>;
  outbox: EntityTable<OutboxEntry, 'seq'>;
  meta: EntityTable<MetaRow, 'key'>;
};

export function openDb(name = 'linkstash'): LinkstashDb {
  const db = new Dexie(name) as LinkstashDb;
  db.version(1).stores({
    links: 'id',
    categories: 'id',
    outbox: '++seq',
    meta: 'key',
  });
  return db;
}

const OWNER_KEY = 'owner';
const cursorKey = (table: SyncTable) => `cursor:${table}`;

export class DexieLocalStore implements LocalStore {
  readonly db: LinkstashDb;

  constructor(db: LinkstashDb) {
    this.db = db;
  }

  getLink(id: string) {
    return this.db.links.get(id);
  }

  getCategory(id: string) {
    return this.db.categories.get(id);
  }

  listLinks() {
    return this.db.links.toArray();
  }

  listCategories() {
    return this.db.categories.toArray();
  }

  async apply(change: LocalChange) {
    const { links, categories, outbox } = this.db;
    await this.db.transaction('rw', [links, categories, outbox], async () => {
      if (change.links?.length) await links.bulkPut(change.links);
      if (change.categories?.length) await categories.bulkPut(change.categories);
      for (const mutation of change.mutations ?? []) await outbox.add({ mutation });
    });
  }

  peekOutbox() {
    return this.db.outbox.toArray();
  }

  async removeOutbox(seq: number) {
    await this.db.outbox.delete(seq);
  }

  async getCursor(table: SyncTable) {
    return (await this.db.meta.get(cursorKey(table)))?.value ?? null;
  }

  async setCursor(table: SyncTable, cursor: string) {
    await this.db.meta.put({ key: cursorKey(table), value: cursor });
  }

  async clear() {
    await this.db.transaction('rw', this.db.tables, async () => {
      await Promise.all(this.db.tables.map((table) => table.clear()));
    });
  }

  async getOwner() {
    return (await this.db.meta.get(OWNER_KEY))?.value ?? null;
  }

  async ensureOwner(userId: string): Promise<boolean> {
    return this.db.transaction('rw', this.db.tables, async () => {
      const owner = await this.getOwner();
      if (owner === userId) return false;
      await Promise.all(this.db.tables.map((table) => table.clear()));
      await this.db.meta.put({ key: OWNER_KEY, value: userId });
      return owner !== null;
    });
  }
}
```

- [ ] **Step 5: Run the tests, typecheck, and build**

Run: `pnpm --filter @linkstash/web test; pnpm --filter @linkstash/web build`
Expected: PASS, 10 tests (6 contract + 4 owner). The build runs tsc, then writes `apps/web/dist/index.html`.

Run: `pnpm --filter @linkstash/web dev`, then open `http://localhost:5173`.
Expected: the page shows the heading "Linkstash". Stop the server with Ctrl+C.

- [ ] **Step 6: Commit**

```powershell
git add apps/web pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(web): scaffold Vite PWA app with Dexie local store" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Web actions (link and category writes) and share-target parsing

Every write the PWA makes goes through `createActions`. Each action writes to the local store through the `SyncEngine`, which also queues the outbox mutation, and then asks for a sync. New links are saved at once, and the page metadata is filled in afterwards.

**Files:**
- Create: `apps/web/src/actions.ts`, `apps/web/src/share.ts`
- Test: `apps/web/src/actions.test.ts`, `apps/web/src/share.test.ts`

**Interfaces:**
- Consumes (`@linkstash/core`):
  - `createLink`, `updateLink`, `editPatch`, `metadataPatch`, `needsMetadata`, `parseCategoryInput`, `createCategory`, `updateCategory`, `systemClock`, and the types `Clock`, `Result`, `LinkPatch`, `CategoryInput`, `ParsedLinkInput`, `PageMetadataInput` (Task 2)
  - `findByUrl` (Task 3); `dedupeKey`, `hostname`, `normalizeUrl` (Task 1)
  - `LocalStore`, `MemoryLocalStore` (Task 5); `SyncEngine` (Task 6); `FakeRemote` from `@linkstash/core/testing` (Task 6)
- Produces (`apps/web/src/actions.ts`):
  - `type SaveLinkResult = { status: 'saved'; link: Link; enrichment: Promise<void> } | { status: 'duplicate'; link: Link }`. `enrichment` settles once fetched metadata has been written, or skipped. It never rejects.
  - `interface ActionDeps`:
    - `engine: Pick<SyncEngine, 'saveLink' | 'saveCategory' | 'recordVisit'>`
    - `store: Pick<LocalStore, 'getLink' | 'getCategory' | 'listLinks' | 'listCategories'>`
    - `requestSync(): void`
    - `fetchMetadata(url: string): Promise<PageMetadataInput | null>`
    - `clock?: Clock`
  - `createActions(deps: ActionDeps): Actions`. The `Actions` interface has:
    - `addLink(input: ParsedLinkInput): Promise<SaveLinkResult>`. Returns `duplicate` if a live link has the same dedupe key.
    - `editLink(id, input: ParsedLinkInput): Promise<SaveLinkResult>`. When the URL points to a different page, it returns `duplicate` if that page is already saved. Otherwise it resets title/description/favicon and fetches them again. Throws `Error('This link was deleted')` for a missing or deleted link.
    - `toggleFavorite(id)`, `toggleArchive(id)`, `deleteLink(id)` (tombstone), `restoreLink(id)` (undo delete), `openLink(id)` (records a visit). All return `Promise<void>`.
    - `addCategory(input: CategoryInput): Promise<Result<Category>>` and `editCategory(id, input): Promise<Result<Category>>`. Names must be unique (case-insensitive) among live categories. The error texts are `'A category with that name already exists'` and `'This category was deleted'`.
    - `deleteCategory(id): Promise<void>`. Tombstones the category. Its links are not rewritten; the UI shows them as uncategorized.
- Produces (`apps/web/src/share.ts`): `interface SharedLink { url: string; title: string | null }` and `parseSharedLink(params: URLSearchParams): SharedLink | null`.

- [ ] **Step 1: Write the failing action tests**

The tests use the real `SyncEngine` over a `MemoryLocalStore`. The engine never flushes here, so every write stays in the outbox, where the tests can see it. `fetchMetadata` is a mock, and some tests hold its promise open to check the state before metadata arrives.

`apps/web/src/actions.test.ts`:
```ts
import { MemoryLocalStore, SyncEngine, type Clock, type PageMetadataInput, type ParsedLinkInput } from '@linkstash/core';
import { FakeRemote } from '@linkstash/core/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createActions, type Actions, type SaveLinkResult } from './actions';

function testClock(): Clock {
  let seconds = 0;
  let ids = 0;
  return {
    now: () => new Date(Date.UTC(2026, 1, 1, 0, 0, ++seconds)).toISOString(),
    id: () => `new-${++ids}`,
  };
}

const input = (over: Partial<ParsedLinkInput> = {}): ParsedLinkInput => ({
  url: 'https://example.com/article',
  customTitle: null,
  notes: null,
  tags: [],
  categoryId: null,
  title: null,
  description: null,
  faviconUrl: null,
  ...over,
});

function saved(result: SaveLinkResult) {
  if (result.status !== 'saved') throw new Error(`expected a saved link, got ${result.status}`);
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let local: MemoryLocalStore;
let requestSync: Mock<() => void>;
let fetchMetadata: Mock<(url: string) => Promise<PageMetadataInput | null>>;
let actions: Actions;

const outboxTypes = async () => (await local.peekOutbox()).map((entry) => entry.mutation.type);

beforeEach(() => {
  local = new MemoryLocalStore();
  requestSync = vi.fn<() => void>();
  fetchMetadata = vi.fn<(url: string) => Promise<PageMetadataInput | null>>(async () => null);
  actions = createActions({
    engine: new SyncEngine(local, new FakeRemote()),
    store: local,
    requestSync,
    fetchMetadata,
    clock: testClock(),
  });
});

describe('addLink', () => {
  it('saves a new link right away, then fills in fetched metadata', async () => {
    const meta = deferred<PageMetadataInput | null>();
    fetchMetadata.mockReturnValue(meta.promise);

    const result = saved(await actions.addLink(input({ tags: ['news'] })));
    expect(result.link).toMatchObject({ id: 'new-1', title: 'example.com', url_key: 'example.com/article', tags: ['news'] });
    expect(await local.getLink('new-1')).toEqual(result.link);
    expect(await outboxTypes()).toEqual(['upsertLink']);
    expect(requestSync).toHaveBeenCalledTimes(1);
    expect(fetchMetadata).toHaveBeenCalledWith('https://example.com/article');

    meta.resolve({ title: '  Example   Article ', description: 'About things', faviconUrl: 'https://example.com/favicon.ico' });
    await result.enrichment;
    expect(await local.getLink('new-1')).toMatchObject({
      title: 'Example Article',
      description: 'About things',
      favicon_url: 'https://example.com/favicon.ico',
    });
    expect(await outboxTypes()).toEqual(['upsertLink', 'upsertLink']);
    expect(requestSync).toHaveBeenCalledTimes(2);
  });

  it('reports a duplicate instead of saving the same page twice', async () => {
    const first = saved(await actions.addLink(input()));
    await first.enrichment;

    const again = await actions.addLink(input({ url: 'http://www.example.com/article/#top' }));
    expect(again).toEqual({ status: 'duplicate', link: first.link });
    expect(await local.listLinks()).toHaveLength(1);
    expect(await outboxTypes()).toEqual(['upsertLink']);
  });

  it('keeps a real title and leaves links deleted before metadata arrives alone', async () => {
    fetchMetadata.mockResolvedValue({ title: 'Fetched', description: 'Fetched description', faviconUrl: null });
    const shared = saved(await actions.addLink(input({ title: 'Shared title' })));
    await shared.enrichment;
    expect(await local.getLink(shared.link.id)).toMatchObject({ title: 'Shared title', description: 'Fetched description' });

    const meta = deferred<PageMetadataInput | null>();
    fetchMetadata.mockReturnValue(meta.promise);
    const gone = saved(await actions.addLink(input({ url: 'https://example.org/' })));
    await actions.deleteLink(gone.link.id);
    meta.resolve({ title: 'Too late' });
    await gone.enrichment;
    expect(await local.getLink(gone.link.id)).toMatchObject({ title: 'example.org' });
  });

  it('does not fetch metadata the input already has', async () => {
    const result = saved(
      await actions.addLink(input({ title: 'T', description: 'D', faviconUrl: 'https://example.com/f.ico' })),
    );
    await result.enrichment;
    expect(fetchMetadata).not.toHaveBeenCalled();
  });
});

describe('editLink', () => {
  it('updates the user fields and keeps metadata when the page is the same', async () => {
    fetchMetadata.mockResolvedValue({ title: 'Article', description: 'D', faviconUrl: null });
    const added = saved(await actions.addLink(input()));
    await added.enrichment;
    fetchMetadata.mockClear();

    const edited = saved(
      await actions.editLink(added.link.id, input({ url: 'https://example.com/article#intro', customTitle: 'Mine', tags: ['a'] })),
    );
    await edited.enrichment;
    expect(await local.getLink(added.link.id)).toMatchObject({
      url: 'https://example.com/article#intro',
      custom_title: 'Mine',
      tags: ['a'],
      title: 'Article',
      description: 'D',
    });
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('re-fetches metadata for a new page, unless that page is already saved', async () => {
    fetchMetadata.mockResolvedValue({ title: 'Old page', description: 'Old', faviconUrl: 'https://example.com/f.ico' });
    const added = saved(await actions.addLink(input()));
    await added.enrichment;
    const other = saved(await actions.addLink(input({ url: 'https://example.net/' })));
    await other.enrichment;

    expect(await actions.editLink(added.link.id, input({ url: 'https://example.net/' }))).toEqual({
      status: 'duplicate',
      link: await local.getLink(other.link.id),
    });

    fetchMetadata.mockResolvedValue({ title: 'New page', description: null, faviconUrl: null });
    const moved = saved(await actions.editLink(added.link.id, input({ url: 'https://example.org/new' })));
    expect(moved.link).toMatchObject({ url_key: 'example.org/new', title: 'example.org', description: null, favicon_url: null });
    await moved.enrichment;
    expect(await local.getLink(added.link.id)).toMatchObject({ title: 'New page' });
  });

  it('refuses to edit a deleted link', async () => {
    const added = saved(await actions.addLink(input()));
    await actions.deleteLink(added.link.id);
    await expect(actions.editLink(added.link.id, input())).rejects.toThrow('This link was deleted');
  });
});

describe('link flags and visits', () => {
  it('toggles favorite and archive, and deletes with undo', async () => {
    const added = saved(await actions.addLink(input()));
    await added.enrichment;
    const id = added.link.id;

    await actions.toggleFavorite(id);
    await actions.toggleArchive(id);
    expect(await local.getLink(id)).toMatchObject({ is_favorite: true, is_archived: true });
    await actions.toggleFavorite(id);
    expect(await local.getLink(id)).toMatchObject({ is_favorite: false });

    await actions.deleteLink(id);
    expect((await local.getLink(id))?.deleted_at).not.toBeNull();
    await actions.restoreLink(id);
    expect((await local.getLink(id))?.deleted_at).toBeNull();

    expect(await outboxTypes()).toEqual(Array(6).fill('upsertLink'));
    expect(requestSync).toHaveBeenCalledTimes(6);
  });

  it('records a visit when a link is opened', async () => {
    const added = saved(await actions.addLink(input()));
    await added.enrichment;

    await actions.openLink(added.link.id);
    const link = await local.getLink(added.link.id);
    expect(link?.visit_count).toBe(1);
    expect(link?.last_visited_at).not.toBeNull();
    expect(await outboxTypes()).toEqual(['upsertLink', 'visit']);
    expect(requestSync).toHaveBeenCalledTimes(2);
  });
});

describe('categories', () => {
  it('creates, renames and deletes categories, rejecting bad or duplicate names', async () => {
    const reading = await actions.addCategory({ name: ' Reading ', color: '#3B82F6' });
    if (!reading.ok) throw new Error(reading.error);
    expect(reading.value).toMatchObject({ name: 'Reading', color: '#3b82f6' });
    expect(await actions.addCategory({ name: 'reading', color: '#ef4444' })).toEqual({
      ok: false,
      error: 'A category with that name already exists',
    });
    expect(await actions.addCategory({ name: '  ', color: '#ef4444' })).toEqual({ ok: false, error: 'Name is required' });

    const work = await actions.addCategory({ name: 'Work', color: '#ef4444' });
    if (!work.ok) throw new Error(work.error);
    expect(await actions.editCategory(work.value.id, { name: 'READING', color: '#ef4444' })).toEqual({
      ok: false,
      error: 'A category with that name already exists',
    });
    expect(await actions.editCategory(reading.value.id, { name: 'reading', color: '#22c55e' })).toMatchObject({
      ok: true,
      value: { id: reading.value.id, name: 'reading', color: '#22c55e' },
    });

    await actions.deleteCategory(reading.value.id);
    expect((await local.getCategory(reading.value.id))?.deleted_at).not.toBeNull();
    expect(await actions.editCategory(reading.value.id, { name: 'X', color: '#3b82f6' })).toEqual({
      ok: false,
      error: 'This category was deleted',
    });
    expect(await actions.addCategory({ name: 'Reading', color: '#3b82f6' })).toMatchObject({ ok: true });
    expect(await outboxTypes()).toEqual(Array(5).fill('upsertCategory'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @linkstash/web test actions`
Expected: FAIL, because `./actions` cannot be resolved.

- [ ] **Step 3: Implement `apps/web/src/actions.ts`**

Enrichment only fills fields the link is still missing (`metadataPatch`, Task 2). Enrichment re-reads the link first and skips it if the link was deleted or its URL changed in the meantime.

```ts
import {
  createCategory,
  createLink,
  dedupeKey,
  editPatch,
  findByUrl,
  hostname,
  metadataPatch,
  needsMetadata,
  parseCategoryInput,
  systemClock,
  updateCategory,
  updateLink,
  type Category,
  type CategoryInput,
  type Clock,
  type Link,
  type LinkPatch,
  type LocalStore,
  type PageMetadataInput,
  type ParsedLinkInput,
  type Result,
  type SyncEngine,
} from '@linkstash/core';

export type SaveLinkResult =
  | { status: 'saved'; link: Link; enrichment: Promise<void> }
  | { status: 'duplicate'; link: Link };

export interface Actions {
  addLink(input: ParsedLinkInput): Promise<SaveLinkResult>;
  editLink(id: string, input: ParsedLinkInput): Promise<SaveLinkResult>;
  toggleFavorite(id: string): Promise<void>;
  toggleArchive(id: string): Promise<void>;
  deleteLink(id: string): Promise<void>;
  restoreLink(id: string): Promise<void>;
  openLink(id: string): Promise<void>;
  addCategory(input: CategoryInput): Promise<Result<Category>>;
  editCategory(id: string, input: CategoryInput): Promise<Result<Category>>;
  deleteCategory(id: string): Promise<void>;
}

export interface ActionDeps {
  engine: Pick<SyncEngine, 'saveLink' | 'saveCategory' | 'recordVisit'>;
  store: Pick<LocalStore, 'getLink' | 'getCategory' | 'listLinks' | 'listCategories'>;
  /** Asks for a sync soon. Called after every local write. */
  requestSync(): void;
  fetchMetadata(url: string): Promise<PageMetadataInput | null>;
  clock?: Clock;
}

const DUPLICATE_NAME = 'A category with that name already exists';
const DONE: Promise<void> = Promise.resolve();

export function createActions(deps: ActionDeps): Actions {
  const { engine, store, requestSync } = deps;
  const clock = deps.clock ?? systemClock;

  async function saveLink(link: Link): Promise<void> {
    await engine.saveLink(link);
    requestSync();
  }

  async function saveCategory(category: Category): Promise<void> {
    await engine.saveCategory(category);
    requestSync();
  }

  async function patchLink(id: string, patch: (link: Link) => LinkPatch): Promise<void> {
    const link = await store.getLink(id);
    if (!link) return;
    await saveLink(updateLink(link, patch(link), clock));
  }

  async function enrich(id: string, url: string): Promise<void> {
    const meta = await deps.fetchMetadata(url);
    if (!meta) return;
    const current = await store.getLink(id);
    if (!current || current.deleted_at || current.url !== url) return;
    const patch = metadataPatch(current, meta);
    if (Object.keys(patch).length > 0) await saveLink(updateLink(current, patch, clock));
  }

  /** Metadata is best effort: the link is already saved, so any failure just leaves it as it is. */
  function startEnrichment(link: Link): Promise<void> {
    return needsMetadata(link) ? enrich(link.id, link.url).catch(() => undefined) : DONE;
  }

  async function findDuplicate(url: string, exceptId?: string): Promise<Link | undefined> {
    const links = await store.listLinks();
    return findByUrl(exceptId ? links.filter((l) => l.id !== exceptId) : links, url);
  }

  async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
    const lower = name.toLowerCase();
    const categories = await store.listCategories();
    return categories.some((c) => !c.deleted_at && c.id !== exceptId && c.name.toLowerCase() === lower);
  }

  return {
    async addLink(input) {
      const duplicate = await findDuplicate(input.url);
      if (duplicate) return { status: 'duplicate', link: duplicate };
      const link = createLink(input, clock);
      await saveLink(link);
      return { status: 'saved', link, enrichment: startEnrichment(link) };
    },

    async editLink(id, input) {
      const current = await store.getLink(id);
      if (!current || current.deleted_at) throw new Error('This link was deleted');
      const patch = editPatch(input);
      const samePage = current.url_key === dedupeKey(input.url);
      if (!samePage) {
        const duplicate = await findDuplicate(input.url, id);
        if (duplicate) return { status: 'duplicate', link: duplicate };
        // The old page's metadata no longer applies.
        Object.assign(patch, { title: hostname(input.url), description: null, favicon_url: null });
      }
      const link = updateLink(current, patch, clock);
      await saveLink(link);
      return { status: 'saved', link, enrichment: samePage ? DONE : startEnrichment(link) };
    },

    toggleFavorite: (id) => patchLink(id, (link) => ({ is_favorite: !link.is_favorite })),
    toggleArchive: (id) => patchLink(id, (link) => ({ is_archived: !link.is_archived })),
    deleteLink: (id) => patchLink(id, () => ({ deleted_at: clock.now() })),
    restoreLink: (id) => patchLink(id, () => ({ deleted_at: null })),

    async openLink(id) {
      await engine.recordVisit(id, clock.now());
      requestSync();
    },

    async addCategory(input) {
      const parsed = parseCategoryInput(input);
      if (!parsed.ok) return parsed;
      if (await nameTaken(parsed.value.name)) return { ok: false, error: DUPLICATE_NAME };
      const category = createCategory(parsed.value, clock);
      await saveCategory(category);
      return { ok: true, value: category };
    },

    async editCategory(id, input) {
      const current = await store.getCategory(id);
      if (!current || current.deleted_at) return { ok: false, error: 'This category was deleted' };
      const parsed = parseCategoryInput(input);
      if (!parsed.ok) return parsed;
      if (await nameTaken(parsed.value.name, id)) return { ok: false, error: DUPLICATE_NAME };
      const category = updateCategory(current, parsed.value, clock);
      await saveCategory(category);
      return { ok: true, value: category };
    },

    async deleteCategory(id) {
      const current = await store.getCategory(id);
      if (!current || current.deleted_at) return;
      await saveCategory(updateCategory(current, { deleted_at: clock.now() }, clock));
    },
  };
}
```

- [ ] **Step 4: Run the action tests to verify they pass**

Run: `pnpm --filter @linkstash/web test actions`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing share-target tests**

Android's share sheet opens the installed PWA at `/share?title=…&text=…&url=…` (the manifest's `share_target`, Task 16). Many apps leave `url` empty and put the link inside `text`, often after a headline.

`apps/web/src/share.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSharedLink } from './share';

const parse = (query: string) => parseSharedLink(new URLSearchParams(query));

describe('parseSharedLink', () => {
  it('uses the url parameter and the trimmed title', () => {
    expect(parse('title=%20Hello%20&url=example.com/a')).toEqual({ url: 'https://example.com/a', title: 'Hello' });
  });

  it('finds a URL inside the shared text and drops trailing punctuation', () => {
    const text = encodeURIComponent('Read this: https://example.com/post?id=1).');
    expect(parse(`text=${text}`)).toEqual({ url: 'https://example.com/post?id=1', title: null });
  });

  it('accepts a bare domain as the text', () => {
    expect(parse('text=example.org')).toEqual({ url: 'https://example.org/', title: null });
  });

  it('returns null when nothing usable was shared', () => {
    expect(parse('')).toBeNull();
    expect(parse('title=Hi&text=no%20link%20here')).toBeNull();
    expect(parse('url=javascript:alert(1)')).toBeNull();
  });
});
```

- [ ] **Step 6: Run the share tests to verify they fail**

Run: `pnpm --filter @linkstash/web test share`
Expected: FAIL, because `./share` cannot be resolved.

- [ ] **Step 7: Implement `apps/web/src/share.ts`**

```ts
import { normalizeUrl } from '@linkstash/core';

export interface SharedLink {
  url: string;
  title: string | null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/** Reads the GET /share?title&text&url request that the share sheet sends to the installed PWA. */
export function parseSharedLink(params: URLSearchParams): SharedLink | null {
  const text = params.get('text')?.trim() ?? '';
  const inText = text.match(URL_IN_TEXT)?.[0].replace(TRAILING_PUNCTUATION, '');
  const url =
    normalizeUrl(params.get('url') ?? '') ?? (inText ? normalizeUrl(inText) : null) ?? normalizeUrl(text);
  if (!url) return null;
  return { url, title: params.get('title')?.trim() || null };
}
```

- [ ] **Step 8: Run all web tests and typecheck**

Run: `pnpm --filter @linkstash/web test; pnpm --filter @linkstash/web typecheck`
Expected: PASS, 24 tests (10 db + 10 actions + 4 share), and tsc is clean.

- [ ] **Step 9: Commit**

```powershell
git add apps/web
git commit -m "feat(web): add link and category actions with metadata enrichment and share parsing" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 12: Toasts, config, sync scheduler, sync lifecycle, and service wiring

This task builds the non-visual layer that keeps the PWA in sync:
- a toast store for user-visible messages
- reading the Supabase config from env vars
- a scheduler that decides when `SyncEngine.sync()` runs: on start, every 60 s, after writes, with exponential backoff while offline
- a React hook that starts and stops the scheduler for the signed-in user and wakes it on focus, network return, and realtime change events
- `createServices`, which wires the real Supabase client, Dexie store, engine, scheduler and actions together

Task 15 mounts all of this in `main.tsx` and `App.tsx`.

**Files:**
- Create: `apps/web/src/toast.ts`, `apps/web/src/env.ts`, `apps/web/src/services.ts`
- Create: `apps/web/src/sync/scheduler.ts`, `apps/web/src/sync/useSyncLifecycle.ts`
- Test: `apps/web/src/toast.test.ts`, `apps/web/src/env.test.ts`, `apps/web/src/sync/scheduler.test.ts`, `apps/web/src/sync/useSyncLifecycle.test.ts`

**Interfaces:**
- Consumes:
  - From `@linkstash/core`: `isHttpUrl` (Task 1); `SyncEngine`, `SyncResult` (Task 6); `createLinkstashClient`, `isAuthRetryableFetchError`, `SupabaseClient`, `SupabaseRemote`, `fetchMetadata(client, url)` (Task 8)
  - `DexieLocalStore`, `openDb` (Task 10); `createActions`, `Actions` (Task 11)
- Produces (`apps/web/src/toast.ts`):
  - `interface ToastAction { label: string; run(): void }`
  - `interface Toast { id: number; kind: 'info' | 'error'; message: string; action?: ToastAction }`
  - `TOAST_MS = 5000`, `ACTION_TOAST_MS = 8000`: how long a toast stays up without and with an action
  - `toast.info(message, action?)` and `toast.error(message, action?)` return the toast id. A toast without an action is not shown twice: an identical one already on screen is reused.
  - `dismiss(id: number): void`, `getToasts(): readonly Toast[]`, `useToasts(): readonly Toast[]`
  - `errorText(error: unknown): string`: the message of anything thrown, for toasts
- Produces (`apps/web/src/env.ts`): `interface WebConfig { supabaseUrl: string; supabasePublishableKey: string }` and `readConfig(env?: Pick<ImportMetaEnv, 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'>): WebConfig | null`. It defaults to `import.meta.env` and returns `null` when the config is missing or the URL is not http(s).
- Produces (`apps/web/src/sync/scheduler.ts`):
  - `SYNC_INTERVAL_MS = 60000`; `backoffDelay(failures: number): number` (1 s, 2 s, 4 s … capped at 60 s)
  - `interface SyncSchedulerOptions`:
    - `run(): Promise<SyncResult>`
    - `onAuth(attempt: number): Promise<boolean>`. Called when `run` returns `'auth'`. `attempt` counts auth failures in the current run, starting at 0. Resolve `true` to run again at once, `false` to wait for the next trigger.
    - `onRetry?(failures: number): void`, called after each consecutive `'retry'`
    - `onError(error: unknown): void`, called when `run` throws
    - `intervalMs?: number`
  - `interface SyncScheduler { start(): void; stop(): void; request(): void }` and `createSyncScheduler(options): SyncScheduler`. `request()` is ignored while stopped; during a run it queues exactly one more run.
- Produces (`apps/web/src/sync/useSyncLifecycle.ts`):
  - `interface SyncLifecycleDeps { scheduler: SyncScheduler; store: Pick<DexieLocalStore, 'ensureOwner'>; subscribeChanges(userId: string, onChange: () => void): () => void }`
  - `useSyncLifecycle(deps: SyncLifecycleDeps, userId: string | null): void`
- Produces (`apps/web/src/services.ts`):
  - `interface Services { supabase: SupabaseClient; store: DexieLocalStore; engine: SyncEngine; scheduler: SyncScheduler; actions: Actions; subscribeChanges(userId, onChange): () => void }`. `Services` satisfies `SyncLifecycleDeps`.
  - `createServices(config: WebConfig): Services`
  - `ServicesContext` (a React context, `Services | null`) and `useServices(): Services`, which throws outside a provider

- [ ] **Step 1: Write the failing toast and config tests**

`apps/web/src/toast.test.ts`:
```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_TOAST_MS, dismiss, getToasts, toast, TOAST_MS, useToasts } from './toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
  vi.useRealTimers();
});

describe('toast', () => {
  it('hides plain toasts after TOAST_MS and toasts with an action after ACTION_TOAST_MS', () => {
    const run = vi.fn();
    toast.info('Saved');
    toast.error('Deleted', { label: 'Undo', run });
    expect(getToasts().map((t) => [t.kind, t.message])).toEqual([
      ['info', 'Saved'],
      ['error', 'Deleted'],
    ]);

    vi.advanceTimersByTime(TOAST_MS);
    expect(getToasts().map((t) => t.message)).toEqual(['Deleted']);
    vi.advanceTimersByTime(ACTION_TOAST_MS - TOAST_MS);
    expect(getToasts()).toEqual([]);
  });

  it('reuses an identical toast on screen, but never merges toasts that carry an action', () => {
    const first = toast.error('Offline');
    expect(toast.error('Offline')).toBe(first);
    toast.info('Deleted', { label: 'Undo', run: vi.fn() });
    toast.info('Deleted', { label: 'Undo', run: vi.fn() });
    expect(getToasts()).toHaveLength(3);

    dismiss(first);
    expect(getToasts().map((t) => t.message)).toEqual(['Deleted', 'Deleted']);
  });

  it('re-renders subscribers when toasts change', () => {
    const { result } = renderHook(() => useToasts());
    expect(result.current).toEqual([]);
    act(() => {
      toast.info('Hello');
    });
    expect(result.current.map((t) => t.message)).toEqual(['Hello']);
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(result.current).toEqual([]);
  });
});
```

`apps/web/src/env.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readConfig } from './env';

describe('readConfig', () => {
  it('returns the trimmed Supabase config, or null when it is missing or invalid', () => {
    expect(readConfig({ VITE_SUPABASE_URL: ' https://abc.supabase.co ', VITE_SUPABASE_PUBLISHABLE_KEY: ' key ' })).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabasePublishableKey: 'key',
    });
    expect(readConfig({ VITE_SUPABASE_URL: 'https://abc.supabase.co' })).toBeNull();
    expect(readConfig({ VITE_SUPABASE_URL: 'abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'key' })).toBeNull();
    expect(readConfig({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @linkstash/web test toast env`
Expected: FAIL, because `./toast` and `./env` cannot be resolved.

- [ ] **Step 3: Implement `apps/web/src/toast.ts` and `apps/web/src/env.ts`**

The toast store lives in the module, so actions, services and components can raise toasts without passing anything around. `Toaster` (Task 13) renders it.

`apps/web/src/toast.ts`:
```ts
import { useSyncExternalStore } from 'react';

export interface ToastAction {
  label: string;
  run(): void;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  message: string;
  action?: ToastAction;
}

export const TOAST_MS = 5000;
export const ACTION_TOAST_MS = 8000;

let toasts: readonly Toast[] = [];
let lastId = 0;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

function show(kind: Toast['kind'], message: string, action?: ToastAction): number {
  if (!action) {
    const same = toasts.find((t) => !t.action && t.kind === kind && t.message === message);
    if (same) return same.id;
  }
  const id = ++lastId;
  toasts = [...toasts, action ? { id, kind, message, action } : { id, kind, message }];
  timers.set(id, setTimeout(() => dismiss(id), action ? ACTION_TOAST_MS : TOAST_MS));
  emit();
  return id;
}

export function dismiss(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  info: (message: string, action?: ToastAction) => show('info', message, action),
  error: (message: string, action?: ToastAction) => show('error', message, action),
};

export const getToasts = (): readonly Toast[] => toasts;

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribe, getToasts);
}
```

`apps/web/src/env.ts`:
```ts
import { isHttpUrl } from '@linkstash/core';

export interface WebConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

type ConfigEnv = Pick<ImportMetaEnv, 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'>;

/** Reads the build-time Supabase settings. `null` makes the app show setup instructions instead. */
export function readConfig(env: ConfigEnv = import.meta.env): WebConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!supabasePublishableKey || !isHttpUrl(supabaseUrl)) return null;
  return { supabaseUrl, supabasePublishableKey };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @linkstash/web test toast env`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing scheduler tests**

The scheduler only deals with timing, so it is tested with fake timers and a mocked `run`. `vi.advanceTimersByTimeAsync` also flushes pending promises, which lets each awaited `run` finish. `settle()` does that without moving the clock.

`apps/web/src/sync/scheduler.test.ts`:
```ts
import type { SyncResult } from '@linkstash/core';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { backoffDelay, createSyncScheduler, SYNC_INTERVAL_MS, type SyncScheduler } from './scheduler';

let run: Mock<() => Promise<SyncResult>>;
let onAuth: Mock<(attempt: number) => Promise<boolean>>;
let onRetry: Mock<(failures: number) => void>;
let onError: Mock<(error: unknown) => void>;
let scheduler: SyncScheduler;

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  run = vi.fn<() => Promise<SyncResult>>(async () => 'ok');
  onAuth = vi.fn<(attempt: number) => Promise<boolean>>(async () => false);
  onRetry = vi.fn<(failures: number) => void>();
  onError = vi.fn<(error: unknown) => void>();
  scheduler = createSyncScheduler({ run, onAuth, onRetry, onError });
});

afterEach(() => {
  scheduler.stop();
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('doubles from one second up to a one-minute cap', () => {
    expect([1, 2, 3, 6, 7, 20].map(backoffDelay)).toEqual([1000, 2000, 4000, 32000, 60000, 60000]);
  });
});

describe('createSyncScheduler', () => {
  it('runs on start, on request and on the interval, and does nothing once stopped', async () => {
    scheduler.request();
    await settle();
    expect(run).not.toHaveBeenCalled();

    scheduler.start();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);

    scheduler.stop();
    scheduler.request();
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('backs off after failed runs and resets after a successful one', async () => {
    run
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('ok')
      .mockResolvedValueOnce('retry');
    scheduler.start();
    await settle();
    expect(onRetry).toHaveBeenLastCalledWith(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenLastCalledWith(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);

    scheduler.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenLastCalledWith(1);
  });

  it('runs at once on request instead of waiting out the backoff', async () => {
    run.mockResolvedValueOnce('retry');
    scheduler.start();
    await settle();
    scheduler.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('queues one more run for any number of requests made during a run', async () => {
    let finish!: (result: SyncResult) => void;
    run.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    scheduler.start();
    await settle();
    scheduler.request();
    scheduler.request();
    expect(run).toHaveBeenCalledTimes(1);

    finish('ok');
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('lets onAuth decide whether to run again, counting attempts per run', async () => {
    run.mockResolvedValue('auth');
    onAuth.mockImplementation(async (attempt) => attempt === 0);
    scheduler.start();
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(onAuth.mock.calls).toEqual([[0], [1]]);

    scheduler.request();
    await settle();
    expect(run).toHaveBeenCalledTimes(4);
    expect(onAuth.mock.calls).toEqual([[0], [1], [0], [1]]);
  });

  it('reports a thrown error and waits for the next interval', async () => {
    const boom = new Error('boom');
    run.mockRejectedValueOnce(boom);
    scheduler.start();
    await settle();
    expect(onError).toHaveBeenCalledWith(boom);

    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 6: Run the scheduler tests to verify they fail**

Run: `pnpm --filter @linkstash/web test scheduler`
Expected: FAIL, because `./scheduler` cannot be resolved.

- [ ] **Step 7: Implement `apps/web/src/sync/scheduler.ts`**

A run that ends in `'retry'` schedules its own retry with backoff. Any other trigger (a write, the interval, focus) cancels that wait and runs at once, since the user is active. The auth attempt counter starts at 0 on every run, so a refresh that failed offline is tried again on the next trigger instead of signing the user out.

```ts
import type { SyncResult } from '@linkstash/core';

export const SYNC_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;

/** Delay before retry number `failures` (1-based): 1 s, 2 s, 4 s … up to one minute. */
export function backoffDelay(failures: number): number {
  return Math.min(1000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

export interface SyncSchedulerOptions {
  run(): Promise<SyncResult>;
  /** Called when `run` returns 'auth'. Resolve true to run again now, false to wait for the next trigger. */
  onAuth(attempt: number): Promise<boolean>;
  /** Called after each consecutive 'retry', with the number of failures so far. */
  onRetry?(failures: number): void;
  /** Called when `run` throws. The scheduler then waits for the next trigger. */
  onError(error: unknown): void;
  intervalMs?: number;
}

export interface SyncScheduler {
  start(): void;
  stop(): void;
  /** Asks for a sync now. Ignored while stopped; during a run, queues one more run. */
  request(): void;
}

export function createSyncScheduler(options: SyncSchedulerOptions): SyncScheduler {
  const intervalMs = options.intervalMs ?? SYNC_INTERVAL_MS;
  let active = false;
  let running = false;
  let again = false;
  let failures = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  async function runLoop(): Promise<void> {
    running = true;
    let authAttempt = 0;
    try {
      do {
        again = false;
        const result = await options.run();
        if (!active) return;
        if (result === 'retry') {
          failures++;
          options.onRetry?.(failures);
          retryTimer = setTimeout(request, backoffDelay(failures));
          return;
        }
        if (result === 'auth') {
          if (!(await options.onAuth(authAttempt++))) return;
          again = true;
        } else {
          failures = 0;
        }
      } while (again && active);
    } finally {
      running = false;
    }
  }

  function request(): void {
    if (!active) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(retryTimer);
    retryTimer = undefined;
    runLoop().catch((error: unknown) => {
      if (active) options.onError(error);
    });
  }

  return {
    start() {
      if (active) return;
      active = true;
      failures = 0;
      interval = setInterval(request, intervalMs);
      request();
    },
    stop() {
      active = false;
      again = false;
      clearInterval(interval);
      clearTimeout(retryTimer);
      interval = undefined;
      retryTimer = undefined;
    },
    request,
  };
}
```

- [ ] **Step 8: Run the scheduler tests to verify they pass**

Run: `pnpm --filter @linkstash/web test scheduler`
Expected: PASS, 7 tests.

- [ ] **Step 9: Write the failing lifecycle tests**

`apps/web/src/sync/useSyncLifecycle.test.ts`:
```ts
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SyncScheduler } from './scheduler';
import { useSyncLifecycle, type SyncLifecycleDeps } from './useSyncLifecycle';

let scheduler: { start: Mock<() => void>; stop: Mock<() => void>; request: Mock<() => void> };
let ensureOwner: Mock<(userId: string) => Promise<boolean>>;
let unsubscribe: Mock<() => void>;
let subscribeChanges: Mock<(userId: string, onChange: () => void) => () => void>;
let deps: SyncLifecycleDeps;

beforeEach(() => {
  scheduler = { start: vi.fn<() => void>(), stop: vi.fn<() => void>(), request: vi.fn<() => void>() };
  ensureOwner = vi.fn<(userId: string) => Promise<boolean>>(async () => false);
  unsubscribe = vi.fn<() => void>();
  subscribeChanges = vi.fn<(userId: string, onChange: () => void) => () => void>(() => unsubscribe);
  deps = { scheduler: scheduler satisfies SyncScheduler, store: { ensureOwner }, subscribeChanges };
});

describe('useSyncLifecycle', () => {
  it('does nothing while signed out', () => {
    renderHook(() => useSyncLifecycle(deps, null));
    expect(ensureOwner).not.toHaveBeenCalled();
    expect(subscribeChanges).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('claims the local data, starts syncing, and syncs on focus, reconnect and remote changes', async () => {
    const { unmount } = renderHook(() => useSyncLifecycle(deps, 'user-a'));
    await waitFor(() => expect(scheduler.start).toHaveBeenCalledTimes(1));
    expect(ensureOwner).toHaveBeenCalledWith('user-a');
    expect(subscribeChanges).toHaveBeenCalledWith('user-a', expect.any(Function));

    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    subscribeChanges.mock.calls[0]![1]();
    expect(scheduler.request).toHaveBeenCalledTimes(3);

    unmount();
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    expect(scheduler.request).toHaveBeenCalledTimes(3);
  });

  it('restarts for a new user and stops on sign-out', async () => {
    const { rerender } = renderHook(({ userId }) => useSyncLifecycle(deps, userId), {
      initialProps: { userId: 'user-a' as string | null },
    });
    await waitFor(() => expect(scheduler.start).toHaveBeenCalledTimes(1));

    rerender({ userId: 'user-b' });
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(scheduler.start).toHaveBeenCalledTimes(2));
    expect(ensureOwner).toHaveBeenLastCalledWith('user-b');
    expect(subscribeChanges).toHaveBeenLastCalledWith('user-b', expect.any(Function));

    rerender({ userId: null });
    expect(scheduler.stop).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('does not start when the user signs out before the local data is ready', async () => {
    let ready!: (switched: boolean) => void;
    ensureOwner.mockReturnValueOnce(new Promise((resolve) => (ready = resolve)));
    const { rerender } = renderHook(({ userId }) => useSyncLifecycle(deps, userId), {
      initialProps: { userId: 'user-a' as string | null },
    });
    rerender({ userId: null });
    ready(false);
    await Promise.resolve();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('syncs when the page becomes visible again', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    renderHook(() => useSyncLifecycle(deps, 'user-a'));

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(scheduler.request).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(scheduler.request).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
});
```

- [ ] **Step 10: Run the lifecycle tests to verify they fail**

Run: `pnpm --filter @linkstash/web test useSyncLifecycle`
Expected: FAIL, because `./useSyncLifecycle` cannot be resolved.

- [ ] **Step 11: Implement `apps/web/src/sync/useSyncLifecycle.ts`**

`ensureOwner` runs before the first sync. If a different user signed in on this device, it wipes the previous user's local data first, so their links are never pushed or shown under the new account. Triggers that arrive before `start()` are ignored by the scheduler.

```ts
import { useEffect } from 'react';
import type { DexieLocalStore } from '../db';
import { toast } from '../toast';
import type { SyncScheduler } from './scheduler';

export interface SyncLifecycleDeps {
  scheduler: SyncScheduler;
  store: Pick<DexieLocalStore, 'ensureOwner'>;
  /** Listens for server-side changes to this user's rows and returns the unsubscribe function. */
  subscribeChanges(userId: string, onChange: () => void): () => void;
}

/** Keeps the signed-in user's data syncing while the app is open. Pass `null` when signed out. */
export function useSyncLifecycle(deps: SyncLifecycleDeps, userId: string | null): void {
  const { scheduler, store, subscribeChanges } = deps;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const request = () => scheduler.request();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') request();
    };

    store.ensureOwner(userId).then(
      () => {
        if (!cancelled) scheduler.start();
      },
      () => toast.error('Could not open the saved links on this device. Try reloading the page.'),
    );
    window.addEventListener('focus', request);
    window.addEventListener('online', request);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const unsubscribe = subscribeChanges(userId, request);

    return () => {
      cancelled = true;
      scheduler.stop();
      window.removeEventListener('focus', request);
      window.removeEventListener('online', request);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
    };
  }, [scheduler, store, subscribeChanges, userId]);
}
```

- [ ] **Step 12: Run the lifecycle tests to verify they pass**

Run: `pnpm --filter @linkstash/web test useSyncLifecycle`
Expected: PASS, 5 tests.

- [ ] **Step 13: Implement `apps/web/src/services.ts`**

This file only wires real objects together; every piece of logic in it is tested above or in core. It is not unit-tested because it would open a Supabase websocket. `tsc` checks it, and the manual check in Task 19 exercises it against a real project.

How it handles sync outcomes:
- **Auth:** when the server rejects the access token, the first attempt refreshes the session. If the refresh fails because the network is down, it waits for the next trigger. Any other failure signs out locally and keeps the local data, so signing back in as the same user pushes the queued changes.
- **Retry:** after three consecutive failures while the browser reports it is online, it shows one toast.
- **Realtime:** every subscription gets a unique channel topic, because supabase-js returns the existing channel when a topic is reused.

```ts
import {
  createLinkstashClient,
  fetchMetadata,
  isAuthRetryableFetchError,
  SupabaseRemote,
  SyncEngine,
  type SupabaseClient,
} from '@linkstash/core';
import { createContext, use } from 'react';
import { createActions, type Actions } from './actions';
import { DexieLocalStore, openDb } from './db';
import type { WebConfig } from './env';
import { createSyncScheduler, type SyncScheduler } from './sync/scheduler';
import { errorText, toast } from './toast';

export interface Services {
  supabase: SupabaseClient;
  store: DexieLocalStore;
  engine: SyncEngine;
  scheduler: SyncScheduler;
  actions: Actions;
  subscribeChanges(userId: string, onChange: () => void): () => void;
}

export function createServices(config: WebConfig): Services {
  const supabase = createLinkstashClient(config.supabaseUrl, config.supabasePublishableKey);
  const store = new DexieLocalStore(openDb());
  const engine = new SyncEngine(store, new SupabaseRemote(supabase), {
    onFatalError: (error) => toast.error(`A change could not be saved: ${errorText(error)}`),
  });

  const scheduler = createSyncScheduler({
    run: () => engine.sync(),
    async onAuth(attempt) {
      if (attempt === 0) {
        const { error } = await supabase.auth.refreshSession();
        if (!error) return true;
        if (isAuthRetryableFetchError(error)) return false;
      }
      toast.error('Your session expired. Sign in again to keep syncing.');
      await supabase.auth.signOut({ scope: 'local' });
      return false;
    },
    onRetry(failures) {
      if (failures === 3 && navigator.onLine) toast.error('Cannot reach the server. Your changes are saved here and will sync later.');
    },
    onError: (error) => toast.error(`Sync failed: ${errorText(error)}`),
  });

  let channelCount = 0;
  function subscribeChanges(userId: string, onChange: () => void): () => void {
    const filter = `user_id=eq.${userId}`;
    const channel = supabase
      .channel(`linkstash:${userId}:${++channelCount}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'links', filter }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter }, onChange)
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }

  const actions = createActions({
    engine,
    store,
    requestSync: () => scheduler.request(),
    fetchMetadata: (url) => fetchMetadata(supabase, url),
  });

  return { supabase, store, engine, scheduler, actions, subscribeChanges };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = use(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesContext>');
  return services;
}
```

- [ ] **Step 14: Run all web tests and typecheck**

Run: `pnpm --filter @linkstash/web test; pnpm --filter @linkstash/web typecheck`
Expected: PASS, 40 tests (10 db + 10 actions + 4 share + 3 toast + 1 env + 7 scheduler + 5 lifecycle), and tsc is clean.

- [ ] **Step 15: Commit**

```powershell
git add apps/web
git commit -m "feat(web): add toasts, config, sync scheduler, sync lifecycle and service wiring" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 13: Link list UI (cards, filtering, toaster)

**Files:**
- Create: `apps/web/src/components/IconButton.tsx`, `apps/web/src/components/LinkCard.tsx`, `apps/web/src/components/LinkList.tsx`, `apps/web/src/components/Toaster.tsx`
- Test: `apps/web/src/components/LinkList.test.tsx`, `apps/web/src/components/Toaster.test.tsx`

**Interfaces:**
- Consumes:
  - From `@linkstash/core`: `queryLinks`, `activeCategories`, `LinkQuery` (Task 3); `displayTitle` (Task 2); `faviconFallback`, `hostname` (Task 1)
  - From `@linkstash/ui`: `ColorDot` (Task 9)
  - `Actions` (Task 11); `toast`, `dismiss`, `getToasts`, `useToasts`, `errorText` (Task 12)
- Produces (all in `apps/web/src/components/`):
  - `IconButton({ label, onClick, children, pressed?, className? })`: a square icon button. `label` becomes its accessible name and tooltip.
  - `LinkCard({ link, category?, onOpen, onToggleFavorite, onToggleArchive, onEdit, onDelete })`. The button names are "Favorite" (a toggle with `aria-pressed`), "Archive" or "Unarchive", "Edit" and "Delete". Clicking the title opens the link in a new tab and calls `onOpen`.
  - `type LinkActions = Pick<Actions, 'openLink' | 'toggleFavorite' | 'toggleArchive' | 'deleteLink' | 'restoreLink'>`
  - `LinkList({ links, categories, query: LinkQuery, actions: LinkActions, onEdit(link) })`:
    - Renders `queryLinks(links, query)`, or an empty-state message.
    - Shows a link's category only while that category is active.
    - Delete raises an "Undo" toast. Failed actions raise an error toast.
  - `Toaster()`: renders the toast stack. Errors use `role="alert"`, info uses `role="status"`, and each toast has a "Dismiss" button.

- [ ] **Step 1: Write the failing tests**

The list gets plain arrays and mocked actions, so these tests need no database. Changing `query` re-renders the same list, the way the toolbar will in Task 15.

`apps/web/src/components/LinkList.test.tsx`:
```tsx
import type { LinkQuery } from '@linkstash/core';
import { makeCategory, makeLink } from '@linkstash/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { dismiss, getToasts } from '../toast';
import { LinkList, type LinkActions } from './LinkList';
import { Toaster } from './Toaster';

const food = makeCategory({ id: 'cat-food', name: 'Food', color: '#ef4444' });
const gone = makeCategory({ id: 'cat-gone', name: 'Gone', deleted_at: '2026-01-05T00:00:00.000Z' });

const banana = makeLink({
  id: 'banana',
  title: 'Banana bread',
  url: 'https://bake.example/banana',
  tags: ['recipes'],
  category_id: 'cat-food',
  visit_count: 5,
  created_at: '2026-01-03T00:00:00.000Z',
});
const apple = makeLink({
  id: 'apple',
  title: 'Apple pie',
  url: 'https://apple.example/',
  is_favorite: true,
  category_id: 'cat-gone',
  created_at: '2026-01-01T00:00:00.000Z',
});
const cherry = makeLink({ id: 'cherry', title: 'Cherry news', is_archived: true, created_at: '2026-01-02T00:00:00.000Z' });
const removed = makeLink({ id: 'removed', title: 'Removed', deleted_at: '2026-01-04T00:00:00.000Z' });
const links = [banana, apple, cherry, removed];

let actions: Record<keyof LinkActions, Mock<(id: string) => Promise<void>>>;
let onEdit: Mock<(link: unknown) => void>;

beforeEach(() => {
  const action = () => vi.fn<(id: string) => Promise<void>>(async () => undefined);
  actions = {
    openLink: action(),
    toggleFavorite: action(),
    toggleArchive: action(),
    deleteLink: action(),
    restoreLink: action(),
  };
  onEdit = vi.fn();
  // jsdom cannot open new tabs; stop it from trying when a link title is clicked.
  document.addEventListener('click', preventNavigation);
});

afterEach(() => {
  document.removeEventListener('click', preventNavigation);
  for (const t of getToasts()) dismiss(t.id);
});

function preventNavigation(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault();
}

const list = (query: LinkQuery = {}, items = links) => (
  <>
    <LinkList links={items} categories={[food, gone]} query={query} actions={actions} onEdit={onEdit} />
    <Toaster />
  </>
);

const titles = () => screen.queryAllByRole('link').map((a) => a.textContent);
const card = (title: string) => screen.getByRole('link', { name: title }).closest('li')!;

describe('LinkList', () => {
  it('lists live, unarchived links newest first, with host, tags and active category', () => {
    render(list());
    expect(titles()).toEqual(['Banana bread', 'Apple pie']);

    const bananaCard = within(card('Banana bread'));
    expect(bananaCard.getByText('Food')).toBeTruthy();
    expect(bananaCard.getByText('bake.example')).toBeTruthy();
    expect(bananaCard.getByText('#recipes')).toBeTruthy();
    expect(screen.queryByText('Gone')).toBeNull();
  });

  it('applies search, category, view and sort from the query', () => {
    const { rerender } = render(list({ search: '#recipes' }));
    expect(titles()).toEqual(['Banana bread']);

    rerender(list({ categoryId: 'cat-food' }));
    expect(titles()).toEqual(['Banana bread']);
    rerender(list({ sort: 'alpha' }));
    expect(titles()).toEqual(['Apple pie', 'Banana bread']);
    rerender(list({ sort: 'visits' }));
    expect(titles()).toEqual(['Banana bread', 'Apple pie']);
    rerender(list({ view: 'favorites' }));
    expect(titles()).toEqual(['Apple pie']);
    rerender(list({ view: 'archive' }));
    expect(titles()).toEqual(['Cherry news']);
    expect(within(card('Cherry news')).getByRole('button', { name: 'Unarchive' })).toBeTruthy();
  });

  it('wires the card buttons to the actions', () => {
    render(list());
    fireEvent.click(screen.getByRole('link', { name: 'Banana bread' }));
    expect(actions.openLink).toHaveBeenCalledWith('banana');

    fireEvent.click(within(card('Apple pie')).getByRole('button', { name: 'Favorite', pressed: true }));
    expect(actions.toggleFavorite).toHaveBeenCalledWith('apple');
    fireEvent.click(within(card('Banana bread')).getByRole('button', { name: 'Archive' }));
    expect(actions.toggleArchive).toHaveBeenCalledWith('banana');
    fireEvent.click(within(card('Banana bread')).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(banana);
  });

  it('deletes with an undo toast', async () => {
    render(list());
    fireEvent.click(within(card('Banana bread')).getByRole('button', { name: 'Delete' }));
    expect(actions.deleteLink).toHaveBeenCalledWith('banana');

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(actions.restoreLink).toHaveBeenCalledWith('banana');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
  });

  it('reports a failed action in an error toast', async () => {
    actions.toggleFavorite.mockRejectedValueOnce(new Error('Storage is full'));
    render(list());
    fireEvent.click(within(card('Banana bread')).getByRole('button', { name: 'Favorite' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Storage is full');
  });

  it('explains an empty list', () => {
    const { rerender } = render(list({}, []));
    expect(screen.getByText(/No links yet/)).toBeTruthy();
    rerender(list({ search: 'zzz' }));
    expect(screen.getByText('No links match these filters.')).toBeTruthy();
  });
});
```

`apps/web/src/components/Toaster.test.tsx`:
```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismiss, getToasts, toast } from '../toast';
import { Toaster } from './Toaster';

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
});

describe('Toaster', () => {
  it('shows toasts, runs a toast action, and dismisses toasts', () => {
    const run = vi.fn();
    render(<Toaster />);
    act(() => {
      toast.error('Sync failed');
      toast.info('Link deleted', { label: 'Undo', run });
    });
    expect(screen.getByRole('alert').textContent).toContain('Sync failed');
    expect(screen.getByRole('status').textContent).toContain('Link deleted');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText('Link deleted')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @linkstash/web test components`
Expected: FAIL, because `./LinkList` and `./Toaster` cannot be resolved.

- [ ] **Step 3: Implement the components**

`apps/web/src/components/IconButton.tsx`:
```tsx
import type { ReactNode } from 'react';

export interface IconButtonProps {
  label: string;
  onClick(): void;
  children: ReactNode;
  /** Set for toggle buttons; exposed as aria-pressed. */
  pressed?: boolean;
  className?: string;
}

export function IconButton({ label, onClick, children, pressed, className = '' }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 ' +
        'hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ' +
        `dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${className}`
      }
    >
      {children}
    </button>
  );
}
```

On phones the buttons sit in a row under the text, so long titles keep the full width. From the `sm` breakpoint up they move to a column on the right. Favicons come from the page; if none was stored, or the stored one fails to load, the card falls back to the Google favicon service URL from `faviconFallback`.

`apps/web/src/components/LinkCard.tsx`:
```tsx
import { displayTitle, faviconFallback, hostname, type Category, type Link } from '@linkstash/core';
import { ColorDot } from '@linkstash/ui';
import { Archive, ArchiveRestore, Pencil, Star, Trash2 } from 'lucide-react';
import { IconButton } from './IconButton';

export interface LinkCardProps {
  link: Link;
  /** The link's category, if it is still active. */
  category?: Category;
  onOpen(): void;
  onToggleFavorite(): void;
  onToggleArchive(): void;
  onEdit(): void;
  onDelete(): void;
}

export function LinkCard({ link, category, onOpen, onToggleFavorite, onToggleArchive, onEdit, onDelete }: LinkCardProps) {
  const fallbackIcon = faviconFallback(link.url);

  return (
    <li
      className={
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white p-3 ' +
        'shadow-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] dark:border-slate-800 dark:bg-slate-900'
      }
    >
      <img
        src={link.favicon_url ?? fallbackIcon}
        alt=""
        width={20}
        height={20}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="mt-0.5 size-5 rounded"
        onError={(event) => {
          if (event.currentTarget.src !== fallbackIcon) event.currentTarget.src = fallbackIcon;
        }}
      />
      <div className="min-w-0 space-y-1">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          onAuxClick={(event) => {
            if (event.button === 1) onOpen();
          }}
          className="block truncate font-medium hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
        >
          {displayTitle(link)}
        </a>
        <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {category && (
            <span className="inline-flex shrink-0 items-center gap-1">
              <ColorDot color={category.color} />
              {category.name}
            </span>
          )}
          <span className="truncate">{hostname(link.url)}</span>
        </p>
        {link.description && (
          <p className="line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{link.description}</p>
        )}
        {link.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Tags">
            {link.tags.map((tag) => (
              <li key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                #{tag}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="col-start-2 -ml-2 flex items-center sm:col-start-3 sm:row-start-1 sm:ml-0">
        <IconButton label="Favorite" pressed={link.is_favorite} onClick={onToggleFavorite}>
          <Star className={`size-4 ${link.is_favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
        </IconButton>
        <IconButton label={link.is_archived ? 'Unarchive' : 'Archive'} onClick={onToggleArchive}>
          {link.is_archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        </IconButton>
        <IconButton label="Edit" onClick={onEdit}>
          <Pencil className="size-4" />
        </IconButton>
        <IconButton label="Delete" onClick={onDelete} className="hover:text-red-600 dark:hover:text-red-400">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}
```

`apps/web/src/components/LinkList.tsx`:
```tsx
import { activeCategories, queryLinks, type Category, type Link, type LinkQuery } from '@linkstash/core';
import { useMemo } from 'react';
import type { Actions } from '../actions';
import { errorText, toast } from '../toast';
import { LinkCard } from './LinkCard';

export type LinkActions = Pick<Actions, 'openLink' | 'toggleFavorite' | 'toggleArchive' | 'deleteLink' | 'restoreLink'>;

export interface LinkListProps {
  links: readonly Link[];
  categories: readonly Category[];
  query: LinkQuery;
  actions: LinkActions;
  onEdit(link: Link): void;
}

function report(work: Promise<unknown>): void {
  work.catch((error: unknown) => toast.error(errorText(error)));
}

export function LinkList({ links, categories, query, actions, onEdit }: LinkListProps) {
  const visible = useMemo(() => queryLinks(links, query), [links, query]);
  const categoryById = useMemo(() => new Map(activeCategories(categories).map((c) => [c.id, c])), [categories]);

  if (visible.length === 0) {
    const hasLinks = links.some((link) => !link.deleted_at);
    return (
      <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        {hasLinks ? 'No links match these filters.' : 'No links yet. Add your first one with "Add link".'}
      </p>
    );
  }

  function remove(link: Link) {
    report(
      actions.deleteLink(link.id).then(() => {
        toast.info('Link deleted', { label: 'Undo', run: () => report(actions.restoreLink(link.id)) });
      }),
    );
  }

  return (
    <ul className="space-y-2" aria-label="Links">
      {visible.map((link) => (
        <LinkCard
          key={link.id}
          link={link}
          category={link.category_id ? categoryById.get(link.category_id) : undefined}
          onOpen={() => report(actions.openLink(link.id))}
          onToggleFavorite={() => report(actions.toggleFavorite(link.id))}
          onToggleArchive={() => report(actions.toggleArchive(link.id))}
          onEdit={() => onEdit(link)}
          onDelete={() => remove(link)}
        />
      ))}
    </ul>
  );
}
```

On phones the toasts sit above the floating "Add link" button that Task 15 adds.

`apps/web/src/components/Toaster.tsx`:
```tsx
import { X } from 'lucide-react';
import { dismiss, useToasts } from '../toast';

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={
            'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ' +
            (t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900')
          }
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @linkstash/web test components`
Expected: PASS, 7 tests (6 list + 1 toaster).

- [ ] **Step 5: Run all web tests and typecheck**

Run: `pnpm --filter @linkstash/web test; pnpm --filter @linkstash/web typecheck`
Expected: PASS, 47 tests, and tsc is clean.

- [ ] **Step 6: Commit**

```powershell
git add apps/web
git commit -m "feat(web): add link cards, filtered link list and toaster" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 14: Link sheet and category manager

Adding, editing and category management open in a sheet: a panel that slides up from the bottom on phones and is a centered dialog on wider screens.

**Files:**
- Create: `apps/web/src/components/Sheet.tsx`, `apps/web/src/components/LinkSheet.tsx`, `apps/web/src/components/ColorPalette.tsx`, `apps/web/src/components/CategoryManager.tsx`
- Test: `apps/web/src/components/LinkSheet.test.tsx`, `apps/web/src/components/CategoryManager.test.tsx`

**Interfaces:**
- Consumes:
  - From `@linkstash/core`: `nextCategoryColor`, `CATEGORY_COLORS`, `LIMITS`, and the types `CategoryInput`, `ParsedLinkInput`, `Result` (Task 2); `activeCategories`, `countByCategory` (Task 3); `MemoryLocalStore` (Task 5); `SyncEngine` (Task 6)
  - From `@linkstash/core/testing`: `makeLink`, `makeCategory`, `FakeRemote`
  - From `@linkstash/ui`: `LinkForm`, `linkFormValues`, `Field`, `ColorDot`, `inputClass`, `buttonClass`, `secondaryButtonClass`, `labelClass` (Task 9)
  - `Actions`, `createActions` (Task 11); `toast`, `errorText`, `dismiss`, `getToasts` (Task 12); `IconButton`, `Toaster` (Task 13)
- Produces (all in `apps/web/src/components/`):
  - `Sheet({ title, onClose, children })`:
    - A modal `role="dialog"` named by `title`. It takes focus when it opens and gives focus back to the previously focused element when it closes.
    - Escape, the "Close" button, and pressing on the backdrop all call `onClose`.
  - `type LinkSheetTarget = { mode: 'add'; url?: string; title?: string | null } | { mode: 'edit'; link: Link }`
  - `LinkSheet({ target, categories, actions: Pick<Actions, 'addLink' | 'editLink'>, onClose })`. The sheet is titled "Add link" or "Edit link", and its submit button reads "Save link" or "Save changes".
    - Adding a URL that is already saved shows an info toast and switches the sheet to editing the saved link.
    - After a successful save it shows "Link saved" and calls `onClose`.
  - `ColorPalette({ value, onChange, label = 'Color' })`: one radio per `CATEGORY_COLORS` entry, named "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Indigo", "Purple", "Pink", "Slate".
  - `type CategoryActions = Pick<Actions, 'addCategory' | 'editCategory' | 'deleteCategory'>`
  - `CategoryManager({ categories, links, actions: CategoryActions })`:
    - A form named "New category" with a "Name" field, the palette, and an "Add category" button. Its color starts at `nextCategoryColor`.
    - A list named "Categories" with one row per active category, showing its link count and the buttons "Edit {name}" and "Delete {name}".
    - Editing swaps the row for a form named "Edit {name}" with "Save" and "Cancel".
    - Deleting asks `window.confirm` first.

- [ ] **Step 1: Write the failing link sheet tests**

The sheet runs against real actions over a `MemoryLocalStore`, so the tests check what actually gets stored and queued for sync. `fetchMetadata` returns `null`, so no metadata arrives later.

`apps/web/src/components/LinkSheet.test.tsx`:
```tsx
import { MemoryLocalStore, SyncEngine } from '@linkstash/core';
import { FakeRemote, makeCategory, makeLink } from '@linkstash/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createActions, type Actions } from '../actions';
import { dismiss, getToasts } from '../toast';
import { LinkSheet, type LinkSheetTarget } from './LinkSheet';
import { Toaster } from './Toaster';

const food = makeCategory({ id: 'cat-food', name: 'Food' });

let store: MemoryLocalStore;
let actions: Actions;
let requestSync: Mock<() => void>;
let onClose: Mock<() => void>;

beforeEach(() => {
  store = new MemoryLocalStore();
  requestSync = vi.fn();
  onClose = vi.fn();
  actions = createActions({
    engine: new SyncEngine(store, new FakeRemote()),
    store,
    requestSync,
    fetchMetadata: async () => null,
  });
});

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
});

function renderSheet(target: LinkSheetTarget) {
  return render(
    <>
      <LinkSheet target={target} categories={[food]} actions={actions} onClose={onClose} />
      <Toaster />
    </>,
  );
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('LinkSheet', () => {
  it('adds a link and queues it for sync', async () => {
    renderSheet({ mode: 'add' });
    expect(screen.getByRole('dialog', { name: 'Add link' })).toBeTruthy();

    type('URL', 'example.com/post');
    type('Category', 'cat-food');
    type('Tags', 'Read later, news');
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const [link] = await store.listLinks();
    expect(link).toMatchObject({
      url: 'https://example.com/post',
      title: 'example.com',
      category_id: 'cat-food',
      tags: ['read-later', 'news'],
    });
    expect((await store.peekOutbox()).map((e) => e.mutation)).toEqual([{ type: 'upsertLink', row: link }]);
    expect(requestSync).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Link saved');
  });

  it('prefills a shared link and stores the shared title as the page title', async () => {
    renderSheet({ mode: 'add', url: 'https://example.com/shared', title: 'Shared headline' });
    expect(input('URL').value).toBe('https://example.com/shared');

    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect((await store.listLinks())[0]).toMatchObject({ title: 'Shared headline', custom_title: null });
  });

  it('switches to editing when the link is already saved', async () => {
    await store.apply({ links: [makeLink({ id: 'old', url: 'https://example.com/post', notes: 'Keep this' })] });
    renderSheet({ mode: 'add', url: 'https://example.com/post' });

    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));

    expect(await screen.findByRole('dialog', { name: 'Edit link' })).toBeTruthy();
    expect(input('Notes').value).toBe('Keep this');
    expect(screen.getByRole('status').textContent).toContain('already saved');
    expect(onClose).not.toHaveBeenCalled();
    expect(await store.peekOutbox()).toEqual([]);
  });

  it('edits a link', async () => {
    const link = makeLink({ id: 'l1', url: 'https://example.com/a', title: 'Page title', tags: ['one', 'two'] });
    await store.apply({ links: [link] });
    renderSheet({ mode: 'edit', link });
    expect(input('Title').placeholder).toBe('Page title');
    expect(input('Tags').value).toBe('one, two');

    type('Title', 'My title');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(await store.getLink('l1')).toMatchObject({ custom_title: 'My title', title: 'Page title', tags: ['one', 'two'] });
  });

  it('refuses to point a link at a page that is already saved', async () => {
    const a = makeLink({ id: 'a', url: 'https://example.com/a' });
    await store.apply({ links: [a, makeLink({ id: 'b', url: 'https://example.com/b' })] });
    renderSheet({ mode: 'edit', link: a });

    type('URL', 'https://example.com/b');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Another saved link already points to this page.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape and gives focus back', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderSheet({ mode: 'add' });
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
```

- [ ] **Step 2: Write the failing category manager tests**

`apps/web/src/components/CategoryManager.test.tsx`:
```tsx
import { makeCategory, makeLink } from '@linkstash/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CategoryManager, type CategoryActions } from './CategoryManager';

const food = makeCategory({ id: 'cat-food', name: 'Food', color: '#ef4444' });
const travel = makeCategory({ id: 'cat-travel', name: 'Travel', color: '#3b82f6' });
const old = makeCategory({ id: 'cat-old', name: 'Old', deleted_at: '2026-01-05T00:00:00.000Z' });
const links = [
  makeLink({ id: 'a', category_id: 'cat-food' }),
  makeLink({ id: 'b', category_id: 'cat-food' }),
  makeLink({ id: 'c', category_id: 'cat-travel' }),
  makeLink({ id: 'd', category_id: 'cat-travel', is_archived: true }),
];

let actions: {
  addCategory: Mock<CategoryActions['addCategory']>;
  editCategory: Mock<CategoryActions['editCategory']>;
  deleteCategory: Mock<CategoryActions['deleteCategory']>;
};

beforeEach(() => {
  actions = {
    addCategory: vi.fn(async (input) => ({ ok: true as const, value: makeCategory({ id: 'new', ...input }) })),
    editCategory: vi.fn(async (id, input) => ({ ok: true as const, value: makeCategory({ id, ...input }) })),
    deleteCategory: vi.fn(async () => undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const radio = (scope: ReturnType<typeof within>, name: string) => scope.getByRole('radio', { name }) as HTMLInputElement;
const newForm = () => within(screen.getByRole('form', { name: 'New category' }));

describe('CategoryManager', () => {
  it('lists active categories by name with their link counts', () => {
    render(<CategoryManager categories={[travel, food, old]} links={links} actions={actions} />);

    const rows = within(screen.getByRole('list', { name: 'Categories' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Food')).toBeTruthy();
    expect(within(rows[0]!).getByText('2 links')).toBeTruthy();
    expect(within(rows[1]!).getByText('Travel')).toBeTruthy();
    expect(within(rows[1]!).getByText('1 link')).toBeTruthy();
    expect(screen.queryByText('Old')).toBeNull();
  });

  it('adds a category with the chosen color, then resets the form', async () => {
    render(<CategoryManager categories={[food]} links={[]} actions={actions} />);
    expect(radio(newForm(), 'Orange').checked).toBe(true);

    fireEvent.change(newForm().getByLabelText('Name'), { target: { value: 'Books' } });
    fireEvent.click(radio(newForm(), 'Teal'));
    fireEvent.click(newForm().getByRole('button', { name: 'Add category' }));

    await waitFor(() => expect((newForm().getByLabelText('Name') as HTMLInputElement).value).toBe(''));
    expect(actions.addCategory).toHaveBeenCalledWith({ name: 'Books', color: '#14b8a6' });
    // Red and teal are now taken, so the next suggestion is orange again.
    expect(radio(newForm(), 'Orange').checked).toBe(true);
  });

  it('shows a rejected category inline and keeps the input', async () => {
    actions.addCategory.mockResolvedValueOnce({ ok: false, error: 'A category with that name already exists' });
    render(<CategoryManager categories={[food]} links={[]} actions={actions} />);

    fireEvent.change(newForm().getByLabelText('Name'), { target: { value: 'food' } });
    fireEvent.click(newForm().getByRole('button', { name: 'Add category' }));

    expect((await newForm().findByRole('alert')).textContent).toBe('A category with that name already exists');
    expect((newForm().getByLabelText('Name') as HTMLInputElement).value).toBe('food');
  });

  it('renames and recolors a category', async () => {
    render(<CategoryManager categories={[food]} links={[]} actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Food' }));

    const form = within(screen.getByRole('form', { name: 'Edit Food' }));
    expect(radio(form, 'Red').checked).toBe(true);
    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Groceries' } });
    fireEvent.click(radio(form, 'Green'));
    fireEvent.click(form.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Food' })).toBeNull());
    expect(actions.editCategory).toHaveBeenCalledWith('cat-food', { name: 'Groceries', color: '#22c55e' });
  });

  it('deletes a category only after confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<CategoryManager categories={[food]} links={[]} actions={actions} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Food' }));
    expect(confirm).toHaveBeenCalledWith('Delete "Food"? Its links will stay saved, without a category.');
    expect(actions.deleteCategory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Food' }));
    expect(actions.deleteCategory).toHaveBeenCalledWith('cat-food');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @linkstash/web test LinkSheet CategoryManager`
Expected: FAIL, because `./LinkSheet` and `./CategoryManager` cannot be resolved.

- [ ] **Step 4: Implement the sheet and the link sheet**

The sheet keeps `onClose` in a ref, so its key listener is added once and never sees a stale callback. A `mousedown` on the backdrop closes it; `click` would also fire when a text selection that started inside the panel ends outside it.

`apps/web/src/components/Sheet.tsx`:
```tsx
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';

export interface SheetProps {
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** A modal panel: a bottom sheet on phones, a centered dialog from the `sm` breakpoint up. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-950/50" onMouseDown={() => onCloseRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          'relative flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl focus:outline-none ' +
          'sm:max-w-lg sm:rounded-2xl dark:bg-slate-900'
        }
      >
        <div className="flex items-center justify-between border-b border-slate-200 py-2 pr-2 pl-4 dark:border-slate-800">
          <h2 id={titleId} className="font-semibold">
            {title}
          </h2>
          <IconButton label="Close" onClick={() => onCloseRef.current()}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
```

`LinkForm` reads `initial` only when it mounts, so each target gets its own `key`. When an added URL turns out to be saved already, the sheet switches to that link and the form remounts with the saved values.

`apps/web/src/components/LinkSheet.tsx`:
```tsx
import type { Category, Link, ParsedLinkInput } from '@linkstash/core';
import { LinkForm, linkFormValues } from '@linkstash/ui';
import { useState } from 'react';
import type { Actions } from '../actions';
import { toast } from '../toast';
import { Sheet } from './Sheet';

export type LinkSheetTarget = { mode: 'add'; url?: string; title?: string | null } | { mode: 'edit'; link: Link };

export interface LinkSheetProps {
  target: LinkSheetTarget;
  categories: readonly Category[];
  actions: Pick<Actions, 'addLink' | 'editLink'>;
  onClose(): void;
}

export function LinkSheet({ target: initialTarget, categories, actions, onClose }: LinkSheetProps) {
  const [target, setTarget] = useState(initialTarget);

  async function submit(input: ParsedLinkInput) {
    if (target.mode === 'add') {
      const result = await actions.addLink(input);
      if (result.status === 'duplicate') {
        toast.info('You already saved this link. You can edit it here.');
        setTarget({ mode: 'edit', link: result.link });
        return;
      }
    } else {
      const result = await actions.editLink(target.link.id, input);
      if (result.status === 'duplicate') throw new Error('Another saved link already points to this page.');
    }
    toast.info('Link saved');
    onClose();
  }

  if (target.mode === 'add') {
    return (
      <Sheet title="Add link" onClose={onClose}>
        <LinkForm
          key="add"
          initial={{ url: target.url ?? '' }}
          metadata={{ title: target.title }}
          categories={categories}
          submitLabel="Save link"
          onSubmit={submit}
          onCancel={onClose}
        />
      </Sheet>
    );
  }

  const { link } = target;
  return (
    <Sheet title="Edit link" onClose={onClose}>
      <LinkForm
        key={link.id}
        initial={linkFormValues(link)}
        titlePlaceholder={link.title}
        categories={categories}
        submitLabel="Save changes"
        onSubmit={submit}
        onCancel={onClose}
      />
    </Sheet>
  );
}
```

- [ ] **Step 5: Implement the palette and the category manager**

`apps/web/src/components/ColorPalette.tsx`:
```tsx
import { CATEGORY_COLORS } from '@linkstash/core';
import { labelClass } from '@linkstash/ui';
import { useId } from 'react';

const COLOR_NAMES: Record<(typeof CATEGORY_COLORS)[number], string> = {
  '#ef4444': 'Red',
  '#f97316': 'Orange',
  '#eab308': 'Yellow',
  '#22c55e': 'Green',
  '#14b8a6': 'Teal',
  '#3b82f6': 'Blue',
  '#6366f1': 'Indigo',
  '#a855f7': 'Purple',
  '#ec4899': 'Pink',
  '#64748b': 'Slate',
};

export interface ColorPaletteProps {
  value: string;
  onChange(color: string): void;
  label?: string;
}

export function ColorPalette({ value, onChange, label = 'Color' }: ColorPaletteProps) {
  const name = useId();
  return (
    <fieldset className="space-y-1">
      <legend className={labelClass}>{label}</legend>
      <div className="flex flex-wrap gap-2 pt-1">
        {CATEGORY_COLORS.map((color) => (
          <label key={color} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => onChange(color)}
              aria-label={COLOR_NAMES[color]}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              title={COLOR_NAMES[color]}
              className={
                'block size-7 rounded-full ring-offset-2 ring-offset-white peer-checked:ring-2 peer-checked:ring-slate-900 ' +
                'peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 dark:ring-offset-slate-900 dark:peer-checked:ring-white'
              }
              style={{ backgroundColor: color }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
```

One `CategoryForm` serves both adding and editing. The add form is remounted with a new `key` after each success, which clears it. Its next color is worked out from the list plus the category just created, because the live `categories` prop may not include that one yet.

`apps/web/src/components/CategoryManager.tsx`:
```tsx
import {
  activeCategories,
  countByCategory,
  LIMITS,
  nextCategoryColor,
  type Category,
  type CategoryInput,
  type Link,
  type Result,
} from '@linkstash/core';
import { buttonClass, ColorDot, Field, inputClass, secondaryButtonClass } from '@linkstash/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import type { Actions } from '../actions';
import { errorText, toast } from '../toast';
import { ColorPalette } from './ColorPalette';
import { IconButton } from './IconButton';

export type CategoryActions = Pick<Actions, 'addCategory' | 'editCategory' | 'deleteCategory'>;

export interface CategoryManagerProps {
  categories: readonly Category[];
  links: readonly Link[];
  actions: CategoryActions;
}

interface CategoryFormProps {
  label: string;
  initial: CategoryInput;
  submitLabel: string;
  onSubmit(input: CategoryInput): Promise<Result<Category>>;
  onDone(category: Category): void;
  onCancel?(): void;
}

function CategoryForm({ label, initial, submitLabel, onSubmit, onDone, onCancel }: CategoryFormProps) {
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await onSubmit({ name, color });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      onDone(result.value);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label={label} noValidate onSubmit={handleSubmit} className="space-y-3">
      <Field id={`${id}-name`} label="Name">
        <input
          id={`${id}-name`}
          className={inputClass}
          maxLength={LIMITS.categoryName}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <ColorPalette value={color} onChange={setColor} />
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={buttonClass} disabled={pending}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

const linkCount = (n: number) => (n === 1 ? '1 link' : `${n} links`);

export function CategoryManager({ categories, links, actions }: CategoryManagerProps) {
  const list = useMemo(() => activeCategories(categories), [categories]);
  const counts = useMemo(() => countByCategory(links), [links]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState(() => ({ key: 0, color: nextCategoryColor(categories) }));

  function remove(category: Category) {
    if (!window.confirm(`Delete "${category.name}"? Its links will stay saved, without a category.`)) return;
    actions.deleteCategory(category.id).catch((error: unknown) => toast.error(errorText(error)));
  }

  return (
    <div className="space-y-6">
      <CategoryForm
        key={addForm.key}
        label="New category"
        initial={{ name: '', color: addForm.color }}
        submitLabel="Add category"
        onSubmit={actions.addCategory}
        onDone={(created) =>
          setAddForm((form) => ({ key: form.key + 1, color: nextCategoryColor([...categories, created]) }))
        }
      />
      {list.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No categories yet.</p>
      ) : (
        <ul aria-label="Categories" className="divide-y divide-slate-200 dark:divide-slate-800">
          {list.map((category) => (
            <li key={category.id} className="py-2">
              {editingId === category.id ? (
                <CategoryForm
                  label={`Edit ${category.name}`}
                  initial={{ name: category.name, color: category.color }}
                  submitLabel="Save"
                  onSubmit={(input) => actions.editCategory(category.id, input)}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <ColorDot color={category.color} />
                  <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {linkCount(counts[category.id] ?? 0)}
                  </span>
                  <IconButton label={`Edit ${category.name}`} onClick={() => setEditingId(category.id)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Delete ${category.name}`}
                    onClick={() => remove(category)}
                    className="hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @linkstash/web test LinkSheet CategoryManager`
Expected: PASS, 11 tests (6 sheet + 5 manager).

- [ ] **Step 7: Run all web tests and typecheck**

Run: `pnpm --filter @linkstash/web test; pnpm --filter @linkstash/web typecheck`
Expected: PASS, 58 tests, and tsc is clean.

- [ ] **Step 8: Commit**

```powershell
git add apps/web
git commit -m "feat(web): add link sheet and category manager" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 15: App shell

This task connects everything into the running app.
- Live data hooks over Dexie.
- The library screen: toolbar, filters, link list, sheets, status badge and sign-out.
- The sign-in screen.
- `App`, which picks the screen and keeps sync running.
- The `main.tsx` entry point, which also reads links shared to the installed app.

**Files:**
- Create:
  - `apps/web/src/hooks.ts`, `apps/web/src/Library.tsx`
  - `apps/web/src/components/Toolbar.tsx`, `apps/web/src/components/FilterNav.tsx`, `apps/web/src/components/StatusBadge.tsx`, `apps/web/src/components/AuthScreen.tsx`, `apps/web/src/components/SetupNotice.tsx`
  - `apps/web/src/test/fakeServices.tsx`
- Modify (replace the Task 10 placeholders): `apps/web/src/App.tsx`, `apps/web/src/main.tsx`
- Test: `apps/web/src/Library.test.tsx`, `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes:
  - From `@linkstash/core`: the types `Link`, `Category`, `LinkQuery`, `LinkSort`, `LinkView`, `Session`, `SupabaseClient`; `activeCategories`, `countByCategory`, `SyncEngine`
  - From `@linkstash/core/testing`: `makeLink`, `makeCategory`, `FakeRemote`
  - From `@linkstash/ui`: `AuthForm`, `AuthResult`, `ColorDot`, `inputClass`
  - `DexieLocalStore`, `openDb` (Task 10)
  - `createActions` (Task 11)
  - `Services`, `ServicesContext`, `useServices`, `createServices`, `toast`, `errorText`, `useSyncLifecycle` (Task 12)
  - `readConfig` (Task 10); `parseSharedLink`, `SharedLink` (Task 11)
  - `IconButton`, `LinkList`, `Toaster` (Task 13); `Sheet`, `LinkSheet`, `LinkSheetTarget`, `CategoryManager` (Task 14)
- Produces:
  - `apps/web/src/hooks.ts`:
    - `useLinks(store)` and `useCategories(store)` return all rows (`undefined` while loading).
    - `usePendingCount(store): number`
    - `useOwner(store): string | null | undefined` gives `undefined` while loading and `null` when no user owns the data.
    - `useOnline(): boolean`
    - `useSession(supabase): SessionState`, where `SessionState = { status: 'loading' } | { status: 'ready'; session: Session | null }`.
  - `Library({ share?, onShareOpened? })`: the main screen. Its controls are:
    - the "Search links" box and the "Sort" select
    - a "View" group with "All", "Favorites" and "Archive"
    - a "Category filter" group
    - the buttons "Manage categories", "Add link" and "Sign out"
  - `App({ share? })`: the root inside `<ServicesContext>`. Task 16 does not change it.
  - Test helpers in `apps/web/src/test/fakeServices.tsx`:
    - `createFakeServices(session?)` returns `{ services, auth, store, scheduler }`, typed as `FakeServices`.
    - `fakeSession(userId)` and `renderWithServices(ui, services)`.

How `App` picks a screen:
- With a session, it shows the library once this device's data belongs to that user. `useSyncLifecycle` sets the owner, and first wipes another account's data if there is any.
- Without a session but with saved data, it shows the library only while offline. That happens when the stored session expired and could not be refreshed without a connection.
- Otherwise it shows the sign-in screen.

- [ ] **Step 1: Write the test helpers**

The fake services use the real Dexie store, sync engine and actions over `fake-indexeddb`. Only Supabase Auth and the sync scheduler are fakes. Each call opens a fresh database, so tests do not share data.

`apps/web/src/test/fakeServices.tsx`:
```tsx
import { SyncEngine, type Session, type SupabaseClient } from '@linkstash/core';
import { FakeRemote } from '@linkstash/core/testing';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { createActions } from '../actions';
import { DexieLocalStore, openDb } from '../db';
import { ServicesContext, type Services } from '../services';

type AuthListener = (event: string, session: Session | null) => void;

export function fakeSession(userId: string): Session {
  return { access_token: `token-${userId}`, user: { id: userId, email: `${userId}@example.com` } } as unknown as Session;
}

/** The parts of `supabase.auth` the app uses. Signing in always signs in as user-1. */
export function createFakeAuth(initial: Session | null) {
  let session = initial;
  const listeners = new Set<AuthListener>();
  const emit = (event: string, next: Session | null) => {
    session = next;
    for (const listener of listeners) listener(event, next);
  };
  return {
    emit,
    onAuthStateChange: vi.fn((listener: AuthListener) => {
      listeners.add(listener);
      // Like supabase-js, report the stored session asynchronously.
      queueMicrotask(() => listener('INITIAL_SESSION', session));
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    }),
    signInWithPassword: vi.fn(async (_credentials: { email: string; password: string }) => {
      const next = fakeSession('user-1');
      emit('SIGNED_IN', next);
      return { data: { session: next, user: next.user }, error: null };
    }),
    signUp: vi.fn(async (_credentials: { email: string; password: string }) => ({
      data: { session: null, user: null },
      error: null,
    })),
    signOut: vi.fn(async (_options?: { scope?: string }) => {
      emit('SIGNED_OUT', null);
      return { error: null };
    }),
  };
}

export type FakeAuth = ReturnType<typeof createFakeAuth>;

let databases = 0;

export function createFakeServices(session: Session | null = null) {
  const auth = createFakeAuth(session);
  const store = new DexieLocalStore(openDb(`linkstash-test-${++databases}`));
  const engine = new SyncEngine(store, new FakeRemote());
  const scheduler = { start: vi.fn(), stop: vi.fn(), request: vi.fn() };
  const services: Services = {
    supabase: { auth } as unknown as SupabaseClient,
    store,
    engine,
    scheduler,
    actions: createActions({ engine, store, requestSync: scheduler.request, fetchMetadata: async () => null }),
    subscribeChanges: vi.fn(() => () => {}),
  };
  return { services, auth, store, scheduler };
}

export type FakeServices = ReturnType<typeof createFakeServices>;

export function renderWithServices(ui: ReactElement, services: Services) {
  return render(<ServicesContext value={services}>{ui}</ServicesContext>);
}
```

- [ ] **Step 2: Write the failing library tests**

`apps/web/src/Library.test.tsx`:
```tsx
import { makeCategory, makeLink } from '@linkstash/core/testing';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Library } from './Library';
import { createFakeServices, fakeSession, renderWithServices, type FakeServices } from './test/fakeServices';
import { dismiss, getToasts } from './toast';

let fake: FakeServices;

beforeEach(() => {
  fake = createFakeServices(fakeSession('user-1'));
});

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
  vi.restoreAllMocks();
});

const titles = () =>
  within(screen.getByRole('list', { name: 'Links' }))
    .getAllByRole('link')
    .map((a) => a.textContent);
const viewButton = (name: string) => within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name });

describe('Library', () => {
  it('filters by view, category and search, and sorts', async () => {
    await fake.store.apply({
      categories: [makeCategory({ id: 'cat-food', name: 'Food' }), makeCategory({ id: 'cat-travel', name: 'Travel' })],
      links: [
        makeLink({ title: 'Pasta recipe', category_id: 'cat-food', tags: ['dinner'], created_at: '2026-01-03T00:00:00.000Z' }),
        makeLink({ title: 'Zurich guide', category_id: 'cat-travel', is_favorite: true, created_at: '2026-01-02T00:00:00.000Z' }),
        makeLink({ title: 'Old manual', is_archived: true }),
      ],
    });
    renderWithServices(<Library />, fake.services);

    await screen.findByRole('link', { name: 'Pasta recipe' });
    expect(titles()).toEqual(['Pasta recipe', 'Zurich guide']);

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
    expect(titles()).toEqual(['Zurich guide', 'Pasta recipe']);

    fireEvent.click(viewButton('Favorites'));
    expect(titles()).toEqual(['Zurich guide']);
    fireEvent.click(viewButton('All'));

    const food = within(screen.getByRole('group', { name: 'Category filter' })).getByRole('button', { name: /^Food/ });
    fireEvent.click(food);
    expect(food.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toEqual(['Pasta recipe']);
    fireEvent.click(food);
    expect(titles()).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: '#dinner' } });
    expect(titles()).toEqual(['Pasta recipe']);
    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: '' } });

    fireEvent.click(viewButton('Archive'));
    expect(titles()).toEqual(['Old manual']);
  });

  it('adds a link and shows it as a pending change', async () => {
    renderWithServices(<Library />, fake.services);
    await screen.findByText(/No links yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const dialog = screen.getByRole('dialog', { name: 'Add link' });
    fireEvent.change(within(dialog).getByLabelText('URL'), { target: { value: 'example.com/new' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save link' }));

    expect(await screen.findByRole('link', { name: 'example.com' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('1 pending')).toBeTruthy();
    expect(fake.scheduler.request).toHaveBeenCalled();
  });

  it('opens a shared link in the add sheet', async () => {
    const onShareOpened = vi.fn();
    renderWithServices(
      <Library share={{ url: 'https://example.com/shared', title: 'Shared page' }} onShareOpened={onShareOpened} />,
      fake.services,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Add link' });
    expect((within(dialog).getByLabelText('URL') as HTMLInputElement).value).toBe('https://example.com/shared');
    expect(onShareOpened).toHaveBeenCalledOnce();
  });

  it('confirms before discarding unsynced changes, then signs out and clears this device', async () => {
    const link = makeLink({ title: 'Unsynced' });
    await fake.store.apply({ links: [link], mutations: [{ type: 'upsertLink', row: link }] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithServices(<Library />, fake.services);
    await screen.findByText('1 pending');

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(fake.auth.signOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByText(/No links yet/);
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await fake.store.peekOutbox()).toEqual([]);
  });

  it('manages categories from the filter bar', async () => {
    renderWithServices(<Library />, fake.services);
    await screen.findByText(/No links yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Manage categories' }));
    const dialog = screen.getByRole('dialog', { name: 'Manage categories' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Books' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    await within(dialog).findByText('Books');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    const filter = await screen.findByRole('group', { name: 'Category filter' });
    expect(within(filter).getByRole('button', { name: /^Books/ })).toBeTruthy();
  });
});
```

- [ ] **Step 3: Write the failing app tests**

`navigator.onLine` is a getter, so the offline tests spy on it. `vi.restoreAllMocks()` puts it back.

`apps/web/src/App.test.tsx`:
```tsx
import { makeLink } from '@linkstash/core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { createFakeServices, fakeSession, renderWithServices } from './test/fakeServices';
import { dismiss, getToasts } from './toast';

afterEach(() => {
  for (const t of getToasts()) dismiss(t.id);
  vi.restoreAllMocks();
});

const goOffline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('App', () => {
  it('signs in and opens the library', async () => {
    const { services, auth, scheduler } = createFakeServices();
    renderWithServices(<App />, services);

    await screen.findByRole('heading', { name: 'Sign in to Linkstash' });
    fillCredentials('me@example.com', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.com', password: 'secret1' });
    expect(scheduler.start).toHaveBeenCalled();
  });

  it('restores the session and starts syncing', async () => {
    const { services, store, scheduler } = createFakeServices(fakeSession('user-1'));
    await store.ensureOwner('user-1');
    await store.apply({ links: [makeLink({ title: 'Kept' })] });
    renderWithServices(<App />, services);

    expect(await screen.findByRole('link', { name: 'Kept' })).toBeTruthy();
    await waitFor(() => expect(scheduler.start).toHaveBeenCalled());
  });

  it('shows saved links offline when the session could not be restored', async () => {
    goOffline();
    const { services, store, scheduler } = createFakeServices();
    await store.ensureOwner('user-1');
    await store.apply({ links: [makeLink({ title: 'Kept' })] });
    renderWithServices(<App />, services);

    expect(await screen.findByRole('link', { name: 'Kept' })).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('explains that signing in needs a connection', async () => {
    goOffline();
    const { services, auth } = createFakeServices();
    renderWithServices(<App />, services);

    await screen.findByRole('heading', { name: 'Sign in to Linkstash' });
    fillCredentials('me@example.com', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toBe('You are offline. Connect to the internet to sign in.');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('asks new users to confirm their email', async () => {
    const { services, auth } = createFakeServices();
    renderWithServices(<App />, services);

    await screen.findByRole('heading', { name: 'Sign in to Linkstash' });
    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    fillCredentials('new@example.com', 'secret1');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Check your email to confirm your account, then sign in.')).toBeTruthy();
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'secret1' });
  });

  it("removes another account's links before showing the library", async () => {
    const { services, store } = createFakeServices(fakeSession('user-1'));
    await store.ensureOwner('user-2');
    await store.apply({ links: [makeLink({ title: 'Not yours' })] });
    renderWithServices(<App />, services);

    await screen.findByText(/No links yet/);
    expect(screen.queryByText('Not yours')).toBeNull();
    expect(await store.listLinks()).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @linkstash/web test Library App`
Expected: FAIL, because `./Library` cannot be resolved and `App` does not accept `share` or render any screen yet.

- [ ] **Step 5: Implement the hooks**

`useLiveQuery` re-runs its query whenever a table it read changes, including writes made by the sync engine. Supabase reports the stored session as its first `onAuthStateChange` event (`INITIAL_SESSION`), so `useSession` needs no separate `getSession()` call.

`apps/web/src/hooks.ts`:
```ts
import type { Category, Link, Session, SupabaseClient } from '@linkstash/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DexieLocalStore } from './db';

/** Every link row on this device, including archived and deleted ones. `undefined` while loading. */
export function useLinks(store: DexieLocalStore): Link[] | undefined {
  return useLiveQuery(() => store.db.links.toArray(), [store]);
}

/** Every category row on this device, including deleted ones. `undefined` while loading. */
export function useCategories(store: DexieLocalStore): Category[] | undefined {
  return useLiveQuery(() => store.db.categories.toArray(), [store]);
}

/** Number of local changes that have not reached the server yet. */
export function usePendingCount(store: DexieLocalStore): number {
  return useLiveQuery(() => store.db.outbox.count(), [store], 0);
}

/** The user whose data is on this device: `undefined` while loading, `null` when there is none. */
export function useOwner(store: DexieLocalStore): string | null | undefined {
  return useLiveQuery(() => store.getOwner(), [store]);
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

export type SessionState = { status: 'loading' } | { status: 'ready'; session: Session | null };

export function useSession(supabase: SupabaseClient): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ status: 'ready', session }));
    return () => data.subscription.unsubscribe();
  }, [supabase]);
  return state;
}
```

- [ ] **Step 6: Implement the toolbar, filters and status badge**

`inputClass` includes `w-full`, so the sort select sits in a fixed-width wrapper instead of fighting that class.

`apps/web/src/components/Toolbar.tsx`:
```tsx
import type { LinkSort } from '@linkstash/core';
import { inputClass } from '@linkstash/ui';
import { Search } from 'lucide-react';

const SORTS: { value: LinkSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'alpha', label: 'A–Z' },
  { value: 'visits', label: 'Most visited' },
];

export interface ToolbarProps {
  search: string;
  onSearchChange(search: string): void;
  sort: LinkSort;
  onSortChange(sort: LinkSort): void;
}

export function Toolbar({ search, onSearchChange, sort, onSortChange }: ToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
        />
        <input
          type="search"
          aria-label="Search links"
          placeholder="Search, or #tag"
          className={`${inputClass} pl-9`}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="w-36 shrink-0">
        <select
          aria-label="Sort"
          className={inputClass}
          value={sort}
          onChange={(e) => onSortChange(e.target.value as LinkSort)}
        >
          {SORTS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

On phones the filters are a row of tabs above a horizontally scrolling row of category chips. From the `md` breakpoint they stack as a sidebar. Pressing the selected category chip again clears the filter.

`apps/web/src/components/FilterNav.tsx`:
```tsx
import { activeCategories, countByCategory, type Category, type Link, type LinkView } from '@linkstash/core';
import { ColorDot } from '@linkstash/ui';
import { Archive, Inbox, Settings2, Star, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';

const VIEWS: { value: LinkView; label: string; Icon: LucideIcon }[] = [
  { value: 'all', label: 'All', Icon: Inbox },
  { value: 'favorites', label: 'Favorites', Icon: Star },
  { value: 'archive', label: 'Archive', Icon: Archive },
];

export interface FilterNavProps {
  view: LinkView;
  onViewChange(view: LinkView): void;
  categoryId: string | null;
  onCategoryChange(categoryId: string | null): void;
  categories: readonly Category[];
  links: readonly Link[];
  onManageCategories(): void;
}

const itemClass = (selected: boolean) =>
  'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm md:w-full ' +
  (selected
    ? 'bg-indigo-600 text-white'
    : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800');

export function FilterNav(props: FilterNavProps) {
  const { view, onViewChange, categoryId, onCategoryChange, categories, links, onManageCategories } = props;
  const list = useMemo(() => activeCategories(categories), [categories]);
  const counts = useMemo(() => countByCategory(links), [links]);

  return (
    <nav aria-label="Filters" className="space-y-2 md:space-y-6">
      <div role="group" aria-label="View" className="flex gap-1 md:flex-col">
        {VIEWS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            className={itemClass(view === value)}
            onClick={() => onViewChange(value)}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
        <h2 className="hidden px-3 text-xs font-semibold tracking-wide text-slate-500 uppercase md:block">Categories</h2>
        {list.length > 0 && (
          <div role="group" aria-label="Category filter" className="flex gap-2 md:flex-col md:gap-1">
            {list.map((category) => {
              const selected = categoryId === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={selected}
                  className={itemClass(selected)}
                  onClick={() => onCategoryChange(selected ? null : category.id)}
                >
                  <ColorDot color={category.color} />
                  <span className="max-w-40 truncate md:flex-1 md:text-left">{category.name}</span>
                  <span className="text-xs opacity-70">{counts[category.id] ?? 0}</span>
                </button>
              );
            })}
          </div>
        )}
        <button type="button" className={itemClass(false)} onClick={onManageCategories}>
          <Settings2 aria-hidden="true" className="size-4" />
          Manage categories
        </button>
      </div>
    </nav>
  );
}
```

`apps/web/src/components/StatusBadge.tsx`:
```tsx
import { CloudOff, RefreshCw } from 'lucide-react';

export interface StatusBadgeProps {
  online: boolean;
  /** Local changes not yet on the server. */
  pending: number;
}

export function StatusBadge({ online, pending }: StatusBadgeProps) {
  if (online && pending === 0) return null;
  const parts = [!online && 'Offline', pending > 0 && `${pending} pending`].filter(Boolean);
  const Icon = online ? RefreshCw : CloudOff;
  return (
    <span
      title={online ? 'Changes waiting to sync' : 'Offline. Changes sync when you reconnect.'}
      className={
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium ' +
        'text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      }
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {parts.join(' · ')}
    </span>
  );
}
```

- [ ] **Step 7: Implement the library screen**

Layout notes:
- On phones the page stacks header, filters and list, with the "Add link" button floating at the bottom right.
- From `md` up, a grid puts the filters in a sticky left sidebar, and the same button sits in the header with its label visible.
- Each control exists once in the DOM, so tests and screen readers never see duplicates.
- The header must not get `backdrop-blur`. A backdrop filter would become the containing block for the `fixed` button inside it.

Other behavior:
- A category filter whose category was deleted, here or on another device, is ignored rather than hiding every link.
- Sign-out clears the device only after Supabase has signed out. If there are unsynced changes, it asks first.

`apps/web/src/Library.tsx`:
```tsx
import type { Link, LinkQuery, LinkSort, LinkView } from '@linkstash/core';
import { Bookmark, LogOut, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CategoryManager } from './components/CategoryManager';
import { FilterNav } from './components/FilterNav';
import { IconButton } from './components/IconButton';
import { LinkList } from './components/LinkList';
import { LinkSheet, type LinkSheetTarget } from './components/LinkSheet';
import { Sheet } from './components/Sheet';
import { StatusBadge } from './components/StatusBadge';
import { Toolbar } from './components/Toolbar';
import { useCategories, useLinks, useOnline, usePendingCount } from './hooks';
import { useServices } from './services';
import type { SharedLink } from './share';
import { errorText, toast } from './toast';

type OpenSheet = { kind: 'link'; target: LinkSheetTarget } | { kind: 'categories' } | null;

export interface LibraryProps {
  /** A link shared to the installed app. It opens in the add sheet. */
  share?: SharedLink | null;
  /** Called once the shared link is open, so the parent can drop it. */
  onShareOpened?(): void;
}

function Brand({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-center gap-2 font-semibold ${className}`}>
      <Bookmark aria-hidden="true" className="size-5 text-indigo-600 dark:text-indigo-400" />
      Linkstash
    </p>
  );
}

const addButtonClass =
  'fixed right-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 inline-flex size-14 items-center ' +
  'justify-center gap-2 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ' +
  'md:static md:h-auto md:w-auto md:rounded-lg md:px-4 md:py-2 md:text-sm md:font-medium md:shadow-none';

export function Library({ share = null, onShareOpened }: LibraryProps) {
  const { supabase, store, actions } = useServices();
  const links = useLinks(store);
  const categories = useCategories(store);
  const pending = usePendingCount(store);
  const online = useOnline();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LinkSort>('newest');
  const [view, setView] = useState<LinkView>('all');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<OpenSheet>(null);

  useEffect(() => {
    if (!share) return;
    setSheet({ kind: 'link', target: { mode: 'add', url: share.url, title: share.title } });
    onShareOpened?.();
  }, [share, onShareOpened]);

  const activeCategoryId =
    categoryId && categories?.some((c) => c.id === categoryId && !c.deleted_at) ? categoryId : null;
  const query = useMemo<LinkQuery>(
    () => ({ search, sort, view, categoryId: activeCategoryId }),
    [search, sort, view, activeCategoryId],
  );

  const closeSheet = () => setSheet(null);
  const openAdd = () => setSheet({ kind: 'link', target: { mode: 'add' } });
  const openEdit = (link: Link) => setSheet({ kind: 'link', target: { mode: 'edit', link } });

  async function signOut() {
    if (pending > 0 && !window.confirm('Some changes have not synced yet and will be lost. Sign out anyway?')) return;
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      toast.error(`Could not sign out: ${error.message}`);
      return;
    }
    await store.clear();
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-[auto_1fr]">
      <header
        className={
          'sticky top-0 z-30 border-b border-slate-200 bg-slate-50 pt-[env(safe-area-inset-top)] ' +
          'md:col-start-2 md:row-start-1 dark:border-slate-800 dark:bg-slate-950'
        }
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-2">
          <Brand className="md:hidden" />
          <div className="order-last w-full md:order-none md:w-auto md:flex-1">
            <Toolbar search={search} onSearchChange={setSearch} sort={sort} onSortChange={setSort} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <StatusBadge online={online} pending={pending} />
            <button type="button" className={addButtonClass} onClick={openAdd}>
              <Plus aria-hidden="true" className="size-6 md:size-4" />
              <span className="sr-only md:not-sr-only">Add link</span>
            </button>
            <IconButton label="Sign out" onClick={() => void signOut().catch((e: unknown) => toast.error(errorText(e)))}>
              <LogOut className="size-4" />
            </IconButton>
          </div>
        </div>
      </header>
      <aside
        className={
          'border-b border-slate-200 px-4 py-3 md:sticky md:top-0 md:col-start-1 md:row-span-2 md:row-start-1 ' +
          'md:h-dvh md:overflow-y-auto md:border-r md:border-b-0 md:py-4 dark:border-slate-800'
        }
      >
        <Brand className="mb-6 hidden px-3 md:flex" />
        <FilterNav
          view={view}
          onViewChange={setView}
          categoryId={activeCategoryId}
          onCategoryChange={setCategoryId}
          categories={categories ?? []}
          links={links ?? []}
          onManageCategories={() => setSheet({ kind: 'categories' })}
        />
      </aside>
      <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-28 md:col-start-2 md:row-start-2 md:pb-8">
        {links && categories && (
          <LinkList links={links} categories={categories} query={query} actions={actions} onEdit={openEdit} />
        )}
      </main>
      {sheet?.kind === 'link' && (
        <LinkSheet target={sheet.target} categories={categories ?? []} actions={actions} onClose={closeSheet} />
      )}
      {sheet?.kind === 'categories' && (
        <Sheet title="Manage categories" onClose={closeSheet}>
          <CategoryManager categories={categories ?? []} links={links ?? []} actions={actions} />
        </Sheet>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Implement the sign-in and setup screens, the app root and the entry point**

When "Confirm email" is on in Supabase, `signUp` creates the user but returns no session until the emailed link is opened.

`apps/web/src/components/AuthScreen.tsx`:
```tsx
import type { SupabaseClient } from '@linkstash/core';
import { AuthForm, type AuthResult } from '@linkstash/ui';
import { Bookmark } from 'lucide-react';

const OFFLINE: AuthResult = { error: 'You are offline. Connect to the internet to sign in.' };

export interface AuthScreenProps {
  supabase: SupabaseClient;
  online: boolean;
}

export function AuthScreen({ supabase, online }: AuthScreenProps) {
  async function signIn(email: string, password: string): Promise<AuthResult> {
    if (!online) return OFFLINE;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }

  async function signUp(email: string, password: string): Promise<AuthResult> {
    if (!online) return OFFLINE;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return data.session ? {} : { info: 'Check your email to confirm your account, then sign in.' };
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
          <Bookmark aria-hidden="true" className="size-4" />
          Linkstash
        </p>
        <AuthForm onSignIn={signIn} onSignUp={signUp} />
      </div>
    </main>
  );
}
```

`apps/web/src/components/SetupNotice.tsx`:
```tsx
export function SetupNotice() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Connect Linkstash to Supabase</h1>
      <p>
        This build has no Supabase settings. Copy <code>apps/web/.env.example</code> to <code>apps/web/.env</code>, set{' '}
        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>, then restart <code>pnpm dev</code> or
        build again.
      </p>
      <p>The README's "Supabase setup" section shows where to find both values.</p>
    </main>
  );
}
```

`apps/web/src/App.tsx`:
```tsx
import { useCallback, useState, type ReactNode } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { Toaster } from './components/Toaster';
import { useOnline, useOwner, useSession } from './hooks';
import { Library } from './Library';
import { useServices } from './services';
import type { SharedLink } from './share';
import { useSyncLifecycle } from './sync/useSyncLifecycle';

export interface AppProps {
  /** A link shared to the installed app before it started. */
  share?: SharedLink | null;
}

export function App({ share: sharedAtStart = null }: AppProps) {
  const services = useServices();
  const session = useSession(services.supabase);
  const owner = useOwner(services.store);
  const online = useOnline();
  const [share, setShare] = useState(sharedAtStart);
  const clearShare = useCallback(() => setShare(null), []);

  const userId = session.status === 'ready' ? (session.session?.user.id ?? null) : null;
  useSyncLifecycle(services, userId);

  let screen: ReactNode = null;
  if (session.status === 'ready' && owner !== undefined) {
    const library = <Library share={share} onShareOpened={clearShare} />;
    if (userId) {
      // Shown once useSyncLifecycle has claimed this device's data for the user.
      if (owner === userId) screen = library;
    } else if (owner && !online) {
      // The stored session could not be refreshed offline. The links on this device are still readable.
      screen = library;
    } else {
      screen = <AuthScreen supabase={services.supabase} online={online} />;
    }
  }

  return (
    <>
      {screen}
      <Toaster />
    </>
  );
}
```

`main.tsx` reads a shared link before the first render, then replaces `/share?…` in the address bar with `/`. A reload therefore does not open the same share again.

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SetupNotice } from './components/SetupNotice';
import { readConfig } from './env';
import './index.css';
import { createServices, ServicesContext } from './services';
import { parseSharedLink } from './share';

const config = readConfig();
const services = config ? createServices(config) : null;

// The Android share sheet opens the installed app at /share?title=…&text=…&url=…
const sharing = location.pathname === '/share';
const share = sharing ? parseSharedLink(new URLSearchParams(location.search)) : null;
if (sharing) history.replaceState(null, '', '/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {services ? (
      <ServicesContext value={services}>
        <App share={share} />
      </ServicesContext>
    ) : (
      <SetupNotice />
    )}
  </StrictMode>,
);
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @linkstash/web test Library App`
Expected: PASS, 11 tests (5 library + 6 app).

- [ ] **Step 10: Run all web tests, typecheck and build**

Run: `pnpm --filter @linkstash/web test; pnpm --filter @linkstash/web build`
Expected: PASS, 69 tests. `build` runs `tsc` and then `vite build`, and both succeed. Without `apps/web/.env` the built app shows the setup notice; that is expected here.

- [ ] **Step 11: Commit**

```powershell
git add apps/web
git commit -m "feat(web): add library screen, sign-in and app shell" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 16: PWA manifest, service worker and icons

Two things make the app work offline. Dexie already keeps the user's data on the device. In this task the service worker adds the app shell: it precaches the built HTML, JS, CSS and icons. This task also adds the web app manifest and the iOS tags, which make the app installable on Android, iOS and desktop.

`vite-plugin-pwa` writes `manifest.webmanifest`, `sw.js` and `registerSW.js` at build time. It also adds the manifest link and the registration script to `index.html`, so no app code changes. The service worker exists only in production builds (`vite build` / `vite preview`), not under `vite dev`.

**Files:**
- Create: `apps/web/public/logo.svg`
- Generate and commit: `apps/web/public/favicon.ico`, `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`
- Create: `apps/web/scripts/check-pwa.mjs` (the test: checks the build output)
- Modify: `apps/web/package.json` (dev dependencies; `icons` and `check:pwa` scripts)
- Modify (replace): `apps/web/vite.config.ts`, `apps/web/index.html`

**Interfaces:**
- Consumes: the `/share` handling in `apps/web/src/main.tsx` (Task 15), which reads the manifest's `share_target` request.
- Produces:
  - Build output in `apps/web/dist`: `manifest.webmanifest`, `sw.js`, `registerSW.js` and the icons.
  - `pnpm --filter @linkstash/web check:pwa`, which Task 19's final verification runs after a build.
  - The logo artwork (indigo `#4f46e5` rounded square, white bookmark). Task 17 reuses the same SVG for the extension icon.

- [ ] **Step 1: Add the PWA dependencies and scripts**

Run: `pnpm --filter @linkstash/web add -D vite-plugin-pwa@^2.0.0 @vite-pwa/assets-generator@^2.0.0 workbox-window@^7.4.1`
Expected: it completes. If pnpm lists ignored build scripts (for example `sharp`, which the icon generator uses), run `pnpm approve-builds` and approve them.

Then add two scripts. The `scripts` block of `apps/web/package.json` becomes:
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -p . && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p .",
    "icons": "pwa-assets-generator --preset minimal-2023 public/logo.svg",
    "check:pwa": "node scripts/check-pwa.mjs"
  },
```

- [ ] **Step 2: Write the failing check**

Installability is a property of the build output, so the test is a small Node script that reads `dist/`. It uses only Node built-ins and prints every missing item.

`apps/web/scripts/check-pwa.mjs`:
```js
// Checks the production build for what makes Linkstash installable and usable offline.
// Run it after `vite build`: pnpm --filter @linkstash/web check:pwa
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const read = (file) => {
  const path = join(dist, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};

const html = read('index.html');
check(html.includes('rel="manifest"'), 'index.html links the web app manifest');
check(html.includes('registerSW.js'), 'index.html registers the service worker');
check(html.includes('rel="apple-touch-icon"'), 'index.html has an apple-touch-icon (iOS home screen)');
check(html.includes('apple-mobile-web-app-capable'), 'index.html has the iOS standalone meta tag');

const manifestText = read('manifest.webmanifest');
check(manifestText !== '', 'dist/manifest.webmanifest exists');
const manifest = manifestText ? JSON.parse(manifestText) : {};
check(manifest.start_url === '/', 'manifest start_url is /');
check(manifest.display === 'standalone', 'manifest display is standalone');
const icons = manifest.icons ?? [];
const hasIcon = (sizes, purpose) => icons.some((icon) => icon.sizes === sizes && (icon.purpose ?? 'any') === purpose);
check(hasIcon('192x192', 'any'), 'manifest has a 192x192 icon');
check(hasIcon('512x512', 'any'), 'manifest has a 512x512 icon');
check(hasIcon('512x512', 'maskable'), 'manifest has a maskable 512x512 icon');
for (const icon of icons) check(existsSync(join(dist, icon.src)), `icon file ${icon.src} is in dist`);
const share = manifest.share_target;
check(
  share?.action === '/share' &&
    share?.method === 'GET' &&
    share?.params?.title === 'title' &&
    share?.params?.text === 'text' &&
    share?.params?.url === 'url',
  'manifest share_target is GET /share with title, text and url',
);

const sw = read('sw.js');
check(sw !== '', 'dist/sw.js exists');
check(sw.includes('"index.html"'), 'sw.js precaches index.html');
check(sw.includes('NavigationRoute'), 'sw.js serves index.html for offline navigations');
check(sw.includes('"favicons"'), 'sw.js caches favicons at runtime');

if (failures.length > 0) {
  console.error(`PWA check failed:\n${failures.map((failure) => `  ✕ ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('PWA check passed.');
```

- [ ] **Step 3: Run the check to verify it fails**

Run: `pnpm --filter @linkstash/web build; pnpm --filter @linkstash/web check:pwa`
Expected: the build succeeds, then the check FAILS. Its list includes `dist/manifest.webmanifest exists` and `dist/sw.js exists`.

- [ ] **Step 4: Add the logo and generate the icons**

`apps/web/public/logo.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#4f46e5"/><path d="M176 112h160a16 16 0 0 1 16 16v288l-96-64-96 64V128a16 16 0 0 1 16-16z" fill="#fff"/></svg>
```

Run: `pnpm --filter @linkstash/web icons`
Expected: `√ PWA assets generated`. `apps/web/public/` now also holds `favicon.ico`, `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png` and `apple-touch-icon-180x180.png`. Commit these files. Run `icons` again only when the logo changes.

- [ ] **Step 5: Configure the PWA plugin**

Notes on the config below:
- `registerType: 'autoUpdate'`: a new deploy takes over on the next page load, with no "update available" prompt.
- `background_color` is slate-50, the light page background, so the Android splash screen matches the app.
- `share_target` adds Linkstash to Android's share sheet. The request arrives as `/share?title=…&text=…&url=…`, which `main.tsx` handles.
- `globPatterns` precaches the icons along with the HTML, JS and CSS.
- `navigateFallback` serves the cached `index.html` for any navigation, so `/` and `/share` both open offline.
- The `favicons` runtime cache stores cross-origin images (site favicons and Google's favicon service) on first view, so saved links keep their icons offline. Browsers fetch these images without CORS, which gives opaque responses (status 0), so status 0 must be cacheable. Opaque responses count heavily against storage quota, so the cache is capped and is emptied if the quota runs out.
- `preview.allowedHosts` lets a Cloudflare quick tunnel (`https://<random>.trycloudflare.com`) reach `vite preview`, which is how the README tests installs on a phone. Without it, Vite answers requests for any host other than `localhost` with 403 "Blocked request. This host is not allowed."

`apps/web/vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        id: '/',
        name: 'Linkstash',
        short_name: 'Linkstash',
        description: 'Save, organize, and find your links on every device.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#f8fafc',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request, sameOrigin }) => request.destination === 'image' && !sameOrigin,
            handler: 'CacheFirst',
            options: {
              cacheName: 'favicons',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  preview: {
    allowedHosts: ['.trycloudflare.com'],
  },
});
```

- [ ] **Step 6: Add the icon links and iOS tags**

iOS ignores most of the manifest. It reads the home-screen icon and standalone mode from these tags. The status bar style `default` keeps the clock readable on the light theme.

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="Save, organize, and find your links on every device." />
    <meta name="theme-color" content="#4f46e5" />
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/logo.svg" sizes="any" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Linkstash" />
    <title>Linkstash</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Build and run the check to verify it passes**

Run: `pnpm --filter @linkstash/web build; pnpm --filter @linkstash/web check:pwa`
Expected: the build log ends with a `PWA v2.0.0` block that reports `mode generateSW` and lists `dist/sw.js` and `dist/workbox-*.js`. Workbox minifies the service worker after the main build, so this last step can take up to a minute. The check prints `PWA check passed.`

- [ ] **Step 8: Run the web tests and typecheck**

Run: `pnpm --filter @linkstash/web test; pnpm --filter @linkstash/web typecheck`
Expected: PASS, 69 tests, as before (Vitest uses `vitest.config.ts`, which has no PWA plugin). The typecheck passes.

- [ ] **Step 9: Check installability and offline mode in Chrome (manual)**

Run: `pnpm --filter @linkstash/web preview`, then open `http://localhost:4173` in Chrome.
Expected:
- DevTools → Application → Manifest shows Linkstash with its icons and no errors.
- Application → Service workers shows `sw.js` as activated and running.
- The address bar shows an install icon.
- With Network → "Offline" ticked, a reload still opens the app. After sign-in, saved links still show.

`localhost` counts as a secure context, so this works without HTTPS. Testing on a phone needs HTTPS; the README (Task 19) covers it. Stop the preview server with Ctrl+C.

- [ ] **Step 10: Commit**

```powershell
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): make the app an installable offline PWA" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 17: Browser extension popup (WXT, Chrome MV3 + Firefox)

The extension is a WXT project. WXT builds the same sources for Chrome (`.output/chrome-mv3`) and Firefox (`.output/firefox-mv3`), and it writes the manifest from `wxt.config.ts`.

The extension has no local database. It talks straight to Supabase, so saving needs a connection (spec §13: no offline writes in the extension). It needs no `host_permissions`, because the Supabase API sends CORS headers that let extension pages call it.

The pieces:
- `lib/` holds plain modules the popup (this task) and the background worker (Task 18) share. Only `config.ts` and `save.ts` have logic worth unit-testing; the others are thin wrappers over browser APIs.
- The session lives in `browser.storage.local`, so the popup and the background worker share one sign-in.
- The popup reads the active tab: URL, title and favicon from the tab, and the description from the page via `scripting.executeScript`. Opening the popup grants `activeTab`, which allows both.

**Files:**
- Create: `apps/extension/package.json`, `tsconfig.json`, `wxt.config.ts`, `vitest.config.ts`, `env.d.ts`, `.env.example`, `assets/icon.svg`
- Create: `apps/extension/lib/config.ts`, `lib/storage.ts`, `lib/save.ts`, `lib/services.ts`, `lib/page.ts`
- Create: `apps/extension/entrypoints/popup/index.html`, `main.tsx`, `style.css`, `App.tsx`, `SignIn.tsx`, `SaveScreen.tsx`, `PagePreview.tsx`
- Test: `apps/extension/lib/config.test.ts`, `apps/extension/lib/save.test.ts`

**Interfaces:**
- Consumes:
  - From `@linkstash/core`: `isHttpUrl`, `normalizeUrl`, `dedupeKey`, `hostname`, `faviconFallback` (Task 1); `createLink`, `updateLink`, `editPatch`, `metadataPatch`, `needsMetadata`, `displayTitle`, `systemClock` and the types `Clock`, `Link`, `LinkPatch`, `Category`, `PageMetadataInput`, `ParsedLinkInput` (Task 2); `RemoteError`, `errorKind` (Task 6); `createLinkstashClient`, `AuthStorage`, `Session`, `SupabaseClient`, `SupabaseRemote` (`findLinkByUrlKey`, `listCategories`, `upsertLink`), `fetchMetadata(client, url)` (Task 8)
  - From `@linkstash/core/testing` (tests only): `makeLink` (Task 5)
  - From `@linkstash/ui`: `LinkForm`, `linkFormValues`, `AuthForm`, `AuthResult`, `ColorDot`, `buttonClass`, `secondaryButtonClass` (Task 9)
- Produces (in `apps/extension/lib/`, used by Task 18):
  - `config.ts`:
    - `DEFAULT_APP_URL = 'http://localhost:5173'`
    - `ExtensionConfig { supabaseUrl, supabasePublishableKey, appUrl }`
    - `readConfig(env = import.meta.env): ExtensionConfig | null`
  - `storage.ts`: `extensionAuthStorage: AuthStorage` (over `browser.storage.local`)
  - `save.ts`:
    - `LinkServer = Pick<SupabaseRemote, 'findLinkByUrlKey' | 'upsertLink'>`
    - `SaveDeps { server: LinkServer; fetchMetadata(url): Promise<PageMetadataInput | null>; clock?: Clock }`
    - `SaveResult { status: 'saved' | 'duplicate'; link: Link }`
    - `saveLink(deps, input: ParsedLinkInput): Promise<SaveResult>`: a page that is already saved (same dedupe key, not deleted) comes back as `'duplicate'` and is not written again
    - `patchLink(deps, link, patch: LinkPatch): Promise<Link>`, `deleteLink(deps, link): Promise<Link>`
    - `enrichLink(deps, link): Promise<Link>`: fills missing metadata from the Edge Function; never throws
    - `OFFLINE_MESSAGE`, `SESSION_EXPIRED_MESSAGE`, `describeError(error: unknown): string`
  - `services.ts`: `Services extends SaveDeps { config; supabase: SupabaseClient; server: SupabaseRemote }`, `getServices(): Services | null` (built once per popup or worker; `null` when the build has no Supabase settings)
  - `page.ts`: `PageInfo extends PageMetadataInput { url; tabId }`, `pageDescription(tabId): Promise<string | null>`, `activePage(): Promise<PageInfo | null>`

- [ ] **Step 1: Create the extension package**

`apps/extension/package.json`:
```json
{
  "name": "@linkstash/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox --mv3",
    "build": "wxt build && wxt build -b firefox --mv3",
    "test": "vitest run",
    "typecheck": "wxt prepare && tsc -p .",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "@linkstash/core": "workspace:*",
    "@linkstash/ui": "workspace:*",
    "lucide-react": "^1.78.0",
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.5",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19",
    "@wxt-dev/auto-icons": "^2.0.0",
    "@wxt-dev/module-react": "^1.2.2",
    "tailwindcss": "^4.3.5",
    "typescript": "^7.0.2",
    "vitest": "^5.1.1",
    "wxt": "^0.21.5"
  }
}
```

`wxt prepare` generates `.wxt/tsconfig.json` (gitignored), which sets up WXT's types and path aliases. The extension's tsconfig extends it instead of `tsconfig.base.json`.

That generated config turns on `noUncheckedIndexedAccess`. `tsc` also checks the `core` and `ui` sources the extension imports, and those are written for `tsconfig.base.json`, which leaves the flag off. Turning it off here keeps all packages on the same rules.

`apps/extension/tsconfig.json`:
```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "noUncheckedIndexedAccess": false
  }
}
```

`@wxt-dev/auto-icons` renders the 16–128 px manifest icons from one SVG. Firefox needs a fixed add-on id to keep `storage.local` (and so the session) across reloads. The action's tooltip comes from the popup's `<title>`. `Alt+Shift+S` opens the popup.

Every extension file imports what it uses (for example `import { browser } from 'wxt/browser'`), so `imports: false` turns off WXT's auto-import globals. Even so, WXT 0.21 still scans every bundled file, including `packages/core` and `packages/ui`. It adds an import for any bare identifier named like one of its APIs (`browser`, `storage`, …), function parameters included. That is why Task 8's `createLinkstashClient` calls its parameter `authStorage`. If a build fails with `failed to resolve import "wxt/…"` from a file in `packages/`, rename the identifier it names.

`apps/extension/wxt.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  imports: false,
  autoIcons: { baseIconPath: 'assets/icon.svg' },
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ browser }) => ({
    name: 'Linkstash',
    description: 'Save the current page or any link to your Linkstash library.',
    permissions: ['activeTab', 'scripting', 'storage'],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+S' } },
    },
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'linkstash@example.com', strict_min_version: '115.0' } } }
      : {}),
  }),
});
```

The unit tests cover plain modules in `lib/` only, so they run in Node with no WXT plugin.

`apps/extension/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
  },
});
```

WXT exposes `.env` variables that start with `WXT_` on `import.meta.env` and inlines them at build time.

`apps/extension/env.d.ts`:
```ts
interface ImportMetaEnv {
  readonly WXT_SUPABASE_URL?: string;
  readonly WXT_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly WXT_APP_URL?: string;
}
```

`apps/extension/.env.example`:
```
# The same values as apps/web/.env: Supabase dashboard → Connect (or Project Settings → API Keys)
WXT_SUPABASE_URL=https://your-project-ref.supabase.co
WXT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
# Optional: where "Open Linkstash" points. Defaults to the web dev server.
WXT_APP_URL=http://localhost:5173
```

This is the same mark as `apps/web/public/logo.svg`.

`apps/extension/assets/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#4f46e5"/><path d="M176 112h160a16 16 0 0 1 16 16v288l-96-64-96 64V128a16 16 0 0 1 16-16z" fill="#fff"/></svg>
```

Run: `pnpm install`
Expected: the install succeeds, and the extension's `postinstall` runs `wxt prepare`, which creates `apps/extension/.wxt/`. If pnpm lists ignored build scripts, run `pnpm approve-builds` and approve them.

- [ ] **Step 2: Write the failing tests**

`apps/extension/lib/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_URL, readConfig } from './config';

const supabase = { WXT_SUPABASE_URL: ' https://abc.supabase.co ', WXT_SUPABASE_PUBLISHABLE_KEY: ' key ' };

describe('readConfig', () => {
  it('returns the trimmed Supabase settings and the default app URL', () => {
    expect(readConfig(supabase)).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabasePublishableKey: 'key',
      appUrl: DEFAULT_APP_URL,
    });
  });

  it('uses WXT_APP_URL when it is a web URL', () => {
    expect(readConfig({ ...supabase, WXT_APP_URL: ' https://links.example.com ' })?.appUrl).toBe(
      'https://links.example.com',
    );
    expect(readConfig({ ...supabase, WXT_APP_URL: 'links.example.com' })?.appUrl).toBe(DEFAULT_APP_URL);
  });

  it('returns null when the Supabase settings are missing or invalid', () => {
    expect(readConfig({ WXT_SUPABASE_URL: 'https://abc.supabase.co' })).toBeNull();
    expect(readConfig({ WXT_SUPABASE_URL: 'abc.supabase.co', WXT_SUPABASE_PUBLISHABLE_KEY: 'key' })).toBeNull();
    expect(readConfig({})).toBeNull();
  });
});
```

The fake server keeps rows in a `Map` and answers `findLinkByUrlKey` the way `SupabaseRemote` does: live links only.

`apps/extension/lib/save.test.ts`:
```ts
import { RemoteError, type Link, type ParsedLinkInput } from '@linkstash/core';
import { makeLink } from '@linkstash/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteLink,
  describeError,
  enrichLink,
  OFFLINE_MESSAGE,
  patchLink,
  saveLink,
  SESSION_EXPIRED_MESSAGE,
  type SaveDeps,
} from './save';

const NOW = '2026-02-01T00:00:00.000Z';

function setup(saved: Link[] = []) {
  const rows = new Map(saved.map((link) => [link.id, link]));
  const server = {
    findLinkByUrlKey: vi.fn(
      async (urlKey: string) => [...rows.values()].find((l) => l.url_key === urlKey && !l.deleted_at) ?? null,
    ),
    upsertLink: vi.fn(async (row: Link) => {
      rows.set(row.id, row);
    }),
  };
  const fetchMetadata = vi.fn<SaveDeps['fetchMetadata']>(async () => null);
  const deps: SaveDeps = { server, fetchMetadata, clock: { now: () => NOW, id: () => 'new-id' } };
  return { deps, server, fetchMetadata, rows };
}

function input(over: Partial<ParsedLinkInput> = {}): ParsedLinkInput {
  return {
    url: 'https://example.com/article',
    customTitle: null,
    notes: null,
    tags: [],
    categoryId: null,
    title: 'An article',
    description: null,
    faviconUrl: null,
    ...over,
  };
}

describe('saveLink', () => {
  it('saves a new link to the server', async () => {
    const { deps, rows } = setup();
    const result = await saveLink(deps, input({ tags: ['news'] }));
    expect(result.status).toBe('saved');
    expect(result.link).toMatchObject({
      id: 'new-id',
      url: 'https://example.com/article',
      url_key: 'example.com/article',
      title: 'An article',
      tags: ['news'],
      created_at: NOW,
    });
    expect(rows.get('new-id')).toEqual(result.link);
  });

  it('returns the saved link instead of saving the same page twice', async () => {
    const existing = makeLink({ url: 'https://www.example.com/article/' });
    const { deps, server } = setup([existing]);
    const result = await saveLink(deps, input({ url: 'https://example.com/article?utm_source=x#top' }));
    expect(result).toEqual({ status: 'duplicate', link: existing });
    expect(server.upsertLink).not.toHaveBeenCalled();
  });
});

describe('patchLink and deleteLink', () => {
  it('patchLink writes the changed link and returns it', async () => {
    const link = makeLink();
    const { deps, rows } = setup([link]);
    const next = await patchLink(deps, link, { is_favorite: true });
    expect(next).toEqual({ ...link, is_favorite: true, updated_at: NOW });
    expect(rows.get(link.id)).toEqual(next);
  });

  it('deleteLink writes a tombstone', async () => {
    const link = makeLink();
    const { deps, rows } = setup([link]);
    await deleteLink(deps, link);
    expect(rows.get(link.id)).toEqual({ ...link, deleted_at: NOW, updated_at: NOW });
  });
});

describe('enrichLink', () => {
  const bare = () => makeLink({ url: 'https://example.com/a', title: 'example.com' });

  it('fills in the metadata the link lacks and saves it', async () => {
    const link = bare();
    const { deps, fetchMetadata, rows } = setup([link]);
    fetchMetadata.mockResolvedValue({
      title: 'A page',
      description: 'About it',
      faviconUrl: 'https://example.com/icon.png',
    });
    const next = await enrichLink(deps, link);
    expect(fetchMetadata).toHaveBeenCalledWith('https://example.com/a');
    expect(next).toEqual({
      ...link,
      title: 'A page',
      description: 'About it',
      favicon_url: 'https://example.com/icon.png',
      updated_at: NOW,
    });
    expect(rows.get(link.id)).toEqual(next);
  });

  it('does not fetch for a link that already has its metadata', async () => {
    const link = makeLink({ description: 'About it', favicon_url: 'https://example.com/icon.png' });
    const { deps, fetchMetadata } = setup([link]);
    expect(await enrichLink(deps, link)).toBe(link);
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('returns the link unchanged when there is no metadata or the save fails', async () => {
    const link = bare();
    const { deps, fetchMetadata, server } = setup([link]);
    expect(await enrichLink(deps, link)).toBe(link);
    fetchMetadata.mockResolvedValue({ description: 'About it' });
    server.upsertLink.mockRejectedValue(new RemoteError('save link: boom', 500));
    expect(await enrichLink(deps, link)).toBe(link);
  });
});

describe('describeError', () => {
  it('explains offline and expired-session errors and passes other messages through', () => {
    expect(describeError(new RemoteError('find link: Failed to fetch', 0))).toBe(OFFLINE_MESSAGE);
    expect(describeError(new RemoteError('find link: JWT expired', 401))).toBe(SESSION_EXPIRED_MESSAGE);
    expect(describeError(new RemoteError('save link: bad row', 400))).toBe('save link: bad row');
    expect(describeError(new Error('nope'))).toBe('nope');
    expect(describeError('plain')).toBe('plain');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @linkstash/extension test`
Expected: FAIL, because `./config` and `./save` cannot be resolved.

- [ ] **Step 4: Implement `lib/config.ts` and `lib/save.ts`**

`apps/extension/lib/config.ts`:
```ts
import { isHttpUrl } from '@linkstash/core';

export const DEFAULT_APP_URL = 'http://localhost:5173';

export interface ExtensionConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  /** Where "Open Linkstash" points: the deployed PWA, or the web dev server. */
  appUrl: string;
}

type ConfigEnv = Pick<ImportMetaEnv, 'WXT_SUPABASE_URL' | 'WXT_SUPABASE_PUBLISHABLE_KEY' | 'WXT_APP_URL'>;

/** Reads the build-time settings from apps/extension/.env. `null` makes the popup show setup instructions. */
export function readConfig(env: ConfigEnv = import.meta.env): ExtensionConfig | null {
  const supabaseUrl = env.WXT_SUPABASE_URL?.trim() ?? '';
  const supabasePublishableKey = env.WXT_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!supabasePublishableKey || !isHttpUrl(supabaseUrl)) return null;
  const appUrl = env.WXT_APP_URL?.trim() ?? '';
  return { supabaseUrl, supabasePublishableKey, appUrl: isHttpUrl(appUrl) ? appUrl : DEFAULT_APP_URL };
}
```

The extension writes straight to the server, last write wins, the same rule the sync engine applies. The PWA picks the changes up on its next pull.

`apps/extension/lib/save.ts`:
```ts
import {
  createLink,
  dedupeKey,
  errorKind,
  metadataPatch,
  needsMetadata,
  RemoteError,
  systemClock,
  updateLink,
  type Clock,
  type Link,
  type LinkPatch,
  type PageMetadataInput,
  type ParsedLinkInput,
  type SupabaseRemote,
} from '@linkstash/core';

export type LinkServer = Pick<SupabaseRemote, 'findLinkByUrlKey' | 'upsertLink'>;

export interface SaveDeps {
  server: LinkServer;
  fetchMetadata(url: string): Promise<PageMetadataInput | null>;
  clock?: Clock;
}

export interface SaveResult {
  status: 'saved' | 'duplicate';
  link: Link;
}

export const OFFLINE_MESSAGE = "Can't reach Linkstash. Check your connection and try again.";
export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Sign in again.';

/** Saves a new link, unless the same page is already saved; then it returns that link. */
export async function saveLink(deps: SaveDeps, input: ParsedLinkInput): Promise<SaveResult> {
  const existing = await deps.server.findLinkByUrlKey(dedupeKey(input.url));
  if (existing) return { status: 'duplicate', link: existing };
  const link = createLink(input, deps.clock);
  await deps.server.upsertLink(link);
  return { status: 'saved', link };
}

export async function patchLink(deps: SaveDeps, link: Link, patch: LinkPatch): Promise<Link> {
  const next = updateLink(link, patch, deps.clock);
  await deps.server.upsertLink(next);
  return next;
}

export function deleteLink(deps: SaveDeps, link: Link): Promise<Link> {
  return patchLink(deps, link, { deleted_at: (deps.clock ?? systemClock).now() });
}

/** Fills in the title, description and favicon a link lacks. Best effort: any failure returns the link as it was. */
export async function enrichLink(deps: SaveDeps, link: Link): Promise<Link> {
  if (!needsMetadata(link)) return link;
  try {
    const meta = await deps.fetchMetadata(link.url);
    if (!meta) return link;
    const patch = metadataPatch(link, meta);
    return Object.keys(patch).length > 0 ? await patchLink(deps, link, patch) : link;
  } catch {
    return link;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof RemoteError) {
    if (error.status === 0) return OFFLINE_MESSAGE;
    if (errorKind(error) === 'auth') return SESSION_EXPIRED_MESSAGE;
  }
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @linkstash/extension test`
Expected: PASS, 11 tests.

- [ ] **Step 6: Implement the browser wrappers: `lib/storage.ts`, `lib/services.ts`, `lib/page.ts`**

These modules import `browser` from `wxt/browser`, so they only run inside the extension. They have no unit tests; the manual check in Step 9 covers them.

`apps/extension/lib/storage.ts`:
```ts
import type { AuthStorage } from '@linkstash/core';
import { browser } from 'wxt/browser';

/** Keeps the Supabase session in extension storage, which the popup and the background worker share. */
export const extensionAuthStorage: AuthStorage = {
  async getItem(key) {
    const items = await browser.storage.local.get(key);
    const value = items[key];
    return typeof value === 'string' ? value : null;
  },
  async setItem(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await browser.storage.local.remove(key);
  },
};
```

`apps/extension/lib/services.ts`:
```ts
import { createLinkstashClient, fetchMetadata, SupabaseRemote, type SupabaseClient } from '@linkstash/core';
import { readConfig, type ExtensionConfig } from './config';
import type { SaveDeps } from './save';
import { extensionAuthStorage } from './storage';

export interface Services extends SaveDeps {
  config: ExtensionConfig;
  supabase: SupabaseClient;
  server: SupabaseRemote;
}

let services: Services | null | undefined;

/** Builds the Supabase client once per popup or worker. `null` means this build has no Supabase settings. */
export function getServices(): Services | null {
  if (services === undefined) {
    const config = readConfig();
    if (!config) {
      services = null;
    } else {
      const supabase = createLinkstashClient(config.supabaseUrl, config.supabasePublishableKey, extensionAuthStorage);
      services = {
        config,
        supabase,
        server: new SupabaseRemote(supabase),
        fetchMetadata: (url) => fetchMetadata(supabase, url),
      };
    }
  }
  return services;
}
```

`executeScript` serializes `readDescription` and runs it inside the page, so the function must not use anything from this module. Browsers refuse to run scripts on some pages (the Chrome Web Store, other extensions' pages), so a failure just means no description.

`apps/extension/lib/page.ts`:
```ts
import { isHttpUrl, type PageMetadataInput } from '@linkstash/core';
import { browser } from 'wxt/browser';

export interface PageInfo extends PageMetadataInput {
  url: string;
  tabId: number;
}

function readDescription(): string | null {
  const content = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content.trim() || null;
  return content('meta[property="og:description"]') ?? content('meta[name="description"]');
}

export async function pageDescription(tabId: number): Promise<string | null> {
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId }, func: readDescription });
    return result?.result ?? null;
  } catch {
    return null;
  }
}

/** The active tab of the current window, or null if there is none or the browser hides its URL. */
export async function activePage(): Promise<PageInfo | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || tab.id === undefined) return null;
  return {
    url: tab.url,
    tabId: tab.id,
    title: tab.title ?? null,
    faviconUrl: tab.favIconUrl ?? null,
    description: isHttpUrl(tab.url) ? await pageDescription(tab.id) : null,
  };
}
```

- [ ] **Step 7: Implement the popup**

`apps/extension/entrypoints/popup/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Linkstash</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`apps/extension/entrypoints/popup/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

The `@source` line makes Tailwind also generate the classes used inside `packages/ui`.

`apps/extension/entrypoints/popup/style.css`:
```css
@import "tailwindcss";
@source "../../../../packages/ui/src";

@layer base {
  html {
    color-scheme: light dark;
  }
  body {
    @apply bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100;
  }
}
```

Sign-out uses `scope: 'local'`. The default (`'global'`) would also sign the user out of the PWA and every other device.

`apps/extension/entrypoints/popup/App.tsx`:
```tsx
import type { Session, SupabaseClient } from '@linkstash/core';
import { Bookmark, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getServices, type Services } from '../../lib/services';
import { SaveScreen } from './SaveScreen';
import { SignIn } from './SignIn';

type SessionState = { status: 'loading' } | { status: 'ready'; session: Session | null };

/** Supabase reports the stored session as its first event, so no separate getSession() call is needed. */
function useSession(supabase: SupabaseClient): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ status: 'ready', session }));
    return () => data.subscription.unsubscribe();
  }, [supabase]);
  return state;
}

function SetupNotice() {
  return (
    <div className="space-y-2 text-sm">
      <h1 className="font-semibold">Connect Linkstash to Supabase</h1>
      <p>
        This build has no Supabase settings. Copy <code>apps/extension/.env.example</code> to{' '}
        <code>apps/extension/.env</code>, set <code>WXT_SUPABASE_URL</code> and <code>WXT_SUPABASE_PUBLISHABLE_KEY</code>,
        then build the extension again.
      </p>
      <p>The README's "Supabase setup" section shows where to find both values.</p>
    </div>
  );
}

interface HeaderProps {
  appUrl: string;
  onSignOut?: () => void;
}

function Header({ appUrl, onSignOut }: HeaderProps) {
  return (
    <header className="mb-4 flex items-center gap-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
        <Bookmark aria-hidden="true" className="size-4" />
        Linkstash
      </p>
      <a
        href={appUrl}
        target="_blank"
        rel="noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-xs text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
      >
        Open Linkstash
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </a>
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="text-xs text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400"
        >
          Sign out
        </button>
      )}
    </header>
  );
}

function Popup({ services }: { services: Services }) {
  const session = useSession(services.supabase);
  const signOut = () => void services.supabase.auth.signOut({ scope: 'local' });

  return (
    <>
      <Header appUrl={services.config.appUrl} onSignOut={session.status === 'ready' && session.session ? signOut : undefined} />
      {session.status === 'loading' ? (
        <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
          Loading…
        </p>
      ) : session.session ? (
        <SaveScreen services={services} />
      ) : (
        <SignIn supabase={services.supabase} />
      )}
    </>
  );
}

export function App() {
  const services = getServices();
  return <div className="w-[360px] p-4">{services ? <Popup services={services} /> : <SetupNotice />}</div>;
}
```

`apps/extension/entrypoints/popup/SignIn.tsx`:
```tsx
import type { SupabaseClient } from '@linkstash/core';
import { AuthForm, type AuthResult } from '@linkstash/ui';

const OFFLINE: AuthResult = { error: 'You are offline. Connect to the internet to sign in.' };

export function SignIn({ supabase }: { supabase: SupabaseClient }) {
  async function signIn(email: string, password: string): Promise<AuthResult> {
    if (!navigator.onLine) return OFFLINE;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }

  async function signUp(email: string, password: string): Promise<AuthResult> {
    if (!navigator.onLine) return OFFLINE;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return data.session ? {} : { info: 'Check your email to confirm your account, then sign in.' };
  }

  return <AuthForm onSignIn={signIn} onSignUp={signUp} />;
}
```

`apps/extension/entrypoints/popup/PagePreview.tsx`:
```tsx
import { faviconFallback, hostname } from '@linkstash/core';

export interface PagePreviewProps {
  url: string;
  title: string;
  description?: string | null;
  faviconUrl?: string | null;
}

export function PagePreview({ url, title, description, faviconUrl }: PagePreviewProps) {
  const fallbackIcon = faviconFallback(url);

  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <img
        src={faviconUrl || fallbackIcon}
        alt=""
        width={20}
        height={20}
        referrerPolicy="no-referrer"
        className="mt-0.5 size-5 shrink-0 rounded"
        onError={(event) => {
          if (event.currentTarget.src !== fallbackIcon) event.currentTarget.src = fallbackIcon;
        }}
      />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{hostname(url)}</p>
        {description && <p className="line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{description}</p>}
      </div>
    </div>
  );
}
```

`SaveScreen` loads the tab and asks the server whether the page is saved. If it is, the screen shows the saved link with Edit, Favorite and Delete. If not, it shows the page and a form prefilled from the tab.

- Errors thrown inside a `LinkForm` submit are rethrown as plain messages, so the form shows them in its alert.
- A 401 from the server signs the popup out locally, which brings back the sign-in form.
- The effect ignores results that arrive after cleanup, so React's StrictMode double run does not apply a stale load.

`apps/extension/entrypoints/popup/SaveScreen.tsx`:
```tsx
import {
  dedupeKey,
  displayTitle,
  editPatch,
  errorKind,
  hostname,
  normalizeUrl,
  type Category,
  type Link,
  type SupabaseRemote,
} from '@linkstash/core';
import { buttonClass, ColorDot, LinkForm, linkFormValues, secondaryButtonClass } from '@linkstash/ui';
import { Check, Pencil, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { activePage, type PageInfo } from '../../lib/page';
import { deleteLink, describeError, patchLink, saveLink } from '../../lib/save';
import type { Services } from '../../lib/services';
import { PagePreview } from './PagePreview';

interface Loaded {
  page: PageInfo;
  categories: Category[];
  saved: Link | null;
}

/** `null` means the active tab is not a web page (for example a browser settings page). */
async function loadPage(server: SupabaseRemote): Promise<Loaded | null> {
  const tab = await activePage();
  const url = tab && normalizeUrl(tab.url);
  if (!tab || !url) return null;
  const [saved, categories] = await Promise.all([server.findLinkByUrlKey(dedupeKey(url)), server.listCategories()]);
  return { page: { ...tab, url }, categories, saved };
}

type View =
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; page: PageInfo; categories: Category[] };

export function SaveScreen({ services }: { services: Services }) {
  const { server, supabase } = services;
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<View>({ status: 'loading' });
  const [link, setLink] = useState<Link | null>(null);
  const [removed, setRemoved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function explain(e: unknown): string {
    if (errorKind(e) === 'auth') void supabase.auth.signOut({ scope: 'local' });
    return describeError(e);
  }

  useEffect(() => {
    let cancelled = false;
    loadPage(server).then(
      (loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setView({ status: 'unsupported' });
          return;
        }
        setLink(loaded.saved);
        setView({ status: 'ready', page: loaded.page, categories: loaded.categories });
      },
      (e: unknown) => {
        if (!cancelled) setView({ status: 'failed', message: explain(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [server, attempt]);

  function retry() {
    setView({ status: 'loading' });
    setAttempt((n) => n + 1);
  }

  async function submit(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (e) {
      throw new Error(explain(e));
    }
  }

  async function act(task: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }

  if (view.status === 'loading') {
    return (
      <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
        Loading…
      </p>
    );
  }
  if (view.status === 'unsupported') {
    return <p className="text-sm">Linkstash can only save web pages (http and https).</p>;
  }
  if (view.status === 'failed') {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {view.message}
        </p>
        <button type="button" className={buttonClass} onClick={retry}>
          Try again
        </button>
      </div>
    );
  }

  const { page, categories } = view;

  if (!link) {
    const pageTitle = page.title || hostname(page.url);
    return (
      <div className="space-y-3">
        {removed && (
          <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
            Removed from Linkstash.
          </p>
        )}
        <PagePreview url={page.url} title={pageTitle} description={page.description} faviconUrl={page.faviconUrl} />
        <LinkForm
          initial={{ url: page.url }}
          metadata={{ title: page.title, description: page.description, faviconUrl: page.faviconUrl }}
          categories={categories}
          urlReadOnly
          titlePlaceholder={pageTitle}
          submitLabel="Save page"
          onSubmit={(input) =>
            submit(async () => {
              const result = await saveLink(services, input);
              setLink(result.link);
              setRemoved(false);
            })
          }
        />
      </div>
    );
  }

  if (editing) {
    return (
      <LinkForm
        key={link.id}
        initial={linkFormValues(link)}
        categories={categories}
        urlReadOnly
        titlePlaceholder={link.title}
        submitLabel="Save changes"
        onSubmit={(input) =>
          submit(async () => {
            setLink(await patchLink(services, link, editPatch(input)));
            setEditing(false);
          })
        }
        onCancel={() => setEditing(false)}
      />
    );
  }

  const category = categories.find((c) => c.id === link.category_id);
  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <Check aria-hidden="true" className="size-4" />
        Saved to Linkstash
      </p>
      <PagePreview url={link.url} title={displayTitle(link)} description={link.description} faviconUrl={link.favicon_url} />
      {(category || link.tags.length > 0) && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          {category && (
            <span className="inline-flex items-center gap-1">
              <ColorDot color={category.color} />
              {category.name}
            </span>
          )}
          {link.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" className="size-4" />
          Edit
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={busy}
          aria-pressed={link.is_favorite}
          onClick={() => act(async () => setLink(await patchLink(services, link, { is_favorite: !link.is_favorite })))}
        >
          <Star aria-hidden="true" className={link.is_favorite ? 'size-4 fill-amber-400 text-amber-500' : 'size-4'} />
          Favorite
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={busy}
          onClick={() =>
            act(async () => {
              await deleteLink(services, link);
              setLink(null);
              setRemoved(true);
            })
          }
        >
          <Trash2 aria-hidden="true" className="size-4" />
          Delete
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Typecheck and build both targets**

Run: `pnpm --filter @linkstash/extension typecheck; pnpm --filter @linkstash/extension build`
Expected: no type errors. The build writes `apps/extension/.output/chrome-mv3/` and `apps/extension/.output/firefox-mv3/`. Two warnings are expected:
- The popup chunk is over 500 kB. React, supabase-js and zod load from disk, so the size does not matter.
- Firefox asks for `data_collection_permissions`. Only add-ons published on addons.mozilla.org need it (see the README).

Run: `Get-Content apps/extension/.output/chrome-mv3/manifest.json; Get-Content apps/extension/.output/firefox-mv3/manifest.json`
Expected: both manifests have `"manifest_version": 3`, `"permissions": ["activeTab","scripting","storage"]`, no `host_permissions`, an `action` with `default_popup` `popup.html` and `default_title` `Linkstash`, the `_execute_action` command with `Alt+Shift+S`, and icons at 16, 32, 48 and 128 px. Only the Firefox manifest has `browser_specific_settings.gecko.id` `linkstash@example.com`.

- [ ] **Step 9: Check the popup in Chrome and Firefox**

1. Copy `apps/extension/.env.example` to `apps/extension/.env` and fill in the same Supabase values as `apps/web/.env`. Run `pnpm --filter @linkstash/extension build` again.
2. Chrome: open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and pick `apps/extension/.output/chrome-mv3`.
3. Open any article, click the Linkstash icon (or press `Alt+Shift+S`), and sign in with your Linkstash account.
   - Expected: the page's favicon, title and description appear above a form with the URL filled in and read-only.
4. Pick a category, add a tag, and click **Save page**.
   - Expected: "Saved to Linkstash" with the category and tag.
5. Close and reopen the popup on the same page.
   - Expected: it opens straight to "Saved to Linkstash".
6. Try **Favorite**, **Edit** (change the title and save), and **Delete**.
   - Expected: after Delete, "Removed from Linkstash." and an empty form.
7. Save the page again, then open the PWA (`pnpm dev`, http://localhost:5173) signed in to the same account.
   - Expected: the link shows up after the next sync.
8. Open `chrome://settings` and click the icon.
   - Expected: "Linkstash can only save web pages (http and https)."
9. Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and pick `apps/extension/.output/firefox-mv3/manifest.json`. Repeat steps 3–5.

- [ ] **Step 10: Commit**

```powershell
git add apps/extension pnpm-lock.yaml
git commit -m "feat(extension): add the save-page popup for Chrome and Firefox" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 18: Context menus in the background worker

Right-clicking a link offers **Save link to Linkstash**, and right-clicking a page offers **Save page to Linkstash**. Both save without a category (spec §8). The toolbar icon then shows the result for 4 seconds:
- a green ✓ when the item was saved or was already saved;
- a red ✕ when it was not: signed out, no Supabase settings in the build, offline, or any other error.

The icon's tooltip says which.

How it fits together:
- `handleMenuClick(deps, click, tab)` in `lib/context-menu.ts` holds all the logic. Its browser dependencies are arguments (`describePage`, `flash`), so tests run it with fakes. `entrypoints/background.ts` only wires browser events to it and draws the badge.
- Page saves:
  - take the title and favicon from the tab;
  - read the meta description with `pageDescription` from Task 17 (clicking a menu item grants `activeTab` for that tab, which allows `scripting.executeScript`).
- Link saves know only the URL. After flashing ✓, the handler calls `enrichLink`, which fetches the title, description and favicon through the Edge Function.
- Chrome runs `background.js` as a service worker; Firefox runs it as an event page (`background.scripts`).
  - Both stop when idle and start again for the next event, so the listeners are registered synchronously inside `defineBackground`.
  - Both keep context menus across browser restarts. So the menus are created in `runtime.onInstalled`, which fires on install, on update, and every time Firefox loads a temporary add-on.
- supabase-js works in a worker:
  - the session comes from `extensionAuthStorage` (there is no `localStorage`);
  - `getSession()` refreshes an expired token when called.
- As in Task 17 (`imports: false`), import `browser` and `defineBackground` explicitly.

**Files:**
- Create: `apps/extension/lib/context-menu.ts`, `apps/extension/entrypoints/background.ts`
- Modify: `apps/extension/lib/services.ts` (adds `hasSession`), `apps/extension/wxt.config.ts` (adds the `contextMenus` permission)
- Test: `apps/extension/lib/context-menu.test.ts`

**Interfaces:**
- Consumes:
  - From `@linkstash/core`: `parseLinkInput`, `LinkInput`, `Link` (Task 2); `RemoteError` (Task 6); `createLinkstashClient`, `isAuthRetryableFetchError`, `SupabaseClient`, `SupabaseRemote`, `fetchMetadata` (Task 8)
  - From `@linkstash/core/testing` (tests only): `makeLink` (Task 5)
  - From Task 17:
    - `saveLink`, `enrichLink`, `describeError`, `OFFLINE_MESSAGE`, `SaveDeps` (`lib/save.ts`)
    - `pageDescription(tabId)` (`lib/page.ts`)
    - `getServices()`, `Services` (`lib/services.ts`)
    - `readConfig`, `ExtensionConfig` (`lib/config.ts`)
    - `extensionAuthStorage` (`lib/storage.ts`)
- Produces:
  - `lib/context-menu.ts`:
    - `SAVE_LINK_ITEM = 'linkstash-save-link'`, `SAVE_PAGE_ITEM = 'linkstash-save-page'`
    - `SIGN_IN_MESSAGE`, `SETUP_MESSAGE`
    - `Feedback { text; color; title }`, `MenuClick { menuItemId; linkUrl?; pageUrl? }`, `MenuTab { id?; title?; favIconUrl? }`
    - `MenuServices extends SaveDeps { hasSession(): Promise<boolean> }`
    - `MenuDeps { services: MenuServices | null; describePage(tabId): Promise<string | null>; flash(feedback: Feedback): void }`
    - `handleMenuClick(deps, click, tab?): Promise<void>`, which never throws
  - `lib/services.ts`: `Services` now extends `MenuServices`, so it gains `hasSession()`. If refreshing the session fails for lack of a network, `hasSession()` throws `RemoteError` with status 0.

- [ ] **Step 1: Write the failing tests**

The fake server keeps rows in a `Map`, like the one in `save.test.ts`. The tests check:
- what each menu item saves;
- that ✓ appears before the metadata fetch starts;
- that setup and sign-in problems stop before the page or the server is touched;
- that errors become a ✕.

`apps/extension/lib/context-menu.test.ts`:
```ts
import { RemoteError, type Link } from '@linkstash/core';
import { makeLink } from '@linkstash/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  handleMenuClick,
  SAVE_LINK_ITEM,
  SAVE_PAGE_ITEM,
  SETUP_MESSAGE,
  SIGN_IN_MESSAGE,
  type MenuDeps,
  type MenuServices,
} from './context-menu';
import { OFFLINE_MESSAGE } from './save';

const NOW = '2026-02-01T00:00:00.000Z';
const tab = { id: 7, title: 'The page', favIconUrl: 'https://example.com/icon.png' };
const savePage = { menuItemId: SAVE_PAGE_ITEM, pageUrl: 'https://example.com/page' };
const ok = (title: string) => ({ text: '✓', color: '#059669', title });
const fail = (title: string) => ({ text: '✕', color: '#dc2626', title });

function setup({ saved = [] as Link[], signedIn = true } = {}) {
  const rows = new Map(saved.map((link) => [link.id, link]));
  const server = {
    findLinkByUrlKey: vi.fn(
      async (urlKey: string) => [...rows.values()].find((l) => l.url_key === urlKey && !l.deleted_at) ?? null,
    ),
    upsertLink: vi.fn(async (row: Link) => {
      rows.set(row.id, row);
    }),
  };
  const fetchMetadata = vi.fn<MenuServices['fetchMetadata']>(async () => null);
  const services: MenuServices = {
    server,
    fetchMetadata,
    clock: { now: () => NOW, id: () => 'new-id' },
    hasSession: async () => signedIn,
  };
  const deps = {
    services,
    describePage: vi.fn<MenuDeps['describePage']>(async () => 'About the page'),
    flash: vi.fn<MenuDeps['flash']>(),
  };
  return { deps, server, fetchMetadata, rows };
}

describe('handleMenuClick', () => {
  it('saves the page with its tab title, favicon and description, and no category', async () => {
    const { deps, fetchMetadata, rows } = setup();
    await handleMenuClick(deps, savePage, tab);
    expect(deps.describePage).toHaveBeenCalledWith(7);
    expect(rows.get('new-id')).toMatchObject({
      url: 'https://example.com/page',
      title: 'The page',
      description: 'About the page',
      favicon_url: 'https://example.com/icon.png',
      category_id: null,
    });
    expect(deps.flash).toHaveBeenCalledExactlyOnceWith(ok('Saved to Linkstash'));
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('saves a link by its URL, shows the result, then fills in the metadata', async () => {
    const { deps, fetchMetadata, rows } = setup();
    fetchMetadata.mockResolvedValue({
      title: 'A post',
      description: 'About the post',
      faviconUrl: 'https://example.org/icon.png',
    });
    await handleMenuClick(deps, { ...savePage, menuItemId: SAVE_LINK_ITEM, linkUrl: 'https://example.org/post' }, tab);
    expect(deps.describePage).not.toHaveBeenCalled();
    expect(deps.flash).toHaveBeenCalledExactlyOnceWith(ok('Saved to Linkstash'));
    expect(fetchMetadata).toHaveBeenCalledWith('https://example.org/post');
    expect(deps.flash.mock.invocationCallOrder[0]).toBeLessThan(fetchMetadata.mock.invocationCallOrder[0]);
    expect(rows.get('new-id')).toMatchObject({
      url: 'https://example.org/post',
      title: 'A post',
      description: 'About the post',
      favicon_url: 'https://example.org/icon.png',
    });
  });

  it('reports a page that is already saved without saving it again', async () => {
    const { deps, server } = setup({ saved: [makeLink({ url: 'https://example.com/page' })] });
    await handleMenuClick(deps, { ...savePage, pageUrl: 'https://example.com/page#comments' }, tab);
    expect(deps.flash).toHaveBeenCalledExactlyOnceWith(ok('Already in Linkstash'));
    expect(server.upsertLink).not.toHaveBeenCalled();
  });

  it('asks for setup or sign-in before reading the page or calling the server', async () => {
    const unconfigured = setup();
    await handleMenuClick({ ...unconfigured.deps, services: null }, savePage, tab);
    expect(unconfigured.deps.flash).toHaveBeenCalledExactlyOnceWith(fail(SETUP_MESSAGE));
    const signedOut = setup({ signedIn: false });
    await handleMenuClick(signedOut.deps, savePage, tab);
    expect(signedOut.deps.flash).toHaveBeenCalledExactlyOnceWith(fail(SIGN_IN_MESSAGE));
    for (const { deps, server } of [unconfigured, signedOut]) {
      expect(deps.describePage).not.toHaveBeenCalled();
      expect(server.findLinkByUrlKey).not.toHaveBeenCalled();
    }
  });

  it('shows invalid URLs and server errors as a ✕ badge', async () => {
    const { deps, server } = setup();
    await handleMenuClick(deps, { menuItemId: SAVE_LINK_ITEM, linkUrl: 'mailto:me@example.com' });
    expect(deps.flash).toHaveBeenLastCalledWith(fail('Enter a valid http(s) URL'));
    server.findLinkByUrlKey.mockRejectedValue(new RemoteError('find link: Failed to fetch', 0));
    await handleMenuClick(deps, { menuItemId: SAVE_LINK_ITEM, linkUrl: 'https://example.org/post' });
    expect(deps.flash).toHaveBeenLastCalledWith(fail(OFFLINE_MESSAGE));
  });

  it('ignores unknown menu items and clicks without a URL', async () => {
    const { deps } = setup();
    await handleMenuClick(deps, { ...savePage, menuItemId: 'something-else' }, tab);
    await handleMenuClick(deps, { menuItemId: SAVE_LINK_ITEM }, tab);
    expect(deps.flash).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @linkstash/extension test context-menu`
Expected: FAIL with "Cannot find module './context-menu'".

- [ ] **Step 3: Implement `handleMenuClick`**

`apps/extension/lib/context-menu.ts`:
```ts
import { parseLinkInput, type LinkInput } from '@linkstash/core';
import { describeError, enrichLink, saveLink, type SaveDeps } from './save';

export const SAVE_LINK_ITEM = 'linkstash-save-link';
export const SAVE_PAGE_ITEM = 'linkstash-save-page';

export const SIGN_IN_MESSAGE = 'Sign in from the Linkstash toolbar button, then try again.';
export const SETUP_MESSAGE = 'This Linkstash build has no Supabase settings. See the README.';

/** What the toolbar icon shows for a few seconds after a context-menu save: badge text, badge color and tooltip. */
export interface Feedback {
  text: string;
  color: string;
  title: string;
}

const succeeded = (title: string): Feedback => ({ text: '✓', color: '#059669', title });
const failed = (title: string): Feedback => ({ text: '✕', color: '#dc2626', title });

/** The parts of a contextMenus.onClicked event the handler reads. */
export interface MenuClick {
  menuItemId: string | number;
  linkUrl?: string;
  pageUrl?: string;
}

export interface MenuTab {
  id?: number;
  title?: string;
  favIconUrl?: string;
}

export interface MenuServices extends SaveDeps {
  hasSession(): Promise<boolean>;
}

export interface MenuDeps {
  /** `null` when this build has no Supabase settings. */
  services: MenuServices | null;
  describePage(tabId: number): Promise<string | null>;
  flash(feedback: Feedback): void;
}

interface MenuTarget {
  input: LinkInput;
  /** Set for page saves, so the handler can read the page's meta description. */
  tabId?: number;
}

function menuTarget(click: MenuClick, tab?: MenuTab): MenuTarget | null {
  if (click.menuItemId === SAVE_LINK_ITEM && click.linkUrl) return { input: { url: click.linkUrl } };
  if (click.menuItemId === SAVE_PAGE_ITEM && click.pageUrl) {
    return {
      input: { url: click.pageUrl, title: tab?.title ?? null, faviconUrl: tab?.favIconUrl ?? null },
      tabId: tab?.id,
    };
  }
  return null;
}

/**
 * Saves the clicked link or page without a category, flashes the result on the toolbar icon, then fills in
 * missing metadata. Never throws: every failure becomes a ✕ badge.
 */
export async function handleMenuClick(deps: MenuDeps, click: MenuClick, tab?: MenuTab): Promise<void> {
  const target = menuTarget(click, tab);
  if (!target) return;
  const { services } = deps;
  if (!services) return deps.flash(failed(SETUP_MESSAGE));
  try {
    if (!(await services.hasSession())) return deps.flash(failed(SIGN_IN_MESSAGE));
    const description = target.tabId === undefined ? null : await deps.describePage(target.tabId);
    const parsed = parseLinkInput({ ...target.input, description });
    if (!parsed.ok) return deps.flash(failed(parsed.error));
    const result = await saveLink(services, parsed.value);
    if (result.status === 'duplicate') return deps.flash(succeeded('Already in Linkstash'));
    deps.flash(succeeded('Saved to Linkstash'));
    await enrichLink(services, result.link);
  } catch (error) {
    deps.flash(failed(describeError(error)));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @linkstash/extension test`
Expected: PASS. `context-menu.test.ts` has 6 tests; the package has 17.

- [ ] **Step 5: Add `hasSession` to the services**

Replace the whole file. `Services` now extends `MenuServices`, so `getServices()` can be passed straight to `handleMenuClick`. The popup keeps using it unchanged.

`apps/extension/lib/services.ts`:
```ts
import {
  createLinkstashClient,
  fetchMetadata,
  isAuthRetryableFetchError,
  RemoteError,
  SupabaseRemote,
  type SupabaseClient,
} from '@linkstash/core';
import { readConfig, type ExtensionConfig } from './config';
import type { MenuServices } from './context-menu';
import { extensionAuthStorage } from './storage';

export interface Services extends MenuServices {
  config: ExtensionConfig;
  supabase: SupabaseClient;
  server: SupabaseRemote;
}

let services: Services | null | undefined;

/** Builds the Supabase client once per popup or worker. `null` means this build has no Supabase settings. */
export function getServices(): Services | null {
  if (services === undefined) {
    const config = readConfig();
    if (!config) {
      services = null;
    } else {
      const supabase = createLinkstashClient(config.supabaseUrl, config.supabasePublishableKey, extensionAuthStorage);
      services = {
        config,
        supabase,
        server: new SupabaseRemote(supabase),
        fetchMetadata: (url) => fetchMetadata(supabase, url),
        // getSession() refreshes an expired token. If that fails for lack of a network, report "offline", not "signed out".
        async hasSession() {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw isAuthRetryableFetchError(error) ? new RemoteError(`session: ${error.message}`, 0) : error;
          return data.session !== null;
        },
      };
    }
  }
  return services;
}
```

- [ ] **Step 6: Add the background worker and the `contextMenus` permission**

The menu items use URL patterns, so they only appear where a save can work:
- the link item only on http(s) links (not `mailto:`);
- the page item only on http(s) pages (not `chrome://` or `about:` pages).

`flash` draws on the badge of the clicked tab and restores it after 4 seconds. If you save twice in a row, the second save resets that timer.

`apps/extension/entrypoints/background.ts`:
```ts
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { handleMenuClick, SAVE_LINK_ITEM, SAVE_PAGE_ITEM, type Feedback } from '../lib/context-menu';
import { pageDescription } from '../lib/page';
import { getServices } from '../lib/services';

const WEB_PAGES = ['http://*/*', 'https://*/*'];
const FEEDBACK_MS = 4000;
const timers = new Map<number | undefined, ReturnType<typeof setTimeout>>();

/** Shows feedback on the toolbar icon of one tab (or of every tab when there is none), then restores it. */
function flash(tabId: number | undefined, feedback: Feedback): void {
  const target = tabId !== undefined && tabId >= 0 ? { tabId } : {};
  const ignoreClosedTab = () => undefined;
  clearTimeout(timers.get(tabId));
  Promise.all([
    browser.action.setBadgeBackgroundColor({ ...target, color: feedback.color }),
    browser.action.setBadgeText({ ...target, text: feedback.text }),
    browser.action.setTitle({ ...target, title: feedback.title }),
  ]).catch(ignoreClosedTab);
  timers.set(
    tabId,
    setTimeout(() => {
      timers.delete(tabId);
      Promise.all([
        browser.action.setBadgeText({ ...target, text: '' }),
        browser.action.setTitle({ ...target, title: 'Linkstash' }),
      ]).catch(ignoreClosedTab);
    }, FEEDBACK_MS),
  );
}

export default defineBackground(() => {
  // Menus persist across browser restarts in Chrome and in Firefox event pages, so create them once per install
  // or update. removeAll() first avoids duplicate-id errors when an update re-runs this.
  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: SAVE_LINK_ITEM,
      title: 'Save link to Linkstash',
      contexts: ['link'],
      targetUrlPatterns: WEB_PAGES,
    });
    browser.contextMenus.create({
      id: SAVE_PAGE_ITEM,
      title: 'Save page to Linkstash',
      contexts: ['page'],
      documentUrlPatterns: WEB_PAGES,
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    void handleMenuClick(
      {
        services: getServices(),
        describePage: pageDescription,
        flash: (feedback) => flash(tab?.id, feedback),
      },
      info,
      tab,
    );
  });
});
```

Replace the whole file. Only the `permissions` line changes.

`apps/extension/wxt.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  imports: false,
  autoIcons: { baseIconPath: 'assets/icon.svg' },
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: ({ browser }) => ({
    name: 'Linkstash',
    description: 'Save the current page or any link to your Linkstash library.',
    permissions: ['activeTab', 'contextMenus', 'scripting', 'storage'],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+S' } },
    },
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'linkstash@example.com', strict_min_version: '115.0' } } }
      : {}),
  }),
});
```

- [ ] **Step 7: Typecheck and build both targets**

Run: `pnpm --filter @linkstash/extension typecheck; pnpm --filter @linkstash/extension build`
Expected:
- No type errors.
- Both builds write a `background.js` (about 300 kB).
- The same two warnings as in Task 17: chunk size, and Firefox `data_collection_permissions`.

Run: `Get-Content apps/extension/.output/chrome-mv3/manifest.json; Get-Content apps/extension/.output/firefox-mv3/manifest.json`
Expected:
- Both manifests have `"permissions": ["activeTab","contextMenus","scripting","storage"]` and still no `host_permissions`.
- Chrome has `"background": {"service_worker": "background.js"}`.
- Firefox has `"background": {"scripts": ["background.js"]}`.

- [ ] **Step 8: Check the context menus in Chrome and Firefox**

1. In `chrome://extensions`, click the reload icon on the Linkstash card. Check that you are signed in by opening the popup.
2. On any article, right-click a link to another page and choose **Save link to Linkstash**.
   - Expected: a green ✓ on the Linkstash icon for about 4 seconds. Hovering the icon shows "Saved to Linkstash".
3. Open the PWA.
   - Expected: after the next sync, the link appears with no category. Its title, description and favicon are filled in if the `fetch-metadata` Edge Function is deployed; otherwise the title is the host name.
4. Right-click an empty part of the page and choose **Save page to Linkstash**.
   - Expected: ✓. Do it again: ✓ with the tooltip "Already in Linkstash".
5. Right-click a `mailto:` link, then right-click on the `chrome://extensions` page.
   - Expected: no Linkstash item either time.
6. Sign out in the popup, then choose **Save page to Linkstash** on an article.
   - Expected: a red ✕ with the tooltip "Sign in from the Linkstash toolbar button, then try again."
7. If something fails silently: on the Linkstash card in `chrome://extensions`, click **service worker** to open the worker's console.
8. Firefox: in `about:debugging#/runtime/this-firefox`, click **Reload** on Linkstash. Repeat steps 2, 4 and 6.

- [ ] **Step 9: Commit**

```powershell
git add apps/extension
git commit -m "feat(extension): save links and pages from the context menu" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 19: README and final verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes:
  - Root scripts `dev`, `dev:ext`, `build`, `test`, `typecheck` and `test:live` (Task 1). `test:live` runs core's `vitest.live.config.ts`, which loads `apps/web/.env` and `apps/web/.env.local` (Task 8).
  - Web scripts `dev`, `build`, `preview`, `icons` and `check:pwa` (Tasks 10 and 16). `vite preview` serves on port 4173, and `preview.allowedHosts` admits `*.trycloudflare.com` (Task 16).
  - Extension scripts `dev`, `dev:firefox` and `build`, which write `apps/extension/.output/chrome-mv3` and `apps/extension/.output/firefox-mv3` (Task 17).
  - The env var names in Global Constraints and the two `.env.example` files.
  - `supabase/migrations/0001_init.sql` and `supabase/functions/fetch-metadata/` (Task 7).
  - UI text the README quotes: "Connect Linkstash to Supabase" (web `SetupNotice` and the popup), **Need an account? Create one**, "Check your email to confirm your account, then sign in.", the **Offline** / **N pending** badge, **Save page**, **Saved to Linkstash**, **Save link to Linkstash**, **Save page to Linkstash**, and "Linkstash can only save web pages (http and https)."
- Produces: nothing that code depends on. Both setup notices tell the reader to see the README's "Supabase setup" section, so keep a heading with exactly those words.

- [ ] **Step 1: Write the README**

The reader has just cloned the repo and knows nothing about Supabase, PWAs or unpacked extensions. Every command works in PowerShell from the repo root.

`README.md`:
````markdown
# Linkstash

Save, organize and find your links on every device. Linkstash is an installable web app (PWA) that works offline, plus a browser extension for Chrome and Firefox. Both sync through your own Supabase project.

## Features

- **Save links** with an optional custom title, notes, tags and category. Linkstash fetches the page title, description and favicon for you.
- **Edit, favorite, archive and delete** links. Deleting shows an **Undo** button.
- **Categories:** create, rename, recolor and delete color-coded categories. Links in a deleted category become uncategorized.
- **Find links fast:** search matches titles, URLs, descriptions, notes and tags as you type. A leading `#` is ignored, so `#recipes` finds links tagged `recipes`. Switch between All, Favorites and Archive, filter by category, and sort by Newest, Oldest, A–Z or Most visited. Opening a link counts as a visit.
- **Installable and offline:** install the web app on Android, iOS or desktop. Saved links open offline, and changes made offline sync when you reconnect.
- **Share to Linkstash** on Android: the installed app appears in the share sheet.
- **Browser extension** for Chrome, Edge and other Chromium browsers, and Firefox 115+:
  - Click the toolbar button, or press `Alt+Shift+S`, to save the current page with a category, tags and notes. If the page is already saved, the popup says so and lets you favorite, edit or delete it.
  - Right-click a link or a page and choose **Save link to Linkstash** or **Save page to Linkstash**.
- **Sync:** sign in with email and password. While online, changes reach your other devices within seconds.

## Tech stack

| Part | Built with |
| --- | --- |
| Language | TypeScript (strict) |
| Monorepo | pnpm workspaces |
| Web app | React 19, Vite, Tailwind CSS 4, Dexie (IndexedDB), vite-plugin-pwa (Workbox) |
| Extension | WXT (Manifest V3 for Chrome and Firefox), React 19 |
| Shared code | `@linkstash/core`: types, zod validation, search and sorting, the sync engine, Supabase access. `@linkstash/ui`: the link form, sign-in form and category picker. |
| Backend | Supabase: Postgres with row-level security, email + password auth, Realtime, one Edge Function (Deno) |
| Tests | Vitest, Testing Library, fake-indexeddb, PGlite (runs the real SQL migration in memory) |

## How sync works

The web app keeps a full copy of your links and categories in IndexedDB. Every change is written there first and added to an outbox, so the app responds at once and works offline. A sync engine sends the outbox to Supabase in order, then pulls whatever changed on the server since the last sync. It runs when you sign in or open the app, every minute, when the window regains focus or the connection comes back, and right after each change. Supabase Realtime also tells the app as soon as another device changes something. If the same link is edited in two places, the edit that reaches the server last wins. Deleted links and categories are kept as markers, so deletes sync too.

The extension keeps no local copy. It reads and writes Supabase directly, so it needs a connection. The web app picks up its changes through Realtime or the next sync.

Row-level security in Postgres means each account can only see its own links and categories. Signing out of the web app removes the local copy from that browser; if some changes have not synced yet, Linkstash asks first.

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

- Node.js 20.19 or newer.
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
   - To keep it on, set **Authentication → URL Configuration → Site URL** to where the web app runs, for example `http://localhost:5173`. After signing up, click the link in the email, then sign in to Linkstash with your email and password. Supabase's built-in email service only sends a few emails per hour.
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
| `apps/extension/.env` | `WXT_APP_URL` | Optional. Where the popup's **Open Linkstash** link goes. Defaults to `http://localhost:5173`. |

The values are compiled into the apps, so restart the dev server or build again after changing a `.env` file. The publishable key is meant to be public; row-level security protects the data. The `.env` files are gitignored. Don't commit them.

## 4. Run in development

```powershell
pnpm dev                                          # web app at http://localhost:5173
pnpm dev:ext                                      # extension in Chrome, with hot reload
pnpm --filter @linkstash/extension dev:firefox    # extension in Firefox, with hot reload
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
SMOKE_EMAIL=you+linkstash-smoke@example.com
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

Generating the service worker can take up to a minute. Two extension build warnings are expected:

- The popup chunk is larger than 500 kB. Extension files load from disk, so the size doesn't matter.
- Firefox asks for `data_collection_permissions`. This only matters when publishing on addons.mozilla.org; see [Troubleshooting](#troubleshooting).

`pnpm --filter @linkstash/web check:pwa` checks the web build. It prints `PWA check passed.` when the manifest, icons and service worker are in place.

The web app's icons in `apps/web/public/` are generated from `apps/web/public/logo.svg`. After changing the logo, run `pnpm --filter @linkstash/web icons` and commit the new files. The extension builds its icons from `apps/extension/assets/icon.svg` on every build.

## 7. Install the PWA

Browsers only offer to install a site that is served over HTTPS or from `localhost`.

### Desktop (Chrome or Edge)

```powershell
pnpm build
pnpm --filter @linkstash/web preview    # http://localhost:4173
```

1. Open http://localhost:4173 and sign in.
2. In DevTools → **Application**, **Manifest** shows Linkstash with its icons and no errors, and **Service workers** shows `sw.js` as activated.
3. Install the app with the install icon in the address bar, or with the install option in the browser menu. Linkstash opens in its own window.
4. Test offline mode: in DevTools → **Network**, set throttling to **Offline** and reload. Your links still show. Favorite a link: the header shows **Offline · 1 pending**. Set throttling back to **No throttling**; the badge disappears once the change has synced.

Stop the preview server with Ctrl+C.

### Android and iOS

A phone can't reach `localhost` on your computer, so serve the preview over HTTPS through a temporary Cloudflare tunnel. No Cloudflare account is needed.

```powershell
pnpm --filter @linkstash/web preview
# in a second terminal:
npx cloudflared tunnel --url http://localhost:4173
```

cloudflared prints an address like `https://<random-words>.trycloudflare.com`. Open it on your phone. (`apps/web/vite.config.ts` lists `.trycloudflare.com` under `preview.allowedHosts`. To use a different tunnel, add its host name there.)

- **Android (Chrome):** sign in, then tap **Install** when Chrome offers it, or use the **⋮** menu → **Add to Home screen** → **Install**. Once installed, Linkstash appears in the share sheet: share a page from any app, and Linkstash opens its add-link form with the URL filled in.
- **iOS (Safari):** sign in, then tap **Share** → **Add to Home Screen**. iOS has no share targets for web apps, so add links from inside the app.
- **Offline:** open the installed app once while online. Then turn on airplane mode and open it again. Your links still show, and changes you make sync when you reconnect.

Each tunnel gets a new address, and each address is a separate site with its own storage and its own installed app. Remove the test app from your phone when you are done. For everyday use, deploy the app.

## 8. Deploy the PWA

`apps/web/dist/` is a static site, so any static host with HTTPS works, for example Netlify, Cloudflare Pages or Vercel.

- **Build settings:** build command `pnpm install && pnpm --filter @linkstash/web build`, output directory `apps/web/dist`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the host's build environment.
- **Fallback to `index.html`:** serve `index.html` for paths that don't match a file, so the Android share link (`/share?…`) works on a first visit. On Netlify, add `apps/web/public/_redirects` containing `/* /index.html 200`. Cloudflare Pages does this by default. On other hosts, add a rewrite from every path to `/index.html`.
- **Own origin:** the app's `start_url` and `scope` are `/`, so serve it from the root of a domain or subdomain, not from a subfolder.
- **Supabase:** set **Authentication → URL Configuration → Site URL** to the deployed address.
- **Extension:** set `WXT_APP_URL` in `apps/extension/.env` to the deployed address and rebuild the extension, so **Open Linkstash** opens it.

## 9. Load the browser extension

Build it first with `pnpm build`, or `pnpm --filter @linkstash/extension build` for the extension alone.

### Chrome, Edge and other Chromium browsers

1. Open `chrome://extensions` (in Edge, `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the folder `apps/extension/.output/chrome-mv3`.
4. Pin Linkstash from the Extensions (puzzle-piece) menu so its button stays in the toolbar.

The extension stays installed when the browser restarts. After rebuilding, click the reload icon on its card in `chrome://extensions`.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose the file `apps/extension/.output/firefox-mv3/manifest.json`.

Firefox removes temporary add-ons when it restarts, so load it again after a restart. After rebuilding, click **Reload** on the add-on. To keep it installed for good, it has to be signed on addons.mozilla.org (it can be unlisted); see the `data_collection_permissions` entry in [Troubleshooting](#troubleshooting).

### Using the extension

- Click the Linkstash button, or press `Alt+Shift+S` (Option+Shift+S on macOS), and sign in with your Linkstash account.
- On a web page, the popup shows the page's favicon, title and description. Pick a category, add tags or notes, and click **Save page**. If the page is already saved, the popup shows **Saved to Linkstash** with buttons to favorite, edit or delete it.
- Right-click a link and choose **Save link to Linkstash**, or right-click a page and choose **Save page to Linkstash**. These save without a category. The toolbar icon shows a green ✓ when the link is saved or a red ✕ when saving fails; hover over the icon to see the reason.
- **Open Linkstash** in the popup opens the web app.
- To change the shortcut, open `chrome://extensions/shortcuts`, or in Firefox `about:addons` → ⚙ → **Manage Extension Shortcuts**.
- To debug, open the background worker's console: in Chrome, click **service worker** on the Linkstash card in `chrome://extensions`; in Firefox, click **Inspect** on the add-on in `about:debugging`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The app or the popup says **Connect Linkstash to Supabase** | The `.env` file is missing or incomplete; see [Configure the apps](#3-configure-the-apps). Restart `pnpm dev`, or build again, after editing it. |
| Sign-up says "Check your email to confirm your account, then sign in." | Click the link in the email, then sign in. Or turn off **Confirm email** (Supabase setup, item 4). |
| "Invalid API key", or every request fails with 401 | The key is wrong or comes from a different project than the URL. Use the publishable key, or the legacy anon key, from the same project. |
| pnpm warns about ignored build scripts | Run `pnpm approve-builds`, approve them, then run `pnpm install`. |
| Links added in the web app only show the host name | The `fetch-metadata` Edge Function isn't deployed (Supabase setup, item 5). If it is, look in the dashboard under **Edge Functions → fetch-metadata → Logs**. If the function returns 401, it was deployed without `--no-verify-jwt`; deploy it again with the flag. Some sites block automated requests, so a few links never get a title. |
| A change doesn't show up on another device | Look at the badge in the header. **N pending** means the change hasn't reached the server yet; it syncs once the device is online. Switching back to the app also starts a sync. |
| `vite preview` answers "Blocked request. This host is not allowed." | Add the tunnel's host name to `preview.allowedHosts` in `apps/web/vite.config.ts`. |
| The popup says "Linkstash can only save web pages (http and https)." | Browser pages such as `chrome://…` and `about:…` can't be saved. |
| A context-menu save shows a red ✕ | Hover over the icon to see the reason. Usually you are signed out: open the popup and sign in. |
| The Firefox build warns about `data_collection_permissions` | Only add-ons published on addons.mozilla.org need it. Before publishing, change the gecko id `linkstash@example.com` in `apps/extension/wxt.config.ts` to an id you own, and declare the data the add-on sends to Supabase under `browser_specific_settings.gecko.data_collection_permissions`: most likely `browsingActivity`, `websiteContent`, `personallyIdentifyingInfo` and `authenticationInfo` as `required`. Run `pnpm typecheck` afterwards, because WXT's types may not know this key yet. Firefox shows the consent prompt from version 140. See [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/). |

## Limitations

- The extension needs a connection. It doesn't queue saves while offline.
- Saving the same URL on two devices that are both offline can create a duplicate. Delete one of them.
- iOS has no share target for web apps.
- Not included: nested folders, sharing between accounts, saving page contents, importing or exporting browser bookmarks, OAuth or magic-link sign-in, and a Safari extension.
````

- [ ] **Step 2: Check that every documented script exists**

Run: `pnpm run; pnpm --filter @linkstash/web run; pnpm --filter @linkstash/extension run`
Expected: each command lists the package's scripts.
- Root: `dev`, `dev:ext`, `build`, `test`, `typecheck`, `test:live`.
- Web: `dev`, `build`, `preview`, `test`, `typecheck`, `icons`, `check:pwa`.
- Extension: `dev`, `dev:firefox`, `build`, `test`, `typecheck`, `postinstall`.

Every script the README names is in these lists. If one is missing, fix the README, not the package.

- [ ] **Step 3: Run every test and the typecheck**

Run: `pnpm test; pnpm typecheck`
Expected:
- core: 116 passed. The live test file is not part of `pnpm test`.
- ui: 10 passed.
- web: 69 passed.
- extension: 17 passed.
- The typecheck passes in all four packages.

- [ ] **Step 4: Build everything and check the PWA**

Run: `pnpm build; pnpm --filter @linkstash/web check:pwa`
Expected:
- The web build ends with a `PWA v2.0.0` block that lists `dist/sw.js`.
- The extension build writes `apps/extension/.output/chrome-mv3/` and `apps/extension/.output/firefox-mv3/`, with only the two warnings the README's "Build" section lists.
- The check prints `PWA check passed.`

- [ ] **Step 5: Type-check the Edge Function**

Run: `npx -y deno check supabase/functions/fetch-metadata/index.ts`
Expected: no errors, exit code 0.

- [ ] **Step 6: Connect a real Supabase project and run the live test**

This step needs the user. Use the `ask_user` tool to:
1. Ask the user to create a Supabase project and give you its Project URL and publishable key. Write them into `apps/web/.env` and `apps/extension/.env`.
2. Ask the user to run `supabase/migrations/0001_init.sql` in the SQL Editor, to turn off **Confirm email** (or confirm the test account by email later), and to deploy the Edge Function with the two commands in README "Supabase setup", item 5. `supabase login` opens a browser, so the user runs both commands.
3. Ask for a test account email and password. Write `apps/web/.env.local` with `SMOKE_EMAIL`, `SMOKE_PASSWORD` and `SMOKE_EDGE=1`.

Run: `pnpm test:live`
Expected: 4 passed. If the user skipped the Edge Function, remove `SMOKE_EDGE=1`: 3 passed, 1 skipped.

Run: `git status --short`
Expected: no `.env` or `.env.local` file is listed. They are gitignored and must never be committed.

- [ ] **Step 7: Walk through the README end to end (manual)**

Follow the README as written. Wherever the app behaves differently from the README, fix the README.

1. Run `pnpm dev` and open http://localhost:5173. Sign in with the test account.
2. Click **Add link**, enter only a URL such as `https://developer.mozilla.org/`, and save.
   - Expected: within a few seconds the card shows the page title, description and favicon.
3. Open **Manage categories**. Create two categories, rename one, and change the color of the other. Assign a category and a tag to the link.
   - Expected: filtering by that category shows the link. Searching `#` plus the tag finds it.
4. Open the link twice, then sort by **Most visited**.
   - Expected: it moves to the top.
5. Delete one of the categories.
   - Expected: its links stay and show no category.
6. Open http://localhost:5173 in an incognito or private window, sign in to the same account, and favorite a link there.
   - Expected: the first window shows the change within a few seconds.
7. In the first window, set DevTools → Network throttling to **Offline**, then archive a link.
   - Expected: the header shows **Offline · 1 pending**. With **No throttling** again, the badge clears and the private window shows the change.
8. Build and load the extension (README sections 6 and 9). On any article, save the page from the popup with a category.
   - Expected: it appears in the web app with that category. Right-click a link and choose **Save link to Linkstash**: a green ✓ on the icon, and the link appears in the web app.
9. Follow README section 7, "Desktop", to install the PWA from `pnpm --filter @linkstash/web preview`.
   - Expected: it installs and opens offline.
10. If the user has a phone at hand, ask them to follow section 7, "Android and iOS", and report back. Otherwise skip this item.

- [ ] **Step 8: Commit**

Run: `git status --short`
Expected: only `README.md`, plus any README fixes from Step 7. No `.env` files.

```powershell
git add README.md
git commit -m "docs: add README with setup, build and install instructions" -m "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"
```
