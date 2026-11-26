/**
 * The live query: one handle that opens on a result and follows it.
 *
 * The shape is the one AD4M's `LiveQuery` has, written here without importing it, so the renderer and
 * every backend agree on it and the contract stays free of `@coasys/*`. A backend that has its own
 * live query passes it through; one that has not (the in-memory backend, a fan-out over several
 * entities) builds one with {@link createLiveQuery} or {@link combineLiveQueries}, which behave the
 * same way.
 */

/** A page of rows. `totalCount` is set only when the query asked for a count. */
export interface Page<T> {
  results: T[];
  totalCount?: number;
}

/** What a live query holds at one moment. */
export interface Snapshot<T> {
  /** `loading` until the first result, `ready` after it, `error` when the first open failed. */
  status: 'loading' | 'ready' | 'error';
  /** The latest result; set while `status` is `ready`. */
  data?: T;
  /** Why the first open failed; set while `status` is `error`. */
  error?: Error;
  /** `true` only for the value the handle opened on. */
  initial: boolean;
}

/**
 * One live question. The snapshot object changes only when the result or the status changes. Call `dispose()` when done.
 */
export interface LiveQuery<T> {
  /** The first result. Rejects when opening fails, or when the handle is disposed first. */
  readonly first: Promise<T>;
  /** The current snapshot: the same object until something in it changes. */
  readonly getSnapshot: () => Snapshot<T>;
  /**
   * Call `fn` with the current snapshot at once when the query is no longer loading, then on each
   * change. Returns a remover. A disposed handle calls nobody. Bound, so it can be handed on as is.
   */
  readonly subscribe: (fn: (snapshot: Snapshot<T>) => void) => () => void;
  /** Stop following. Drops every listener; a first result still awaited is rejected. */
  readonly dispose: () => void;
}

/** A JSON text with the keys of every object in sorted order, so two equal results compare equal. */
function canonical(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_key, v: unknown) => {
      // JSON.stringify would write a Map or a Set as `{}`, so two different ones would read as equal: their contents are written instead.
      if (v instanceof Map) return ['Map', [...v.entries()]];
      if (v instanceof Set) return ['Set', [...v.values()]];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      }
      return v;
    });
  } catch {
    return undefined;
  }
}

const asError = (reason: unknown): Error => (reason instanceof Error ? reason : new Error(String(reason)));

/** The state machine both builders share: a snapshot, its listeners, and the first result. */
function createStore<T>(onDispose: () => void) {
  let snapshot: Snapshot<T> = { status: 'loading', initial: false };
  let lastText: string | undefined;
  let disposed = false;
  const listeners = new Set<(snapshot: Snapshot<T>) => void>();
  let resolveFirst!: (data: T) => void;
  let rejectFirst!: (error: Error) => void;
  const first = new Promise<T>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  // The caller may never read `first`; a failure must not become an unhandled rejection.
  first.catch(() => undefined);

  // A listener that throws must not stop the others, nor the store: report it and go on.
  const call = (fn: (snapshot: Snapshot<T>) => void, next: Snapshot<T>) => {
    try {
      fn(next);
    } catch (error) {
      console.error('A live query listener threw', error);
    }
  };

  // A listener may dispose the handle or remove another listener; neither runs after that.
  const publish = (next: Snapshot<T>) => {
    snapshot = next;
    for (const fn of [...listeners]) {
      if (disposed) return;
      if (listeners.has(fn)) call(fn, next);
    }
  };

  const live: LiveQuery<T> = {
    first,
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      if (disposed) return () => undefined;
      listeners.add(fn);
      if (snapshot.status !== 'loading') call(fn, snapshot);
      return () => void listeners.delete(fn);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      onDispose();
      if (snapshot.status === 'loading') rejectFirst(new Error('The live query was disposed before it answered'));
    },
  };

  return {
    live,
    /** Offer a result. The first one opens the handle; a later one counts only if it differs. */
    offer(data: T) {
      if (disposed) return;
      const text = canonical(data);
      if (snapshot.status === 'ready' && text !== undefined && text === lastText) return;
      const opening = snapshot.status === 'loading';
      lastText = text;
      if (opening) resolveFirst(data);
      publish({ status: 'ready', data, initial: opening });
    },
    /** The first open failed. */
    fail(reason: unknown) {
      if (disposed || snapshot.status !== 'loading') return;
      const error = asError(reason);
      rejectFirst(error);
      publish({ status: 'error', error, initial: false });
      live.dispose();
    },
    get disposed() {
      return disposed;
    },
  };
}

