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

    expect(await store.ensureOwner('user-a')).toEqual({ switched: false, discarded: 0 });
    const link = makeLink();
    await store.apply({ links: [link], mutations: [{ type: 'visit', id: link.id }] });

    expect(await store.ensureOwner('user-a')).toEqual({ switched: false, discarded: 0 });
    expect(await store.getOwner()).toBe('user-a');
    expect(await store.listLinks()).toEqual([link]);
    expect(await store.peekOutbox()).toHaveLength(1);
  });

  it('wipes everything when a different user signs in and counts the discarded changes', async () => {
    const store = freshStore();
    await store.ensureOwner('user-a');
    await store.apply({
      links: [makeLink()],
      categories: [makeCategory()],
      mutations: [
        { type: 'visit', id: 'x' },
        { type: 'visit', id: 'y' },
      ],
    });
    await store.setCursor('links', '2026-01-02T00:00:00.000Z');

    expect(await store.ensureOwner('user-b')).toEqual({ switched: true, discarded: 2 });
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

    expect(await store.ensureOwner('user-a')).toEqual({ switched: false, discarded: 1 });
    expect(await store.listLinks()).toEqual([]);
    expect(await store.peekOutbox()).toEqual([]);
  });
});
