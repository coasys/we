// Phase 2 + 3c — validates @HasOne, @BelongsToOne, @BelongsToMany and IncludeMap eager loading
import type { PerspectiveProxy } from '@coasys/ad4m';

import { assert, test, wipePerspective } from '../harness/helpers';
import type { ScenarioModule } from '../harness/types';
import { TestComment } from '../models/TestComment';
import { TestPost } from '../models/TestPost';
import { TestTag } from '../models/TestTag';

export const scenario: ScenarioModule = {
  name: '04 — Relationships & Include',
  run: async (perspective: PerspectiveProxy) => {
    await wipePerspective(perspective);
    await TestPost.register(perspective);
    await TestComment.register(perspective);
    await TestTag.register(perspective);

    return [
      await test('@BelongsToOne — without include, relation is a raw ID string', async () => {
        const post = await TestPost.create(perspective, { title: 'Parent', body: '' });
        const comment = await TestComment.create(perspective, { body: 'child' });
        await post.addComments(comment.id);
        const found = await TestComment.findOne(perspective, { where: { id: comment.id } });
        assert(found !== null, 'Comment not found');
        // Without include, the reverse relation is the raw base-expression string
        assert(typeof found.post === 'string', `Expected string, got ${typeof found.post}`);
        assert(found.post === post.id, `Expected post.id, got ${found.post}`);
      }),

      await test('@BelongsToMany — without include, relation is string[]', async () => {
        const tag = await TestTag.create(perspective, { label: 'belongs-many' });
        const post1 = await TestPost.create(perspective, { title: 'T1', body: '' });
        const post2 = await TestPost.create(perspective, { title: 'T2', body: '' });
        await post1.addTags(tag.id);
        await post2.addTags(tag.id);
        const found = await TestTag.findOne(perspective, { where: { id: tag.id } });
        assert(found !== null, 'Tag not found');
        assert(Array.isArray(found.posts), 'posts should be an array');
        assert((found.posts as unknown as string[]).includes(post1.id), 'post1.id should be in tag.posts');
        assert((found.posts as unknown as string[]).includes(post2.id), 'post2.id should be in tag.posts');
      }),

      await test('include: { comments: true } hydrates @HasMany to TestComment instances', async () => {
        const post = await TestPost.create(perspective, { title: 'Include Test', body: '' });
        const comment = await TestComment.create(perspective, { body: 'hydrated' });
        await post.addComments(comment.id);
        const found = await TestPost.findOne(perspective, {
          where: { id: post.id },
          include: { comments: true },
        });
        assert(found !== null, 'Post not found');
        assert(found.comments.length > 0, 'comments should be non-empty');
        assert(found.comments[0] instanceof TestComment, 'comment should be a TestComment instance');
        assert(found.comments[0].body === 'hydrated', `body mismatch: ${found.comments[0].body}`);
      }),

      await test('include: { post: true } hydrates @BelongsToOne to a TestPost instance', async () => {
        const post = await TestPost.create(perspective, { title: 'Include Reverse', body: '' });
        const comment = await TestComment.create(perspective, { body: 'reverse' });
        await post.addComments(comment.id);
        const found = await TestComment.findOne(perspective, {
          where: { id: comment.id },
          include: { post: true },
        });
        assert(found !== null, 'Comment not found');
        assert(found.post instanceof TestPost, `post should be TestPost, got ${typeof found.post}`);
        assert(found.post?.title === 'Include Reverse', `post title mismatch: ${found.post?.title}`);
      }),

      await test('without include, @HasMany relations remain as string[]', async () => {
        const post = await TestPost.create(perspective, { title: 'No Include', body: '' });
        const comment = await TestComment.create(perspective, { body: 'stays string' });
        await post.addComments(comment.id);
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(found !== null, 'Post not found');
        assert(
          found.comments.length > 0 && typeof found.comments[0] === 'string',
          `Without include, comment entry should be a string, got ${typeof found.comments[0]}`,
        );
      }),

      await test('include sub-query: { comments: { limit: 2 } } caps related results', async () => {
        const post = await TestPost.create(perspective, { title: 'Limit Include', body: '' });
        for (let i = 0; i < 3; i++) {
          const c = await TestComment.create(perspective, { body: `c${i}` });
          await post.addComments(c.id);
        }
        const found = await TestPost.findOne(perspective, {
          where: { id: post.id },
          include: { comments: { limit: 2 } },
        });
        assert(found !== null, 'Post not found');
        assert(found.comments.length <= 2, `Expected ≤2 comments, got ${found.comments.length}`);
      }),
    ];
  },
};
