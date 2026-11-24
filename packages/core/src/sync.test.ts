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
