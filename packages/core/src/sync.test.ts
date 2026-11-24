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
    expect(errorKind(new RemoteError('x', 400, 'PGRST204'))).toBe('retryable');
    expect(errorKind(new RemoteError('x', 400, '23514'))).toBe('fatal');
  });
});

describe('SyncEngine.sync pushing', () => {
  it('pushes outbox entries in order and empties the outbox', async () => {
    const cat = makeCategory();
    const link = makeLink({ category_id: cat.id });
    await engine.saveCategory(cat);
    await engine.saveLink(link);
    expect(await local.getLink(link.id)).toEqual(link);

    expect(await engine.sync()).toBe('ok');
    expect(remote.calls).toEqual([`upsertCategory:${cat.id}`, `upsertLink:${link.id}`, 'pullCategories', 'pullLinks']);
    expect(remote.links.get(link.id)?.title).toBe(link.title);
    expect(await local.peekOutbox()).toEqual([]);
  });

  it('stops at a retryable error and keeps that entry and the rest', async () => {
    const a = makeLink();
    const b = makeLink();
    await engine.saveLink(a);
    await engine.saveLink(b);
    remote.failNext(offline());

    expect(await engine.sync()).toBe('retry');
    expect(await pendingIds()).toEqual([a.id, b.id]);

    expect(await engine.sync()).toBe('ok');
    expect(remote.calls).toEqual([
      `upsertLink:${a.id}`,
      `upsertLink:${a.id}`,
      `upsertLink:${b.id}`,
      'pullCategories',
      'pullLinks',
    ]);
  });

  it('returns auth on 401 without dropping anything', async () => {
    const a = makeLink();
    await engine.saveLink(a);
    remote.failNext(new RemoteError('JWT expired', 401));
    expect(await engine.sync()).toBe('auth');
    expect(await pendingIds()).toEqual([a.id]);
  });

  it('drops an entry the server rejects, reports it, and continues', async () => {
    const a = makeLink();
    const b = makeLink();
    await engine.saveLink(a);
    await engine.saveLink(b);
    const error = new RemoteError('violates check constraint', 400);
    remote.failNext(error);

    expect(await engine.sync()).toBe('ok');
    expect(fatal).toHaveBeenCalledWith(error, { type: 'upsertLink', row: a });
    expect(remote.links.has(a.id)).toBe(false);
    expect(remote.links.has(b.id)).toBe(true);
    expect(await local.peekOutbox()).toEqual([]);
  });

  it('keeps a category the server cannot store yet because migration 0002 has not run', async () => {
    const cat = makeCategory({ icon: 'briefcase' });
    await engine.saveCategory(cat);
    remote.failNext(new RemoteError("Could not find the 'icon' column of 'categories' in the schema cache", 400, 'PGRST204'));

    expect(await engine.sync()).toBe('retry');
    expect(fatal).not.toHaveBeenCalled();
    expect(await pendingIds()).toEqual([cat.id]);

    expect(await engine.sync()).toBe('ok');
    expect(remote.categories.get(cat.id)?.icon).toBe('briefcase');
  });

  it('never pushes an entry that was removed from the outbox mid-flush', async () => {
    const a = makeLink();
    const b = makeLink();
    await engine.saveLink(a);
    await engine.saveLink(b);
    const upsert = remote.upsertLink.bind(remote);
    remote.upsertLink = async (row) => {
      await upsert(row);
      await local.clear();
    };

    expect(await engine.sync()).toBe('ok');
    expect(remote.calls.filter((c) => c.startsWith('upsertLink'))).toEqual([`upsertLink:${a.id}`]);
    expect(remote.links.has(b.id)).toBe(false);
  });

  it('stops pushing once the signal is aborted and keeps the remaining entries', async () => {
    const a = makeLink();
    const b = makeLink();
    await engine.saveLink(a);
    await engine.saveLink(b);
    const controller = new AbortController();
    const upsert = remote.upsertLink.bind(remote);
    remote.upsertLink = async (row) => {
      await upsert(row);
      controller.abort();
    };

    await expect(engine.sync(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(remote.calls).toEqual([`upsertLink:${a.id}`]);
    expect(await pendingIds()).toEqual([b.id]);
    expect(fatal).not.toHaveBeenCalled();
  });

  it('does not start when the signal is already aborted', async () => {
    await engine.saveLink(makeLink());
    const controller = new AbortController();
    controller.abort();
    await expect(engine.sync(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(remote.calls).toEqual([]);
  });
});

describe('SyncEngine.recordVisit', () => {
  it('bumps the local count and queues a server increment', async () => {
    const link = remote.serverWriteLink(makeLink());
    await engine.sync();
    await engine.recordVisit(link.id, '2026-02-01T00:00:00.000Z');
    expect(await local.getLink(link.id)).toMatchObject({ visit_count: 1, last_visited_at: '2026-02-01T00:00:00.000Z' });

    expect(await engine.sync()).toBe('ok');
    expect(remote.calls).toContain(`incrementVisit:${link.id}`);
    expect(remote.links.get(link.id)?.visit_count).toBe(1);
  });

  it('ignores unknown links', async () => {
    await engine.recordVisit('missing', '2026-02-01T00:00:00.000Z');
    expect(await local.peekOutbox()).toEqual([]);
  });
});

describe('SyncEngine.sync pulling', () => {
  it('merges categories then links, including tombstones', async () => {
    const cat = remote.serverWriteCategory(makeCategory());
    const live = remote.serverWriteLink(makeLink({ category_id: cat.id }));
    const dead = remote.serverWriteLink(makeLink({ deleted_at: '2026-01-01T00:00:00.000Z' }));
    expect(await engine.sync()).toBe('ok');
    expect(remote.calls).toEqual(['pullCategories', 'pullLinks']);
    expect(await local.getCategory(cat.id)).toEqual(cat);
    expect(await local.getLink(live.id)).toEqual(live);
    expect(await local.getLink(dead.id)).toEqual(dead);
  });

  it('keeps a pending local change instead of the server copy', async () => {
    const server = remote.serverWriteLink(makeLink({ title: 'server' }));
    const pullLinks = remote.pullLinks.bind(remote);
    remote.pullLinks = async (since) => {
      remote.pullLinks = pullLinks;
      const rows = await pullLinks(since);
      await engine.saveLink({ ...server, title: 'mine' });
      return rows;
    };
    expect(await engine.sync()).toBe('ok');
    expect((await local.getLink(server.id))?.title).toBe('mine');
    expect(await pendingIds()).toEqual([server.id]);

    expect(await engine.sync()).toBe('ok');
    expect(await local.getLink(server.id)).toEqual(remote.links.get(server.id));
    expect((await local.getLink(server.id))?.title).toBe('mine');
  });

  it('advances the cursor and re-reads with an overlap window', async () => {
    remote.serverWriteLink(makeLink());
    const second = remote.serverWriteLink(makeLink());
    await engine.sync();
    expect(remote.sinceLog).toEqual([
      { table: 'categories', since: null },
      { table: 'links', since: null },
    ]);
    expect(await local.getCursor('links')).toBe(second.updated_at);

    await engine.sync();
    const expected = new Date(Date.parse(second.updated_at) - PULL_OVERLAP_MS).toISOString();
    expect(remote.sinceLog.at(-1)).toEqual({ table: 'links', since: expected });
    expect(await local.getCursor('links')).toBe(second.updated_at);
  });

  it('never moves the cursor backwards', async () => {
    const row = remote.serverWriteLink(makeLink());
    const later = new Date(Date.parse(row.updated_at) + 2000).toISOString();
    await local.setCursor('links', later);
    await engine.sync();
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
    await engine.sync();
    await save;
    expect((await local.getLink(server.id))?.title).toBe('mine');
  });

  it('applies nothing and leaves the cursor alone when aborted mid-pull', async () => {
    const cat = remote.serverWriteCategory(makeCategory());
    const link = remote.serverWriteLink(makeLink({ category_id: cat.id }));
    const controller = new AbortController();
    const pullLinks = remote.pullLinks.bind(remote);
    remote.pullLinks = async (since) => {
      const rows = await pullLinks(since);
      controller.abort();
      return rows;
    };

    await expect(engine.sync(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(remote.calls).toEqual(['pullCategories', 'pullLinks']);
    expect(await local.getLink(link.id)).toBeUndefined();
    expect(await local.getCursor('links')).toBeNull();
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

  it('starts a fresh run for a new signal instead of joining an aborted one', async () => {
    const link = makeLink();
    await engine.saveLink(link);
    let started!: () => void;
    const pushing = new Promise<void>((resolve) => (started = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const upsert = remote.upsertLink.bind(remote);
    remote.upsertLink = async (row) => {
      started();
      await gate;
      await upsert(row);
    };

    const a = new AbortController();
    const runA = engine.sync(a.signal);
    await pushing;
    a.abort();
    const runB = engine.sync(new AbortController().signal);
    release();

    await expect(runA).rejects.toMatchObject({ name: 'AbortError' });
    expect(await runB).toBe('ok');
    expect(remote.calls).toEqual([`upsertLink:${link.id}`, 'pullCategories', 'pullLinks']);
  });
});
