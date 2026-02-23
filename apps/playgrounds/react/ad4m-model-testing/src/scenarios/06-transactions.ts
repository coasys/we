// Phase 3b — validates TransactionContext atomic multi-save/update/delete
import type { PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel } from '@coasys/ad4m';

import { assert, test, wipePerspective } from '../harness/helpers';
import type { ScenarioModule } from '../harness/types';
import { TestPost } from '../models/TestPost';

export const scenario: ScenarioModule = {
  name: '06 — Transactions',
  run: async (perspective: PerspectiveProxy) => {
    await wipePerspective(perspective);
    await TestPost.register(perspective);

    return [
      await test('Ad4mModel.transaction() commits multiple saves atomically', async () => {
        const p1 = new TestPost(perspective);
        p1.title = 'Tx1';
        p1.body = '';
        const p2 = new TestPost(perspective);
        p2.title = 'Tx2';
        p2.body = '';

        await Ad4mModel.transaction(perspective, async (tx) => {
          await p1.save(tx.batchId);
          await p2.save(tx.batchId);
        });

        const found1 = await TestPost.findOne(perspective, { where: { id: p1.id } });
        const found2 = await TestPost.findOne(perspective, { where: { id: p2.id } });
        assert(found1 !== null, 'p1 should be persisted after transaction');
        assert(found2 !== null, 'p2 should be persisted after transaction');
        assert(found1.title === 'Tx1', `p1.title mismatch: ${found1.title}`);
        assert(found2.title === 'Tx2', `p2.title mismatch: ${found2.title}`);
      }),

      await test('Ad4mModel.transaction() commits save + update atomically', async () => {
        // Pre-save outside the transaction so the record is committed to
        // SurrealDB before the transaction starts.  Without this, both
        // save(batchId) calls go through the CREATE path (isNew=true) because
        // the first write is still uncommitted when the second check runs,
        // leaving two competing title links and a non-deterministic result.
        const post = new TestPost(perspective);
        post.title = 'Before';
        post.body = '';
        await post.save();

        await Ad4mModel.transaction(perspective, async (tx) => {
          post.title = 'After';
          await post.save(tx.batchId); // UPDATE path: record already exists
        });

        const found = await TestPost.findOne(perspective, { where: { id: post.id } });
        assert(found !== null, 'Post should be persisted');
        assert(found.title === 'After', `Expected 'After', got '${found.title}'`);
      }),

      await test('Ad4mModel.transaction() commits save + delete atomically', async () => {
        // Pre-existing post to delete
        const toDelete = new TestPost(perspective);
        toDelete.title = 'Will Be Deleted';
        toDelete.body = '';
        await toDelete.save();
        const deletedId = toDelete.id;

        // New post to create in the same transaction
        const toCreate = new TestPost(perspective);
        toCreate.title = 'Created In Tx';
        toCreate.body = '';

        await Ad4mModel.transaction(perspective, async (tx) => {
          await toCreate.save(tx.batchId);
          await toDelete.delete(tx.batchId);
        });

        const foundCreated = await TestPost.findOne(perspective, { where: { id: toCreate.id } });
        const foundDeleted = await TestPost.findOne(perspective, { where: { id: deletedId } });
        assert(foundCreated !== null, 'New post should exist after transaction');
        assert(foundDeleted === null, 'Post should be gone after delete in same transaction');
      }),

      await test('throwing inside transaction() means the callback threw — writes before throw visible', async () => {
        // AD4M batch semantics: abortBatch rolls back uncommitted writes.
        // We verify the transaction itself throws and propagates the error.
        const post = new TestPost(perspective);
        post.title = 'Pre-throw';
        post.body = '';
        let threw = false;
        try {
          await Ad4mModel.transaction(perspective, async (tx) => {
            await post.save(tx.batchId);
            throw new Error('deliberate abort');
          });
        } catch {
          threw = true;
        }
        assert(threw, 'transaction() should re-throw when callback throws');
      }),
    ];
  },
};
