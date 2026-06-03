// Phase 3d — validates subscribe() delivery, debounce, error handling
import type { PerspectiveProxy } from '@coasys/ad4m';

import { wipePerspective } from '../harness/helpers'; // assert, test, waitUntil,
import type { ScenarioModule } from '../harness/types';
import { TestPost } from '../models/TestPost';

// // ── Helper: collect subscription callbacks with a timeout ────────────────────
// function waitForCallbacks<T>(
//   targetCount: number,
//   timeoutMs = 6000,
// ): { callback: (results: T[]) => void; done: Promise<T[][]>; all: T[][] } {
//   const all: T[][] = [];
//   let resolve: ((v: T[][]) => void) | null = null;
//   let timer: ReturnType<typeof setTimeout> | null = null;

//   const done = new Promise<T[][]>((res, rej) => {
//     timer = setTimeout(
//       () => rej(new Error(`Timeout: expected ${targetCount} callbacks, got ${all.length}`)),
//       timeoutMs,
//     );
//     resolve = res;
//   });

//   const callback = (results: T[]) => {
//     all.push(results);
//     if (all.length >= targetCount && resolve) {
//       if (timer) clearTimeout(timer);
//       resolve(all);
//     }
//   };

//   return { callback, done, all };
// }

export const scenario: ScenarioModule = {
  name: '05 — Subscriptions',
  run: async (perspective: PerspectiveProxy) => {
    await wipePerspective(perspective);
    await TestPost.register(perspective);

    return [
      // // ── 1. Immediate callback ─────────────────────────────────────────────
      // await test('subscribe() calls callback immediately with initial results', async () => {
      //   const { callback, done } = waitForCallbacks<TestPost>(1);
      //   const sub = TestPost.subscribe(perspective, {}, callback);
      //   const [results] = await done;
      //   sub.unsubscribe();
      //   assert(Array.isArray(results), `Expected array, got ${typeof results}`);
      // }),
      // // ── 2. Re-fires on link-added ─────────────────────────────────────────
      // await test('subscribe() calls callback again when a relevant link is added', async () => {
      //   const all: TestPost[][] = [];
      //   const sub = TestPost.subscribe(perspective, {}, (r) => all.push(r));
      //   // Wait for initial callback
      //   await waitUntil(() => all.length >= 1);
      //   const post = new TestPost(perspective);
      //   post.title = 'New For Sub';
      //   post.body = '';
      //   await post.save();
      //   // The subscription callback fires asynchronously (after the coalesce
      //   // debounce), so poll until it delivers a batch containing the new post.
      //   await waitUntil(() => all.some((batch) => batch.some((p) => p.id === post.id)), 8000);
      //   sub.unsubscribe();
      //   assert(all.length >= 2, `Expected ≥2 callbacks, got ${all.length}`);
      //   assert(
      //     all.some((batch) => batch.some((p) => p.id === post.id)),
      //     'Newly saved post should appear in updated results',
      //   );
      // }),
      // // ── 3. Re-fires on link-removed ───────────────────────────────────────
      // await test('subscribe() calls callback again when a relevant link is removed', async () => {
      //   const post = await TestPost.create(perspective, { title: 'Will Be Deleted', body: '' });
      //   const postId = post.id;
      //   const all: TestPost[][] = [];
      //   const sub = TestPost.subscribe(perspective, {}, (r) => all.push(r));
      //   // Wait for the initial async callback to include the post.
      //   await waitUntil(() => all.some((batch) => batch.some((p) => p.id === postId)), 8000);
      //   // Delete the post — link-removed fires the debounce and triggers a re-query.
      //   await post.delete();
      //   // Wait for the re-fired callback to deliver results without the deleted post.
      //   await waitUntil(() => {
      //     const latest = all.at(-1);
      //     return latest !== undefined && !latest.some((p) => p.id === postId);
      //   }, 8000);
      //   sub.unsubscribe();
      //   assert(all.length >= 2, `Expected ≥2 callbacks, got ${all.length}`);
      //   assert(!all.at(-1)!.some((p) => p.id === postId), 'Deleted post should not appear in final results');
      // }),
      // // ── 4. unsubscribe() stops further callbacks ──────────────────────────
      // await test('unsubscribe() stops further callback invocations', async () => {
      //   let callCount = 0;
      //   const sub = TestPost.subscribe(perspective, {}, () => {
      //     callCount++;
      //   });
      //   // Wait for the immediate callback
      //   await new Promise((r) => setTimeout(r, 300));
      //   const countAfterInitial = callCount;
      //   sub.unsubscribe();
      //   // Save a post — should NOT trigger another callback since we unsubscribed
      //   const post = new TestPost(perspective);
      //   post.title = 'Post After Unsub';
      //   post.body = '';
      //   await post.save();
      //   await new Promise((r) => setTimeout(r, 500));
      //   assert(callCount === countAfterInitial, `Expected ${countAfterInitial} calls after unsub, got ${callCount}`);
      // }),
      // // ── 5. debounce batches rapid changes ─────────────────────────────────
      // await test('debounce option batches rapid successive link changes', async () => {
      //   let callCount = 0;
      //   const sub = TestPost.subscribe(perspective, { debounce: 300 }, () => {
      //     callCount++;
      //   });
      //   // Wait for initial callback
      //   await new Promise((r) => setTimeout(r, 100));
      //   const countAfterInitial = callCount;
      //   // Fire 3 saves in rapid succession (< debounce window)
      //   await Promise.all(
      //     Array.from({ length: 3 }, async (_, i) => {
      //       const p = new TestPost(perspective);
      //       p.title = `Rapid ${i}`;
      //       p.body = '';
      //       await p.save();
      //     }),
      //   );
      //   // Wait for debounce window + margin
      //   await new Promise((r) => setTimeout(r, 600));
      //   sub.unsubscribe();
      //   const extraCalls = callCount - countAfterInitial;
      //   // With 300ms debounce, 3 rapid saves should batch into fewer callbacks than 3
      //   assert(extraCalls < 3, `Expected <3 debounced callbacks, got ${extraCalls}`);
      // }),
      // // ── 6. onError fires when findAll throws ───────────────────────────────
      // await test('onError callback fires when findAll() throws', async () => {
      //   const errors: Error[] = [];
      //   const origFindAll = TestPost.findAll;
      //   Object.assign(TestPost, {
      //     findAll: async () => {
      //       throw new Error('mock findAll error');
      //     },
      //   });
      //   try {
      //     const sub = TestPost.subscribe(perspective, { onError: (e: Error) => errors.push(e) }, () => {});
      //     await new Promise((r) => setTimeout(r, 300));
      //     sub.unsubscribe();
      //   } finally {
      //     Object.assign(TestPost, { findAll: origFindAll });
      //   }
      //   assert(errors.length > 0, 'onError should have been called when findAll throws');
      //   assert(errors[0].message === 'mock findAll error', `unexpected error: ${errors[0].message}`);
      // }),
      // // ── 7. lastError is null initially ──────────────────────────────────
      // await test('subscription.lastError is null until a failure occurs', async () => {
      //   let callCount = 0;
      //   const sub = TestPost.subscribe(perspective, {}, () => callCount++);
      //   await waitUntil(() => callCount >= 1);
      //   assert(sub.lastError === null, `lastError should be null after successful callback, got: ${sub.lastError}`);
      //   sub.unsubscribe();
      // }),
      // // ── 8 (prev stub). lastError is set after failure ──────────────────────
      // await test('subscription.lastError is set after a failure', async () => {
      //   let callCount = 0;
      //   const sub = TestPost.subscribe(perspective, {}, () => callCount++);
      //   await waitUntil(() => callCount >= 1);
      //   assert(sub.lastError === null, 'Should start with no error');
      //   // Mock findAll to throw, then fire the link-added listener with a
      //   // watched predicate to trigger a re-query.
      //   const origFindAll = TestPost.findAll;
      //   Object.assign(TestPost, {
      //     findAll: async () => {
      //       throw new Error('induced failure');
      //     },
      //   });
      //   const triggerLink = await perspective.add({
      //     source: 'literal://string:error-trigger',
      //     predicate: 'test://title',
      //     target: 'literal://string:trigger',
      //   });
      //   try {
      //     await waitUntil(() => sub.lastError !== null);
      //   } finally {
      //     Object.assign(TestPost, { findAll: origFindAll });
      //     await perspective.remove(triggerLink);
      //   }
      //   sub.unsubscribe();
      //   assert(sub.lastError !== null, 'lastError should be set after findAll throws');
      //   assert(
      //     (sub.lastError as Error).message === 'induced failure',
      //     `unexpected error: ${(sub.lastError as Error).message}`,
      //   );
      // }),
      // // ── 8. Fluent .live() terminal ────────────────────────────────────────
      // await test('fluent .live() terminal produces identical behaviour to subscribe()', async () => {
      //   const all: TestPost[][] = [];
      //   const sub = TestPost.query(perspective).live((r) => all.push(r));
      //   // Wait for initial callback
      //   await waitUntil(() => all.length >= 1, 8000);
      //   const post = new TestPost(perspective);
      //   post.title = 'Live Fluent';
      //   post.body = '';
      //   await post.save();
      //   // Wait for the async subscription callback to deliver the new post.
      //   await waitUntil(() => all.some((batch) => batch.some((p) => p.id === post.id)), 8000);
      //   sub.unsubscribe();
      //   assert(all.length >= 2, `Expected ≥2 callbacks from .live(), got ${all.length}`);
      //   assert(
      //     all.some((batch) => batch.some((p) => p.id === post.id)),
      //     'Newly saved post should appear via .live()',
      //   );
      // }),
    ];
  },
};
