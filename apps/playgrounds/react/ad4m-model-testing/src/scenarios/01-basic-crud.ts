// Phase 1b + 2 — validates basic save/get/id-alias/findAll/delete
import type { PerspectiveProxy } from '@coasys/ad4m';

import { assert, test, wipePerspective } from '../harness/helpers';
import type { ScenarioModule } from '../harness/types';
import { TestPost } from '../models/TestPost';

export const scenario: ScenarioModule = {
  name: '01 — Basic CRUD',
  run: async (perspective: PerspectiveProxy) => {
    await wipePerspective(perspective);
    await perspective.ensureSDNASubjectClass(TestPost);

    return [
      await test('save() populates a non-empty baseExpression', async () => {
        const post = new TestPost(perspective);
        post.title = 'CRUD Test';
        post.body = 'body';
        await post.save();
        assert(post.baseExpression !== '', 'baseExpression should be non-empty after save');
      }),

      await test('id getter is an alias for baseExpression', async () => {
        const post = new TestPost(perspective);
        post.title = 'ID Alias';
        post.body = '';
        await post.save();
        assert(post.id === post.baseExpression, `id (${post.id}) !== baseExpression (${post.baseExpression})`);
      }),

      await test('get() re-reads persisted values from perspective', async () => {
        const post = new TestPost(perspective);
        post.title = 'getData Target';
        post.body = 'snapshot body';
        await post.save();
        const data = await post.get();
        assert(typeof data === 'object' && data !== null, 'get() should return an object');
        assert(data.title === 'getData Target', `title mismatch: ${data.title}`);
        assert(data.body === 'snapshot body', `body mismatch: ${data.body}`);
      }),

      await test('findAll() returns all saved instances', async () => {
        const post = new TestPost(perspective);
        post.title = 'Count Test';
        post.body = '';
        await post.save();
        // Query by the specific id so the result is isolated from every other
        // test's posts — avoids flakiness from SurrealDB write-visibility lag.
        const results = await TestPost.findAll(perspective, { where: { id: post.id } });
        assert(results.length === 1, `Expected exactly 1 post for this id, got ${results.length}`);
        assert(results[0].title === 'Count Test', `title mismatch: ${results[0].title}`);
      }),

      await test('save() on existing instance updates without creating a duplicate', async () => {
        const post = new TestPost(perspective);
        post.title = 'Original';
        post.body = '';
        await post.save();
        const id = post.id;
        post.title = 'Updated';
        await post.save();
        const all = await TestPost.findAll(perspective, { where: { id } });
        assert(all.length === 1, `Expected exactly 1 post after re-save, got ${all.length}`);
        assert(all[0].title === 'Updated', `Expected 'Updated', got '${all[0].title}'`);
      }),

      await test('delete() removes the instance from perspective', async () => {
        const post = new TestPost(perspective);
        post.title = 'Delete Target';
        post.body = '';
        await post.save();
        const id = post.id;
        await post.delete();
        const found = await TestPost.findAll(perspective, { where: { id } });
        assert(found.length === 0, 'Deleted post should not appear in findAll');
      }),
    ];
  },
};