/**
 * A live query over a source that can be read and can say when it may have changed.
 *
 * The read runs once to open the handle, then again on each change; a result equal to the last (keys
 * compared in sorted order) makes no new snapshot. Reads run one at a time: a change heard while a
 * read runs, the opening one included, starts one more read after it, so the newest state always
 * lands last. A read that fails before the first result fails the handle; one that fails after it is
 * skipped, and the last result stays.
 */
export function createLiveQuery<T>(source: {
  read: () => T | Promise<T>;
  watch: (onChange: () => void) => () => void;
}): LiveQuery<T> {
  let stop: (() => void) | undefined;
  const store = createStore<T>(() => stop?.());

  let reading = false;
  let changed = false;
  const refresh = async () => {
    changed = true;
    if (reading) return;
    reading = true;
    while (changed && !store.disposed) {
      changed = false;
      try {
        store.offer(await source.read());
      } catch (error) {
        store.fail(error);
      }
    }
    reading = false;
  };

  try {
    stop = source.watch(() => void refresh());
  } catch (error) {
    // A source that cannot be watched cannot open the handle: it fails, as a read that fails does.
    store.fail(error);
    return store.live;
  }
  if (store.disposed) stop();
  queueMicrotask(() => void refresh());
  return store.live;
}

/**
 * One live query made of several. It opens when every part has opened, then follows any of them; a
 * part that fails to open fails it. `combine` receives the parts' data in the order they were given;
 * with no parts it opens on `combine([])`. A `combine` that throws before the first result fails the
 * handle; later a throw skips that result.
 */
export function combineLiveQueries<S, T>(parts: readonly LiveQuery<S>[], combine: (data: S[]) => T): LiveQuery<T> {
  const stops: (() => void)[] = [];
  const store = createStore<T>(() => {
    for (const stop of stops) stop();
    for (const part of parts) part.dispose();
  });
  const latest: (S | undefined)[] = parts.map(() => undefined);
  const ready = parts.map(() => false);
  const offerCombined = () => {
    try {
      store.offer(combine([...latest] as S[]));
    } catch (error) {
      store.fail(error);
    }
  };
  if (parts.length === 0) queueMicrotask(offerCombined);

  parts.forEach((part, i) => {
    stops.push(
      part.subscribe((snapshot) => {
        if (snapshot.status !== 'ready') return;
        latest[i] = snapshot.data;
        ready[i] = true;
        if (ready.every(Boolean)) offerCombined();
      }),
    );
    part.first.catch((error: unknown) => store.fail(error));
  });
  return store.live;
}

/**
 * A live query whose results are passed through `map` before anyone sees them. Each result is mapped
 * in the order it arrived, so a slow map of an older result can never be delivered after a newer one.
 * `map` may be async. If it throws before the first result the handle fails; later a throw skips that
 * result. Disposing the mapped handle disposes `live`.
 */
export function mapLiveQuery<S, T>(live: LiveQuery<S>, map: (data: S) => T | Promise<T>): LiveQuery<T> {
  let stop: (() => void) | undefined;
  const store = createStore<T>(() => {
    stop?.();
    live.dispose();
  });
  let chain: Promise<void> = Promise.resolve();
  stop = live.subscribe((snapshot) => {
    if (snapshot.status !== 'ready') return;
    const data = snapshot.data as S;
    chain = chain.then(async () => {
      // Disposed while this result waited its turn: do not start the map.
      if (store.disposed) return;
      try {
        store.offer(await map(data));
      } catch (error) {
        store.fail(error);
      }
    });
  });
  live.first.catch((error: unknown) => store.fail(error));
  return store.live;
}
