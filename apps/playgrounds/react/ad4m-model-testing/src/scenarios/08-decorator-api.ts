// Decorator API smoke tests — exercises all six decorator types against local
// test models: @Model, @Flag, @Property, @HasMany, @HasOne, @BelongsToOne, @BelongsToMany.
import type { PerspectiveProxy } from '@coasys/ad4m';
import { LinkQuery } from '@coasys/ad4m';

import type { ScenarioModule } from '../harness/types';
import { assert, test } from '../harness/types';
import { TestComment } from '../models/TestComment';
import { TestPost } from '../models/TestPost';
import { TestTag } from '../models/TestTag';

export const scenario: ScenarioModule = {
  name: '08 — decorator API (@Property, @Flag, @HasMany, @HasOne, @BelongsToOne, @BelongsToMany)',
  run: async (perspective: PerspectiveProxy) => {
    // Wipe all links so each run starts clean
    const existing = await perspective.get(new LinkQuery({}));
    await Promise.all(existing.map((l) => perspective.remove(l)));

    await perspective.ensureSDNASubjectClass(TestPost);
    await perspective.ensureSDNASubjectClass(TestComment);
    await perspective.ensureSDNASubjectClass(TestTag);

    return [
      // ── @Model + save ─────────────────────────────────────────────────────
      await test('@Model — save() sets baseExpression', async () => {
        const post = new TestPost(perspective);
        post.title = 'Hello World';
        post.body = 'First post body';
        await post.save();
        assert(post.baseExpression !== '', 'baseExpression should be set after save');
      }),

      // ── @Flag ─────────────────────────────────────────────────────────────
      await test('@Flag — findAll() returns only TestPost instances', async () => {
        const posts = await TestPost.findAll(perspective);
        assert(posts.length > 0, 'No posts found');
        assert(
          posts.every((p) => p instanceof TestPost),
          'Non-post found in results',
        );
      }),

      // ── @Property ─────────────────────────────────────────────────────────
      await test('@Property — fields round-trip correctly', async () => {
        const post = new TestPost(perspective);
        post.title = 'Round Trip';
        post.body = 'body text';
        await post.save();
        const found = await TestPost.findAll(perspective, { where: { id: post.id } });
        assert(found.length > 0, 'Post not found by base expression');
        assert(found[0].title === 'Round Trip', `title mismatch: ${found[0].title}`);
        assert(found[0].body === 'body text', `body mismatch: ${found[0].body}`);
      }),

      // ── @HasMany ──────────────────────────────────────────────────────────
      await test('@HasMany — addComments links comment to post', async () => {
        const post = new TestPost(perspective);
        post.title = 'Post With Comment';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'Nice post!';
        await comment.save();
        await post.addComments(comment); // pass model instance directly
        const updated = await TestPost.findAll(perspective, { where: { id: post.id } });
        assert(
          updated[0]?.comments?.some((c) => c.id === comment.id),
          'comment not in post.comments',
        );
      }),

      // ── @HasOne ───────────────────────────────────────────────────────────
      await test('@HasOne — pinnedComment hydrates to a TestComment instance', async () => {
        const post = new TestPost(perspective);
        post.title = 'Post With Pin';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'Pinned!';
        await comment.save();
        await post.addPinnedComment(comment); // pass model instance
        const updated = await TestPost.findAll(perspective, { where: { id: post.id } });
        assert(updated.length > 0, 'Post not found');
        assert(
          updated[0].pinnedComment instanceof TestComment,
          `pinnedComment should be TestComment, got ${typeof updated[0].pinnedComment}`,
        );
        assert(
          updated[0].pinnedComment?.id === comment.id,
          `pinnedComment id mismatch: ${updated[0].pinnedComment?.id}`,
        );
      }),

      // ── @BelongsToOne ─────────────────────────────────────────────────────
      await test('@BelongsToOne — comment.post resolves to a TestPost instance', async () => {
        const post = new TestPost(perspective);
        post.title = 'Parent Post';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'Reverse traversal test';
        await comment.save();
        await post.addComments(comment);
        const found = await TestComment.findAll(perspective, { where: { id: comment.id } });
        assert(found.length > 0, 'Comment not found');
        assert(found[0].post instanceof TestPost, `post should be TestPost, got ${typeof found[0].post}`);
        assert(found[0].post?.id === post.id, `post id mismatch: ${found[0].post?.id}`);
      }),

      // ── @BelongsToMany ────────────────────────────────────────────────────
      await test('@BelongsToMany — tag.posts contains hydrated TestPost instances', async () => {
        const tag = new TestTag(perspective);
        tag.label = 'shared-tag';
        await tag.save();
        const post1 = new TestPost(perspective);
        post1.title = 'Tagged Post 1';
        post1.body = '';
        await post1.save();
        const post2 = new TestPost(perspective);
        post2.title = 'Tagged Post 2';
        post2.body = '';
        await post2.save();
        await post1.addTags(tag); // pass model instance
        await post2.addTags(tag);
        const found = await TestTag.findAll(perspective, { where: { id: tag.id } });
        assert(found.length > 0, 'Tag not found');
        assert(
          found[0].posts.every((p) => p instanceof TestPost),
          'tag.posts should contain TestPost instances',
        );
        assert(
          found[0].posts.some((p) => p.id === post1.id),
          'post1 not in tag.posts',
        );
        assert(
          found[0].posts.some((p) => p.id === post2.id),
          'post2 not in tag.posts',
        );
      }),
    ];
  },
};
