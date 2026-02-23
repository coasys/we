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
    await perspective.ensureSDNASubjectClass(TestPost);
    await perspective.ensureSDNASubjectClass(TestComment);
    await perspective.ensureSDNASubjectClass(TestTag);

    return [
      await test('@BelongsToOne — without include, relation is a raw ID string', async () => {
        const post = new TestPost(perspective);
        post.title = 'Parent';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'child';
        await comment.save();
        await post.addComments(comment.id);
        const found = await TestComment.findOne(perspective, { where: { id: comment.id } });
        assert(found !== null, 'Comment not found');
        // Without include, the reverse relation is the raw base-expression string
        assert(typeof found.post === 'string', `Expected string, got ${typeof found.post}`);
        assert(found.post === post.id, `Expected post.id, got ${found.post}`);
      }),

      await test('@BelongsToMany — without include, relation is string[]', async () => {
        const tag = new TestTag(perspective);
        tag.label = 'belongs-many';
        await tag.save();
        const post1 = new TestPost(perspective);
        post1.title = 'T1';
        post1.body = '';
        await post1.save();
        const post2 = new TestPost(perspective);
        post2.title = 'T2';
        post2.body = '';
        await post2.save();
        await post1.addTags(tag.id);
        await post2.addTags(tag.id);
        const found = await TestTag.findOne(perspective, { where: { id: tag.id } });
        assert(found !== null, 'Tag not found');
        assert(Array.isArray(found.posts), 'posts should be an array');
        assert((found.posts as unknown as string[]).includes(post1.id), 'post1.id should be in tag.posts');
        assert((found.posts as unknown as string[]).includes(post2.id), 'post2.id should be in tag.posts');
      }),

      await test('include: { comments: true } hydrates @HasMany to TestComment instances', async () => {
        const post = new TestPost(perspective);
        post.title = 'Include Test';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'hydrated';
        await comment.save();
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
        const post = new TestPost(perspective);
        post.title = 'Include Reverse';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'reverse';
        await comment.save();
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
        const post = new TestPost(perspective);
        post.title = 'No Include';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'stays string';
        await comment.save();
        await post.addComments(comment.id);
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(found !== null, 'Post not found');
        assert(
          found.comments.length > 0 && typeof found.comments[0] === 'string',
          `Without include, comment entry should be a string, got ${typeof found.comments[0]}`,
        );
      }),

      await test('include sub-query: { comments: { limit: 2 } } caps related results', async () => {
        const post = new TestPost(perspective);
        post.title = 'Limit Include';
        post.body = '';
        await post.save();
        for (let i = 0; i < 3; i++) {
          const c = new TestComment(perspective);
          c.body = `c${i}`;
          await c.save();
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
