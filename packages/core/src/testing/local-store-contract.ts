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
      expect(await s.peekOutboxHead()).toBeUndefined();
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
      expect(await s.peekOutboxHead()).toEqual(entries[0]);

      await s.removeOutbox(entries[1].seq);
      expect((await s.peekOutbox()).map((e) => e.mutation)).toEqual([m1, m3]);

      await s.removeOutbox(entries[0].seq);
      expect(await s.peekOutboxHead()).toEqual(entries[2]);
      await s.apply({ mutations: [m1] });

      await s.removeOutbox(entries[2].seq);
      await s.apply({ mutations: [m2] });
      const after = await s.peekOutbox();
      expect(after.map((e) => e.mutation)).toEqual([m1, m2]);
      expect(after[0].seq).toBeGreaterThan(entries[2].seq);
      expect(after[1].seq).toBeGreaterThan(after[0].seq);
      expect(await s.peekOutboxHead()).toEqual(after[0]);
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
      expect(await s.peekOutboxHead()).toBeUndefined();
      expect(await s.getCursor('links')).toBeNull();
    });
  });
}
