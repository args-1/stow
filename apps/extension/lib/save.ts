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
} from '@stow/core';

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

export const OFFLINE_MESSAGE = "Can't reach Stow. Check your connection and try again.";
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
