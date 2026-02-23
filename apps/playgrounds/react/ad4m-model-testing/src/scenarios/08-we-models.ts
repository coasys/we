// Phase 2 smoke test — exercises local test models
// with the new decorator API (@Model, @Property, @HasMany, @Flag, @BelongsToOne).
import type { PerspectiveProxy } from '@coasys/ad4m';
import { LinkQuery } from '@coasys/ad4m';

import type { ScenarioModule } from '../harness/types';
import { assert, test } from '../harness/types';
import { TestComment } from '../models/TestComment';
import { TestPost } from '../models/TestPost';

export const scenario: ScenarioModule = {
  name: '08 — test models (@Property, @HasMany, @Flag, @BelongsToOne)',
  run: async (perspective: PerspectiveProxy) => {
    // Wipe all links so each run starts clean
    const existing = await perspective.get(new LinkQuery({}));
    await Promise.all(existing.map((l) => perspective.remove(l)));

    await perspective.ensureSDNASubjectClass(TestPost);
    await perspective.ensureSDNASubjectClass(TestComment);

    return [
      await test('TestPost.save() sets baseExpression', async () => {
        const post = new TestPost(perspective);
        post.title = 'Hello World';
        post.body = 'First post body';
        await post.save();
        assert(post.baseExpression !== '', 'baseExpression should be set after save');
      }),

      await test('TestPost.findAll() filters by @Flag', async () => {
        const posts = await TestPost.findAll(perspective);
        assert(posts.length > 0, 'No posts found');
        assert(
          posts.every((p) => p instanceof TestPost),
          'Non-post found in results',
        );
      }),

      await test('@Property fields round-trip correctly', async () => {
        const post = new TestPost(perspective);
        post.title = 'Round Trip';
        post.body = 'body text';
        await post.save();
        const found = await TestPost.findAll(perspective, { where: { base: post.baseExpression } });
        assert(found.length > 0, 'Post not found by base expression');
        assert(found[0].title === 'Round Trip', `title mismatch: ${found[0].title}`);
        assert(found[0].body === 'body text', `body mismatch: ${found[0].body}`);
      }),

      await test('@HasMany — addComments links comment to post', async () => {
        const post = new TestPost(perspective);
        post.title = 'Post With Comment';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'Nice post!';
        await comment.save();
        await post.addComments(comment.baseExpression);
        const updated = await TestPost.findAll(perspective, { where: { base: post.baseExpression } });
        assert(updated[0]?.comments?.includes(comment.baseExpression), 'comment not in post.comments');
      }),

      await test('@BelongsToOne — comment.post resolves to parent post', async () => {
        const post = new TestPost(perspective);
        post.title = 'Parent Post';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'Reverse traversal test';
        await comment.save();
        await post.addComments(comment.baseExpression);
        const found = await TestComment.findAll(perspective, { where: { base: comment.baseExpression } });
        assert(found.length > 0, 'Comment not found');
        assert(found[0].post === post.baseExpression, `post backlink mismatch: ${found[0].post}`);
      }),
    ];
  },
};
