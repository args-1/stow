import { z } from 'zod';

// No `new Function` probe: the extension's MV3 CSP forbids eval, and zod would otherwise try it once.
z.config({ jitless: true });

import { CATEGORY_COLORS, isCategoryIcon, type Category, type CategoryIconName, type Link } from './schema';
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

// Postgres rejects text holding a lone UTF-16 surrogate or NUL, and a rejected write is dropped as fatal.
const UNSTORABLE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF\0]/g;

/** Replaces lone surrogates and NUL with U+FFFD, keeping valid surrogate pairs. */
function storableText(text: string): string {
  return text.replace(UNSTORABLE, (m) => (m.length === 2 ? m : '\uFFFD'));
}

/** `slice(0, max)` for well-formed text that never cuts a surrogate pair in half. */
function sliceWhole(text: string, max: number): string {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

function clip(value: string | null | undefined, max: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? sliceWhole(storableText(text), max) : null;
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
    const tag = sliceWhole(
      storableText(raw)
        .trim()
        .replace(/^#+/, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-'),
      LIMITS.tag,
    );
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
  /** One of CATEGORY_ICONS. */
  icon: string;
}

const categoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(LIMITS.categoryName, `Name must be at most ${LIMITS.categoryName} characters`),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Pick a color'),
  icon: z.custom<CategoryIconName>(isCategoryIcon, 'Pick an icon'),
});

export function parseCategoryInput(input: CategoryInput): Result<CategoryInput> {
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid category' };
  return {
    ok: true,
    value: { name: parsed.data.name, color: parsed.data.color.toLowerCase(), icon: parsed.data.icon },
  };
}

/** Pass input that already went through parseCategoryInput. */
export function createCategory(input: CategoryInput, clock: Clock = systemClock): Category {
  const now = clock.now();
  return {
    id: clock.id(),
    name: input.name,
    color: input.color,
    icon: input.icon,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

export type CategoryPatch = Partial<Pick<Category, 'name' | 'color' | 'icon' | 'deleted_at'>>;

export function updateCategory(category: Category, patch: CategoryPatch, clock: Clock = systemClock): Category {
  return { ...category, ...patch, updated_at: clock.now() };
}

export function nextCategoryColor(existing: readonly Category[]): string {
  const used = new Set(existing.filter((c) => !c.deleted_at).map((c) => c.color.toLowerCase()));
  return CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[existing.length % CATEGORY_COLORS.length];
}
