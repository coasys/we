/**
 * A second implementation of the port, small enough to read in one sitting, for tests to run under.
 *
 * A store whose tests pass under Solid and under this is written against the port in fact, not only
 * in its imports. That only proves something if this is a real implementation — dependency tracking,
 * ownership, a write that wakes exactly what read it — and if it differs from Solid where the port
 * leaves room. It does, in one place on purpose: an effect created outside a batch runs straight
 * away, where Solid holds it to the end of the root or update it was created in. A store that reads
 * something an effect has not set yet, because under Solid it always had, fails here.
 *
 * Push-pull, as most signal libraries are: a write marks what depends on it as possibly stale and
 * queues the effects among them, and a memo recomputes only when it is read and one of its sources
 * has actually changed. Versions say which: every source counts its changes, and a computation
 * remembers the count it saw.
 */
import type { Accessor, ReactivityPort, Setter } from '../index';

interface Owner {
  cleanups: (() => void)[];
  children: Computation[];
  disposed: boolean;
}

interface Source {
  version: number;
  observers: Set<Computation>;
}

interface Computation extends Owner {
  kind: 'memo' | 'effect';
  fn: () => unknown;
  sources: Map<Source, number>;
  /** Marked by a write upstream; whether it really changed is decided when it is next read or run. */
  stale: boolean;
  ran: boolean;
}

interface MemoNode extends Computation, Source {
  kind: 'memo';
  value: unknown;
}

/** More passes than any real update needs: past this, an effect is waking itself. */
const RUNAWAY = 100_000;

const isMemo = (source: Source): source is MemoNode => (source as Partial<MemoNode>).kind === 'memo';

/**
 * A fresh, independent port. Each call is its own graph, so one test's leftovers cannot reach the
 * next.
 */
export function createTestReactivity(): ReactivityPort {
  let listener: Computation | null = null;
  let owner: Owner | null = null;
  let batchDepth = 0;
  let flushing = false;
  const queue = new Set<Computation>();

  function track(source: Source) {
    if (!listener || listener.disposed) return;
    listener.sources.set(source, source.version);
    source.observers.add(listener);
  }

  function markStale(node: Computation) {
    if (node.disposed || node.stale) return;
    node.stale = true;
    if (node.kind === 'effect') queue.add(node);
    else for (const observer of (node as MemoNode).observers) markStale(observer);
  }

  /** Whether any source has changed since `node` last read it, bringing memos up to date on the way. */
  function changed(node: Computation): boolean {
    for (const [source, seen] of node.sources) {
      if (isMemo(source)) refresh(source);
      if (source.version !== seen) return true;
    }
    return false;
  }

  function disposeOwned(node: Owner) {
    for (let i = node.children.length - 1; i >= 0; i--) dispose(node.children[i]);
    node.children = [];
    for (let i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = [];
  }

  function unsubscribe(node: Computation) {
    for (const source of node.sources.keys()) source.observers.delete(node);
    node.sources.clear();
  }

  function dispose(node: Computation) {
    if (node.disposed) return;
    disposeOwned(node);
    unsubscribe(node);
    node.disposed = true;
    queue.delete(node);
  }

  function run(node: Computation): unknown {
    disposeOwned(node);
    unsubscribe(node);
    const [prevListener, prevOwner] = [listener, owner];
    listener = node;
    owner = node;
    try {
      return node.fn();
    } finally {
      listener = prevListener;
      owner = prevOwner;
      node.ran = true;
      node.stale = false;
    }
  }

  function refresh(memo: MemoNode) {
    if (memo.disposed) return;
    if (memo.ran && !(memo.stale && changed(memo))) {
      memo.stale = false;
      return;
    }
    const next = run(memo);
    if (!memo.ran || !Object.is(next, memo.value)) {
      memo.value = next;
      memo.version++;
    }
  }

  function flush() {
    if (flushing) return;
    flushing = true;
    let passes = 0;
    try {
      while (queue.size > 0) {
        if (++passes > RUNAWAY) throw new Error('An effect keeps waking itself: it writes something it reads.');
        const [effect] = queue;
        queue.delete(effect);
        if (effect.disposed) continue;
        if (!effect.ran || changed(effect)) run(effect);
        else effect.stale = false;
      }
    } finally {
      flushing = false;
    }
  }

  function adopt(node: Computation) {
    owner?.children.push(node);
  }

  function computation(kind: Computation['kind'], fn: () => unknown): Computation {
    return { kind, fn, sources: new Map(), stale: false, ran: false, cleanups: [], children: [], disposed: false };
  }

  return {
    signal: <T>(initial: T): [Accessor<T>, Setter<T>] => {
      const node: Source & { value: T } = { value: initial, version: 0, observers: new Set() };
      const read = () => {
        track(node);
        return node.value;
      };
      const write = (next: T) => {
        if (Object.is(next, node.value)) return;
        node.value = next;
        node.version++;
        for (const observer of [...node.observers]) markStale(observer);
        if (batchDepth === 0) flush();
      };
      return [read, write];
    },

    memo: <T>(fn: () => T): Accessor<T> => {
      const node = { ...computation('memo', fn), value: undefined, version: 0, observers: new Set() } as MemoNode;
      adopt(node);
      return () => {
        if (node.disposed && !node.ran) {
          // Disposed before anybody read it: answer once, depending on nothing.
          node.value = untrack(fn);
          node.ran = true;
        }
        refresh(node);
        track(node);
        return node.value as T;
      };
    },

    effect: (fn) => {
      const node = computation('effect', fn);
      adopt(node);
      if (batchDepth > 0) {
        queue.add(node);
        return;
      }
      // Its first run is an update like any write: what it writes wakes others after it, not inside it.
      batchDepth++;
      try {
        run(node);
      } finally {
        batchDepth--;
        flush();
      }
    },

    untrack,

    batch: <T>(fn: () => T): T => {
      batchDepth++;
      try {
        return fn();
      } finally {
        batchDepth--;
        if (batchDepth === 0) flush();
      }
    },

    root: (fn) => {
      const node: Owner = { cleanups: [], children: [], disposed: false };
      const [prevListener, prevOwner] = [listener, owner];
      listener = null;
      owner = node;
      try {
        fn();
      } finally {
        listener = prevListener;
        owner = prevOwner;
      }
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

  function untrack<T>(fn: () => T): T {
    const prev = listener;
    listener = null;
    try {
      return fn();
    } finally {
      listener = prev;
    }
  }
}
