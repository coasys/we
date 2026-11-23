/**
 * A live query for a test: it opens on the rows it is given, and `push` is a change after that.
 * The shape is the one `LiveQuery<Page<row>>` has, so a model's `query` can return it as is.
 */
import { createLiveQuery, type LivePage, type LiveQuery } from '@we/backend-shared';

export function liveRows<T = unknown>(initial: T[]): LiveQuery<LivePage<T>> & { push: (rows: T[]) => void } {
  let rows = initial;
  const watchers = new Set<() => void>();
  const live = createLiveQuery<LivePage<T>>({
    read: () => ({ results: rows }),
    watch: (onChange) => {
      watchers.add(onChange);
      return () => void watchers.delete(onChange);
    },
  });
  return {
    ...live,
    push(next: T[]) {
      rows = next;
      for (const fn of [...watchers]) fn();
    },
  };
}

/**
 * A live query held back: it says nothing, and its first result does not arrive, until `gate`
 * settles. `onAsk` runs when something starts listening.
 */
export function heldLive<T>(live: LiveQuery<T>, gate: Promise<unknown>, onAsk?: () => void): LiveQuery<T> {
  let rejectFirst!: (error: Error) => void;
  const first = new Promise<T>((resolve, reject) => {
    rejectFirst = reject;
    void gate.then(() => live.first).then(resolve, reject);
  });
  // Nobody may read it; a rejection must not go unhandled.
  first.catch(() => undefined);
  return {
    ...live,
    first,
    // Disposed while held: the pending first result is rejected, as a real handle's is.
    dispose: () => {
      rejectFirst(new Error('The live query was disposed before it answered'));
      live.dispose();
    },
    subscribe: (fn) => {
      onAsk?.();
      let stop = () => {};
      let gone = false;
      void gate.then(() => {
        if (!gone) stop = live.subscribe(fn);
      });
      return () => {
        gone = true;
        stop();
      };
    },
  };
}
