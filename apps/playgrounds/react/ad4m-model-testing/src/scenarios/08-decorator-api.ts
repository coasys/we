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

      // ── @BelongsToOne (pinnedBy) ──────────────────────────────────────────
      await test('@BelongsToOne — comment.pinnedBy resolves to the post that pinned it', async () => {
        const post = new TestPost(perspective);
        post.title = 'Pinning Post';
        post.body = '';
        await post.save();
        const comment = new TestComment(perspective);
        comment.body = 'I am the pinned comment';
        await comment.save();
        await post.addPinnedComment(comment);
        const found = await TestComment.findAll(perspective, { where: { id: comment.id } });
        assert(found.length > 0, 'Comment not found');
        assert(
          found[0].pinnedBy instanceof TestPost,
          `pinnedBy should be TestPost, got ${typeof found[0].pinnedBy}`,
        );
        assert(
          found[0].pinnedBy?.id === post.id,
          `pinnedBy id mismatch: ${found[0].pinnedBy?.id}`,
        );
        // Also verify a comment that isn't pinned has pinnedBy === null
        const unpinned = new TestComment(perspective);
        unpinned.body = 'Not pinned';
        await unpinned.save();
        const foundUnpinned = await TestComment.findAll(perspective, { where: { id: unpinned.id } });
        assert(foundUnpinned[0].pinnedBy === null, 'unpinned comment should have pinnedBy === null');
      }),

      // ── findOne ───────────────────────────────────────────────────────────
      await test('findOne() — returns a single matching instance or null', async () => {
        const post = new TestPost(perspective);
        post.title = 'FindOne Target';
        post.body = '';
        await post.save();
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(found !== null, 'findOne returned null for existing post');
        assert(found instanceof TestPost, `findOne should return TestPost, got ${typeof found}`);
        assert(found.id === post.id, `id mismatch: ${found.id}`);
        assert(found.title === 'FindOne Target', `title mismatch: ${found.title}`);
        const missing = await TestPost.findOne(perspective, { where: { id: 'literal://string:nonexistent' } });
        assert(missing === null, 'findOne should return null for missing id');
      }),

      // ── save() update ─────────────────────────────────────────────────────
      await test('save() — updating a property persists the new value', async () => {
        const post = new TestPost(perspective);
        post.title = 'Original Title';
        post.body = '';
        await post.save();
        post.title = 'Updated Title';
        await post.save();
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(found !== null, 'Post not found after update');
        assert(found.title === 'Updated Title', `Expected 'Updated Title', got '${found.title}'`);
      }),

      // ── removeComments ────────────────────────────────────────────────────
      await test('removeComments() — unlinks a comment from a post', async () => {
        const post = new TestPost(perspective);
        post.title = 'Post For Remove';
        post.body = '';
        await post.save();
        const c1 = new TestComment(perspective);
        c1.body = 'To keep';
        await c1.save();
        const c2 = new TestComment(perspective);
        c2.body = 'To remove';
        await c2.save();
        await post.addComments(c1);
        await post.addComments(c2);
        await post.removeComments(c2);
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(found !== null, 'Post not found');
        assert(
          found.comments.some((c) => c.id === c1.id),
          'c1 should still be present',
        );
        assert(!found.comments.some((c) => c.id === c2.id), 'c2 should have been removed');
      }),

      // ── setComments (relationSetter / bulk replace) ───────────────────────
      await test('setComments() — replaces entire relation set atomically', async () => {
        const post = new TestPost(perspective);
        post.title = 'Post For Set';
        post.body = '';
        await post.save();
        const c1 = new TestComment(perspective);
        c1.body = 'Initial A';
        await c1.save();
        const c2 = new TestComment(perspective);
        c2.body = 'Initial B';
        await c2.save();
        await post.addComments(c1);
        await post.addComments(c2);
        const c3 = new TestComment(perspective);
        c3.body = 'Replacement';
        await c3.save();
        await post.setComments([c3]);
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(found !== null, 'Post not found');
        assert(!found.comments.some((c) => c.id === c1.id), 'c1 should have been replaced');
        assert(!found.comments.some((c) => c.id === c2.id), 'c2 should have been replaced');
        assert(
          found.comments.some((c) => c.id === c3.id),
          'c3 should be the only comment',
        );
        assert(found.comments.length === 1, `Expected 1 comment, got ${found.comments.length}`);
      }),

      // ── delete ────────────────────────────────────────────────────────────
      await test('delete() — removes the instance from the perspective', async () => {
        const post = new TestPost(perspective);
        post.title = 'To Be Deleted';
        post.body = '';
        await post.save();
        const id = post.id;
        await post.delete();
        const found = await TestPost.findOne(perspective, { where: { id } });
        assert(found === null, 'Post should not be found after delete()');
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
