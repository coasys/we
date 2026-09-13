/**
 * One live subscription per distinct question, however many nodes are asking it.
 *
 * ## Why the renderer shares them
 *
 * The AD4M executor already shares them — and that is the problem. Two model subscriptions with the
 * same class and the same query JSON are handed the *same* subscription id, with no count of how many
 * callers hold it, so the first caller to dispose ends it for everyone. Its client keeps one listener
 * per id as well, so the second caller's registration replaces the first's.
 *
 * The workshop asks `{ entity: 'Involvement' }` twice: once for the kanban's faces and once for the
 * inspector's People. Pressing a card re-runs the inspector's query, which disposed the shared
 * subscription — and the kanban stopped hearing about involvements at all. Marking yourself as
 * reviewing showed for as long as the optimistic hold lasted and then vanished until the page was
 * rebuilt.
 *
 * So identical questions are asked once here, and the subscription is disposed only when nobody is
 * left asking. Keeping the count on this side is the fix that does not wait on the executor; the
 * executor counting its own holders is the fix that covers callers outside the renderer.
 *
 * ## Two timing rules
 *
 * - **Release is deferred a microtask.** An effect that re-runs with the same question releases and
 *   re-acquires in one synchronous pass; disposing in between would send the executor a dispose and a
 *   subscribe for the same id at once, and whichever it handles second decides whether the query is
 *   live.
 * - **A dispose before the answer is repeated after it.** `ModelQueryBuilder.subscribe` only records
 *   what to dispose once its first round trip returns, so a dispose issued before then does nothing
 *   and the subscription outlives everyone who asked for it.
 */

type Rows = readonly unknown[];

interface Listener {
  onRows: (rows: Rows) => void;
  onError: (err: unknown) => void;
}

interface SubscribingBuilder {
  subscribe: (cb: (results: unknown[]) => void) => Promise<unknown[]>;
  dispose: () => void;
}

interface Entry {
  builder: SubscribingBuilder;
  listeners: Set<Listener>;
  /** The newest rows, for a listener that joins after they arrived. */
  latest: Rows | null;
  error: unknown;
  failed: boolean;
  settled: boolean;
  disposed: boolean;
}

/** Keyed by model, then by dataset handle, then by the question as JSON. Emptied as entries go. */
const pool = new Map<unknown, Map<unknown, Map<string, Entry>>>();

/** A dataset by its id where it has one — a handle may be rebuilt for the same dataset between reads. */
function datasetKey(dataset: unknown): unknown {
  const uuid = (dataset as { uuid?: unknown } | null | undefined)?.uuid;
  return typeof uuid === 'string' ? uuid : dataset;
}

function questionKey(options: Record<string, unknown>): string | null {
  try {
    return JSON.stringify(options);
  } catch {
    return null;
  }
}

function forget(model: unknown, dataset: unknown, key: string, entry: Entry): void {
  const byDataset = pool.get(model);
  const byQuestion = byDataset?.get(dataset);
  if (byQuestion?.get(key) !== entry) return;
  byQuestion.delete(key);
  if (!byQuestion.size) byDataset!.delete(dataset);
  if (!byDataset!.size) pool.delete(model);
}

function dispose(entry: Entry): void {
  entry.disposed = true;
  entry.builder.dispose();
}

/**
 * Listen to a model query, sharing the subscription with every other listener asking the same thing.
 * Returns the release; call it from the owner's cleanup.
 */
export function acquireSubscription(
  model: { query: (dataset: unknown, options: Record<string, unknown>) => unknown },
  dataset: unknown,
  options: Record<string, unknown>,
  onRows: (rows: Rows) => void,
  onError: (err: unknown) => void,
): () => void {
  const listener: Listener = { onRows, onError };
  const key = questionKey(options);
  const at = datasetKey(dataset);

  let entry = key === null ? undefined : pool.get(model)?.get(at)?.get(key);
  if (entry && !entry.disposed) {
    entry.listeners.add(listener);
    const joined = entry;
    // Asynchronously, as a fresh subscription would answer — never inside the caller's own effect.
    queueMicrotask(() => {
      if (!joined.listeners.has(listener)) return;
      if (joined.failed) listener.onError(joined.error);
      else if (joined.latest) listener.onRows(joined.latest);
    });
  } else {
    const created: Entry = {
      builder: model.query(dataset, options) as SubscribingBuilder,
      listeners: new Set([listener]),
      latest: null,
      error: undefined,
      failed: false,
      settled: false,
      disposed: false,
    };
    entry = created;
    if (key !== null) {
      let byDataset = pool.get(model);
      if (!byDataset) pool.set(model, (byDataset = new Map()));
      let byQuestion = byDataset.get(at);
      if (!byQuestion) byDataset.set(at, (byQuestion = new Map()));
      byQuestion.set(key, created);
    }
    let pushed = false;
    created.builder
      .subscribe((results) => {
        pushed = true;
        created.latest = results;
        for (const each of [...created.listeners]) each.onRows(results);
      })
      .then((initial) => {
        created.settled = true;
        // Issued before there was anything to dispose — see the module comment.
        if (created.disposed) {
          created.builder.dispose();
          return;
        }
        // An update that arrived first is newer than the initial answer.
        if (pushed) return;
        created.latest = initial;
        for (const each of [...created.listeners]) each.onRows(initial);
      })
      .catch((err: unknown) => {
        created.settled = true;
        created.failed = true;
        created.error = err;
        for (const each of [...created.listeners]) each.onError(err);
      });
  }

  const held = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.listeners.delete(listener);
    if (held.listeners.size) return;
    queueMicrotask(() => {
      if (held.listeners.size || held.disposed) return;
      if (key !== null) forget(model, at, key, held);
      dispose(held);
    });
  };
}
