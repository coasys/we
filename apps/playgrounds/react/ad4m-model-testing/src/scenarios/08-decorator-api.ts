// Decorator API smoke tests — exercises all six decorator types against local
// test models: @Model, @Flag, @Property, @HasMany, @HasOne, @BelongsToOne, @BelongsToMany.
import type { PerspectiveProxy } from '@coasys/ad4m';

import { assert, test, waitUntil, wipePerspective } from '../harness/helpers';
import type { ScenarioModule } from '../harness/types';
import { TestComment } from '../models/TestComment';
import { TestPost } from '../models/TestPost';
import { TestTag } from '../models/TestTag';

export const scenario: ScenarioModule = {
  name: '08 — decorator API (@Property, @Flag, @HasMany, @HasOne, @BelongsToOne, @BelongsToMany)',
  run: async (perspective: PerspectiveProxy) => {
    // Wipe all links so each run starts clean
    await wipePerspective(perspective);

    await TestPost.register(perspective);
    await TestComment.register(perspective);
    await TestTag.register(perspective);

    return [
      // ── @Model + save ─────────────────────────────────────────────────────
      await test('@Model — save() sets id', async () => {
        const post = new TestPost(perspective);
        post.title = 'Hello World';
        post.body = 'First post body';
        await post.save();
        assert(post.id !== '', 'id should be set after save');
      }),

      // ── @Flag ─────────────────────────────────────────────────────────────
      await test('@Flag — findAll() returns only TestPost instances', async () => {
        // Create a post inside this test so the assertion is not dependent on
        // a previous test's write being visible yet.
        await TestPost.create(perspective, { title: 'Flag Check', body: '' });
        // Poll until SurrealDB indexes the flag link — write visibility is not
        // always immediate after perspective.add() resolves.
        let posts: TestPost[] = [];
        await waitUntil(async () => {
          posts = await TestPost.findAll(perspective);
          return posts.length > 0;
        });
        assert(
          posts.every((p) => p instanceof TestPost),
          'Non-post found in results',
        );
      }),

      // ── @Flag immutability ────────────────────────────────────────────────
      await test('@Flag — flag value survives re-save (immutable after creation)', async () => {
        const post = new TestPost(perspective);
        post.title = 'Flag Immutability Test';
        post.body = '';
        await post.save();
        const id = post.id;

        // Mutate title and re-save — flag must not be corrupted
        post.title = 'Updated Title';
        await post.save();

        // The post must still be findable by TestPost.findAll()
        // (which filters by the flag predicate + value test://post)
        const found = await TestPost.findAll(perspective, { where: { id } });
        assert(found.length === 1, `Expected 1 post after re-save, got ${found.length}`);
        assert(found[0].title === 'Updated Title', `title not updated: ${found[0].title}`);
        // type field reflects the @Flag value
        assert(found[0].type === 'test://post', `flag value corrupted: ${found[0].type}`);
      }),

      // ── @Property ─────────────────────────────────────────────────────────
      await test('@Property — fields round-trip correctly', async () => {
        const post = await TestPost.create(perspective, { title: 'Round Trip', body: 'body text' });
        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(found !== null, 'Post not found by base expression');
        assert(found.title === 'Round Trip', `title mismatch: ${found.title}`);
        assert(found.body === 'body text', `body mismatch: ${found.body}`);
      }),

      // ── @HasMany ──────────────────────────────────────────────────────────
      await test('@HasMany — addComments links comment to post', async () => {
        const post = await TestPost.create(perspective, { title: 'Post With Comment', body: '' });
        const comment = await TestComment.create(perspective, { body: 'Nice post!' });
        await post.addComments(comment); // pass model instance directly
        const updated = await TestPost.findOne(perspective, { where: { id: post.id }, include: { comments: true } });
        assert(updated?.comments?.some((c) => c.id === comment.id) ?? false, 'comment not in post.comments');
      }),

      // ── @HasOne ───────────────────────────────────────────────────────────
      await test('@HasOne — pinnedComment hydrates to a TestComment instance', async () => {
        const post = await TestPost.create(perspective, { title: 'Post With Pin', body: '' });
        const comment = await TestComment.create(perspective, { body: 'Pinned!' });
        await post.addPinnedComment(comment); // pass model instance
        const updated = await TestPost.findOne(perspective, {
          where: { id: post.id },
          include: { pinnedComment: true },
        });
        assert(updated !== null, 'Post not found');
        assert(
          updated.pinnedComment instanceof TestComment,
          `pinnedComment should be TestComment, got ${typeof updated.pinnedComment}`,
        );
        assert(updated.pinnedComment?.id === comment.id, `pinnedComment id mismatch: ${updated.pinnedComment?.id}`);
      }),

      // ── @BelongsToOne ─────────────────────────────────────────────────────
      await test('@BelongsToOne — comment.post resolves to a TestPost instance', async () => {
        const post = await TestPost.create(perspective, { title: 'Parent Post', body: '' });
        const comment = await TestComment.create(perspective, { body: 'Reverse traversal test' });
        await post.addComments(comment);
        const found = await TestComment.findOne(perspective, { where: { id: comment.id }, include: { post: true } });
        assert(found !== null, 'Comment not found');
        assert(found.post instanceof TestPost, `post should be TestPost, got ${typeof found.post}`);
        assert(found.post?.id === post.id, `post id mismatch: ${found.post?.id}`);
      }),

      // ── @BelongsToOne (pinnedBy) ──────────────────────────────────────────
      await test('@BelongsToOne — comment.pinnedBy resolves to the post that pinned it', async () => {
        const post = await TestPost.create(perspective, { title: 'Pinning Post', body: '' });
        const comment = await TestComment.create(perspective, { body: 'I am the pinned comment' });
        await post.addPinnedComment(comment);
        const found = await TestComment.findOne(perspective, {
          where: { id: comment.id },
          include: { pinnedBy: true },
        });
        assert(found !== null, 'Comment not found');
        assert(found.pinnedBy instanceof TestPost, `pinnedBy should be TestPost, got ${typeof found.pinnedBy}`);
        assert(found.pinnedBy?.id === post.id, `pinnedBy id mismatch: ${found.pinnedBy?.id}`);
        // Also verify a comment that isn't pinned has pinnedBy === null
        const unpinned = await TestComment.create(perspective, { body: 'Not pinned' });
        const foundUnpinned = await TestComment.findOne(perspective, {
          where: { id: unpinned.id },
          include: { pinnedBy: true },
        });
        assert(foundUnpinned?.pinnedBy === null, 'unpinned comment should have pinnedBy === null');
      }),

      // ── findOne ───────────────────────────────────────────────────────────
      await test('findOne() — returns a single matching instance or null', async () => {
        const post = await TestPost.create(perspective, { title: 'FindOne Target', body: '' });
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
        const post = await TestPost.create(perspective, { title: 'Post For Remove', body: '' });
        const c1 = await TestComment.create(perspective, { body: 'To keep' });
        const c2 = await TestComment.create(perspective, { body: 'To remove' });
        await post.addComments(c1);
        await post.addComments(c2);
        await post.removeComments(c2);
        const found = await TestPost.findOne(perspective, { where: { id: post.id }, include: { comments: true } });
        assert(found !== null, 'Post not found');
        assert(
          found.comments.some((c) => c.id === c1.id),
          'c1 should still be present',
        );
        assert(!found.comments.some((c) => c.id === c2.id), 'c2 should have been removed');
      }),

      // ── setComments (relationSetter / bulk replace) ───────────────────────
      await test('setComments() — replaces entire relation set atomically', async () => {
        const post = await TestPost.create(perspective, { title: 'Post For Set', body: '' });
        const c1 = await TestComment.create(perspective, { body: 'Initial A' });
        const c2 = await TestComment.create(perspective, { body: 'Initial B' });
        await post.addComments(c1);
        await post.addComments(c2);
        const c3 = await TestComment.create(perspective, { body: 'Replacement' });
        await post.setComments([c3]);
        const found = await TestPost.findOne(perspective, { where: { id: post.id }, include: { comments: true } });
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
        const post = await TestPost.create(perspective, { title: 'To Be Deleted', body: '' });
        const id = post.id;
        await post.delete();
        const found = await TestPost.findOne(perspective, { where: { id } });
        assert(found === null, 'Post should not be found after delete()');
      }),

      // ── @BelongsToMany ────────────────────────────────────────────────────
      await test('@BelongsToMany — tag.posts contains hydrated TestPost instances', async () => {
        const tag = await TestTag.create(perspective, { label: 'shared-tag' });
        const post1 = await TestPost.create(perspective, { title: 'Tagged Post 1', body: '' });
        const post2 = await TestPost.create(perspective, { title: 'Tagged Post 2', body: '' });
        await post1.addTags(tag); // pass model instance
        await post2.addTags(tag);
        const found = await TestTag.findOne(perspective, { where: { id: tag.id }, include: { posts: true } });
        assert(found !== null, 'Tag not found');
        assert(
          found.posts.every((p) => p instanceof TestPost),
          'tag.posts should contain TestPost instances',
        );
        assert(
          found.posts.some((p) => p.id === post1.id),
          'post1 not in tag.posts',
        );
        assert(
          found.posts.some((p) => p.id === post2.id),
          'post2 not in tag.posts',
        );
      }),
    ];
  },
};
