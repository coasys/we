// Phase 2 + 3c — validates @HasMany / @HasOne collection operations
import type { PerspectiveProxy } from '@coasys/ad4m';
import { LinkQuery } from '@coasys/ad4m';

import { assert, test, waitUntil, wipePerspective } from '../harness/helpers';
import type { ScenarioModule } from '../harness/types';
import { TestComment } from '../models/TestComment';
import { TestPost } from '../models/TestPost';

export const scenario: ScenarioModule = {
  name: '03 — Collections (@HasMany / @HasOne)',
  run: async (perspective: PerspectiveProxy) => {
    await wipePerspective(perspective);
    await perspective.ensureSDNASubjectClass(TestPost);
    await perspective.ensureSDNASubjectClass(TestComment);

    return [
      await test('@HasMany — fresh instance has empty array', () => {
        const post = new TestPost(perspective);
        assert(Array.isArray(post.comments), 'comments should be an array');
        assert(post.comments.length === 0, `Expected 0 comments, got ${post.comments.length}`);
      }),

      await test('add*() appends a target ID string to the relation', async () => {
        const post = new TestPost(perspective);
        post.title = 'Adder';
        post.body = '';
        await post.save();
        const c = new TestComment(perspective);
        c.body = 'added';
        await c.save();
        await post.addComments(c.id); // raw ID accepted as well as model instance
        // Poll until SurrealDB indexes the new relation link.
        let found: TestPost | null = null;
        await waitUntil(async () => {
          found = await TestPost.findOne(perspective, { where: { id: post.id } });
          return found !== null && (found.comments as unknown as string[]).includes(c.id);
        });
        assert((found!.comments as unknown as string[]).includes(c.id), 'comment ID should be in comments after add');
      }),

      await test('set*() replaces all targets atomically', async () => {
        const post = new TestPost(perspective);
        post.title = 'Setter';
        post.body = '';
        await post.save();
        const c1 = new TestComment(perspective);
        c1.body = 'old';
        await c1.save();
        const c2 = new TestComment(perspective);
        c2.body = 'new';
        await c2.save();
        await post.addComments(c1.id);
        await post.setComments([c2.id]);
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(!(found!.comments as unknown as string[]).includes(c1.id), 'c1 should be gone after setComments');
        assert((found!.comments as unknown as string[]).includes(c2.id), 'c2 should be present after setComments');
        assert(found!.comments.length === 1, `Expected 1 comment, got ${found!.comments.length}`);
      }),

      await test('remove*() removes a specific target without touching others', async () => {
        const post = new TestPost(perspective);
        post.title = 'Remover';
        post.body = '';
        await post.save();
        const c1 = new TestComment(perspective);
        c1.body = 'keep';
        await c1.save();
        const c2 = new TestComment(perspective);
        c2.body = 'remove';
        await c2.save();
        await post.addComments(c1.id);
        await post.addComments(c2.id);
        await post.removeComments(c2.id);
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert((found!.comments as unknown as string[]).includes(c1.id), 'c1 should still be present');
        assert(!(found!.comments as unknown as string[]).includes(c2.id), 'c2 should be removed');
      }),

      await test('relation links are visible in perspective after add*()', async () => {
        const post = new TestPost(perspective);
        post.title = 'Link Visibility';
        post.body = '';
        await post.save();
        const c = new TestComment(perspective);
        c.body = 'visible';
        await c.save();
        await post.addComments(c.id);
        const links = await perspective.get(new LinkQuery({ predicate: 'test://has_comment', source: post.id }));
        assert(links.length >= 1, `Expected ≥1 link, got ${links.length}`);
        assert(
          links.some((l) => l.data.target === c.id),
          'link pointing to comment should exist',
        );
      }),

      await test('@HasOne — returns a single value (string ID), not an array', async () => {
        const post = new TestPost(perspective);
        post.title = 'HasOne';
        post.body = '';
        await post.save();
        const c = new TestComment(perspective);
        c.body = 'pinned';
        await c.save();
        await post.addPinnedComment(c.id);
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        // pinnedComment is @HasOne — hydrated as a scalar, not an array
        assert(!Array.isArray(found!.pinnedComment), 'pinnedComment should not be an array');
        assert(
          (found!.pinnedComment as unknown as string) === c.id,
          `Expected comment ID, got ${found!.pinnedComment}`,
        );
      }),
    ];
  },
};
