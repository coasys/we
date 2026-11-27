/**
 * The reactivity port over `@vue/reactivity`: a third engine, written by somebody else, for the store
 * tests to run under beside Solid and the test port.
 *
 * Vue does the dependency tracking — `shallowRef` is a signal, `computed` a memo, `effect` an effect —
 * and this file adds the two things the port asks for that Vue's reactivity leaves to its renderer:
 *
 * - **Ownership.** Vue's effects own nothing: an effect made inside another is not stopped when the
 *   outer one re-runs, and `effectScope` is not entered by a running effect. The port's `root`
 *   owns what is made inside it, and an effect or memo owns what it makes on each run, so an owner
 *   tree is kept here, the way a framework built on Vue keeps its component instances.
 * - **When effects run.** Left alone, Vue runs a woken effect inside the write that woke it, which is
 *   in the middle of whatever effect made the write. The port says an effect runs after the update
 *   that woke it. So every effect is scheduled: Vue says it is dirty, this queues it, and the queue
 *   is run once the outermost write, batch or effect run is over — what Vue's own renderer does with
 *   its job queue.
 *
 * Effects run in the order Vue reports them dirty, equal writes are skipped (`shallowRef`
 * compares), and an effect made outside a batch runs straight away. None of that is promised by the
 * port, so a store passing here and under the other two leans on none of it.
 */
import { computed, pauseTracking, ReactiveEffect, resetTracking, shallowRef } from '@vue/reactivity';
import type { Accessor, ReactivityPort, Setter } from '@we/reactivity';

interface Owner {
  cleanups: (() => void)[];
  children: (() => void)[];
  disposed: boolean;
}

const RUNAWAY = 100_000;

/** A fresh port over Vue's reactivity. Vue's graph is global, so ports share it; their queues do not. */
export function createVueReactivity(): ReactivityPort {
  let owner: Owner | null = null;
  let depth = 0;
  let flushing = false;
  const queue = new Set<{ effect: ReactiveEffect; node: Owner; ran: boolean }>();

  const newOwner = (): Owner => ({ cleanups: [], children: [], disposed: false });

  function disposeOwned(node: Owner) {
    for (let i = node.children.length - 1; i >= 0; i--) node.children[i]();
    node.children = [];
    for (let i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = [];
  }

  function within<T>(node: Owner, fn: () => T): T {
    const prev = owner;
    owner = node;
    try {
      return fn();
    } finally {
      owner = prev;
    }
  }

  function untrack<T>(fn: () => T): T {
    pauseTracking();
    try {
      return fn();
    } finally {
      resetTracking();
    }
  }

  function flush() {
    if (flushing || depth > 0) return;
    flushing = true;
    let runs = 0;
    try {
      while (queue.size > 0) {
        const [job] = queue;
        queue.delete(job);
        if (job.node.disposed) continue;
        if (++runs > RUNAWAY) throw new Error('An effect keeps waking itself: it writes something it reads.');
        if (!job.ran || job.effect.dirty) {
          job.ran = true;
          job.effect.run();
        }
      }
    } finally {
      flushing = false;
    }
  }

  /** One update: what it wakes runs when it, and every update around it, is over. */
  function update<T>(fn: () => T): T {
    depth++;
    try {
      return fn();
    } finally {
      depth--;
      flush();
    }
  }

  return {
    signal: <T>(initial: T): [Accessor<T>, Setter<T>] => {
      const ref = shallowRef(initial);
      return [() => ref.value as T, (next: T) => update(() => void (ref.value = next))];
    },

    memo: <T>(fn: () => T): Accessor<T> => {
      const node = newOwner();
      let last: { value: T } | null = null;
      const value = computed(() => {
        disposeOwned(node);
        const next = within(node, fn);
        last = { value: next };
        return next;
      });
      owner?.children.push(() => {
        node.disposed = true;
        disposeOwned(node);
      });
      return () => {
        if (!node.disposed) return value.value;
        // A disposed memo keeps what it last held; one never read answers once, depending on nothing.
        if (!last) last = { value: untrack(fn) };
        return last.value;
      };
    },

    effect: (fn) => {
      const node = newOwner();
      const effect = new ReactiveEffect(() => {
        disposeOwned(node);
        within(node, fn);
      });
      effect.scheduler = () => {
        queue.add(job);
        flush();
      };
      const job = { effect, node, ran: false };
      owner?.children.push(() => {
        node.disposed = true;
        effect.stop();
        disposeOwned(node);
        queue.delete(job);
      });
      if (depth > 0 || flushing) {
        queue.add(job);
        return;
      }
      update(() => {
        job.ran = true;
        effect.run();
      });
    },

    untrack,

    batch: <T>(fn: () => T): T => update(fn),

    root: (fn) => {
      const node = newOwner();
      untrack(() => within(node, fn));
      return () => {
        if (node.disposed) return;
        node.disposed = true;
        disposeOwned(node);
      };
    },

    onCleanup: (fn) => {
      owner?.cleanups.push(fn);
    },
  };
}
