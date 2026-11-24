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
