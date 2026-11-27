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
 * It also leans the other way wherever the port leaves room, so that a store which only works because
 * of an accident of Solid's fails here:
 *
 * - **Sibling effects run out of order.** The effects one update wakes run shuffled, by a seeded
 *   shuffle (or reversed, if asked), and never in the order they were woken: a shuffle that lands
 *   on that order is reversed instead. The seed comes from
 *   `WE_REACTIVITY_SEED` when it is set and is otherwise fixed, so a failure reproduces; the seed is
 *   `TEST_REACTIVITY_SEED`, and a test setup prints it beside a failure.
 * - **An equal write wakes what read it.** Whether it does is not promised, so a store that only
 *   settles because Solid skips an equal write keeps waking itself here, and is refused.
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

/** The seed used when `WE_REACTIVITY_SEED` is not set: any fixed number, so runs agree. */
const DEFAULT_SEED = 20261127;

function seedFromEnvironment(): number {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.WE_REACTIVITY_SEED;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
}

/** The seed every test port shuffles from unless told otherwise. */
export const TEST_REACTIVITY_SEED = seedFromEnvironment();

let portsMade = 0;

/** How many test ports have been made so far, so a test setup can tell whether a test used one. */
export const testPortsMade = (): number => portsMade;

export interface TestReactivityOptions {
  /**
   * The order sibling effects run in: `shuffle` (the default) by a seeded shuffle, `reverse` last
   * woken first, `creation` first woken first — the one order a store must not need.
   */
  order?: 'shuffle' | 'reverse' | 'creation';
  /** The shuffle's seed. Defaults to `TEST_REACTIVITY_SEED`. */
  seed?: number;
  /** Whether writing a value equal to the one held wakes its readers. Defaults to `true`. */
  equalWritesWake?: boolean;
}

/** mulberry32: small, seeded, and the same sequence on every runtime. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isMemo = (source: Source): source is MemoNode => (source as Partial<MemoNode>).kind === 'memo';

/**
 * A fresh, independent port. Each call is its own graph, so one test's leftovers cannot reach the
 * next.
 */
export function createTestReactivity(options: TestReactivityOptions = {}): ReactivityPort {
  const order = options.order ?? 'shuffle';
  const equalWritesWake = options.equalWritesWake ?? true;
  const random = seeded(options.seed ?? TEST_REACTIVITY_SEED);
  portsMade++;
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

  /** The effects one pass runs, in the order this port runs siblings in. */
  function arrange(effects: Computation[]): Computation[] {
    if (order === 'reverse') return effects.reverse();
    if (order === 'shuffle') {
      const woken = [...effects];
      for (let i = effects.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [effects[i], effects[j]] = [effects[j], effects[i]];
      }
      // A shuffle that lands back on the order they were woken in proves nothing: reverse that one.
      if (effects.every((effect, i) => effect === woken[i])) effects.reverse();
    }
    return effects;
  }

  function flush() {
    if (flushing) return;
    flushing = true;
    let runs = 0;
    try {
      // A pass is the effects woken so far, run as siblings; what they wake is the next pass.
      while (queue.size > 0) {
        const pass = arrange([...queue]);
        queue.clear();
        for (const effect of pass) {
          if (effect.disposed) continue;
          if (++runs > RUNAWAY) throw new Error('An effect keeps waking itself: it writes something it reads.');
          if (!effect.ran || changed(effect)) run(effect);
          else effect.stale = false;
        }
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
        if (Object.is(next, node.value) && !equalWritesWake) return;
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
