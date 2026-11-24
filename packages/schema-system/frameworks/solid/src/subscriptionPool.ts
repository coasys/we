/**
 * One live subscription per distinct question, however many nodes are asking it.
 *
 * ## Why the renderer shares them
 *
 * Because a backend pays for every live question separately. A subscription belongs to whoever opened
 * it and is re-run on each change that touches it, so two nodes asking the same thing cost two runs per
 * change for one answer. The workshop asks `{ entity: 'Involvement' }` twice — once for the kanban's
 * faces and once for the inspector's People — and a question asked per card is asked once per card.
 *
 * They were shared first for a worse reason, and the count is what made that safe: a backend that
 * handed identical subscriptions one id with no record of who held it ended the subscription for
 * everyone on the first dispose. Pressing a card re-ran the inspector's query, and the kanban stopped
 * hearing about involvements at all. So identical questions are asked once here, and the subscription
 * is disposed only when nobody is left asking — which is right whichever kind of backend is underneath.
 *
 * ## Keyed by what is asked, never by the object asking
 *
 * Entity name, dataset id, and the question as JSON. The first version keyed on the model object, and
 * shared nothing in the app: the AD4M bindings hand the renderer a fresh wrapper around a model class
 * on every `$getEntity` call, so no two queries — not even one query's own re-runs — ever matched, and
 * the collision above went on silencing the kanban. The tests passed because a mock model is one
 * object.
 *
 * ## One timing rule
 *
 * - **Release waits a grace period.** An effect that re-runs with the same question releases and
 *   re-acquires in one pass, and a panel remounting does so a frame apart; disposing in between sends
 *   the executor a dispose and a subscribe for the same id at once, and whichever it handles second
 *   decides whether the query is live. Held for {@link subscriptionPoolConfig}`.releaseGraceMs`, a
 *   question asked again soon is simply still there.
 */

type Rows = readonly unknown[];

interface Listener {
  onRows: (rows: Rows) => void;
  onError: (err: unknown) => void;
}

/** What the pool needs of a live query: the shape `LiveQuery<Page<row>>` has. */
interface LiveRows {
  first: Promise<unknown>;
  subscribe: (fn: (snapshot: { status: string; data?: { results: unknown[] } }) => void) => () => void;
  dispose: () => void;
}

interface Entry {
  live: LiveRows;
  listeners: Set<Listener>;
  /** The newest rows, for a listener that joins after they arrived. */
  latest: Rows | null;
  error: unknown;
  failed: boolean;
  disposed: boolean;
}

/** How long a subscription nobody holds is kept for somebody to ask again. Tests set it to 0. */
export const subscriptionPoolConfig = { releaseGraceMs: 1500 };

/** Keyed by entity, then by dataset id, then by the question as JSON. Emptied as entries go. */
const pool = new Map<unknown, Map<unknown, Map<string, Entry>>>();

/** Forget every shared subscription without disposing any — for a test's isolation, never the app. */
export function resetSubscriptionPool(): void {
  pool.clear();
}

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
  entry.live.dispose();
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
  entityName = '',
): () => void {
  const listener: Listener = { onRows, onError };
  const key = questionKey(options);
  const at = datasetKey(dataset);
  // The name where there is one — see "Keyed by what is asked". The object, for a caller with no name.
  const kind: unknown = entityName || model;

  let entry = key === null ? undefined : pool.get(kind)?.get(at)?.get(key);
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
      live: model.query(dataset, options) as LiveRows,
      listeners: new Set([listener]),
      latest: null,
      error: undefined,
      failed: false,
      disposed: false,
    };
    entry = created;
    if (key !== null) {
      let byDataset = pool.get(kind);
      if (!byDataset) pool.set(kind, (byDataset = new Map<unknown, Map<string, Entry>>()));
      let byQuestion = byDataset.get(at);
      if (!byQuestion) byDataset.set(at, (byQuestion = new Map<string, Entry>()));
      byQuestion.set(key, created);
    }
    // Called at once when the first rows are in, then on each change — so there is one path for both.
    created.live.subscribe((snapshot) => {
      if (snapshot.status !== 'ready' || !snapshot.data) return;
      created.latest = snapshot.data.results;
      for (const each of [...created.listeners]) {
        try {
          each.onRows(snapshot.data.results);
        } catch (error) {
          console.error('A subscription listener threw', error);
        }
      }
    });
    created.live.first.catch((err: unknown) => {
      created.failed = true;
      created.error = err;
      // A handle disposed before it answered rejects too; nobody is left to hear that.
      for (const each of [...created.listeners]) {
        try {
          each.onError(err);
        } catch (error) {
          console.error('A subscription listener threw', error);
        }
      }
    });
  }

  const held = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.listeners.delete(listener);
    if (held.listeners.size) return;
    const letGo = () => {
      if (held.listeners.size || held.disposed) return;
      if (key !== null) forget(kind, at, key, held);
      dispose(held);
    };
    if (subscriptionPoolConfig.releaseGraceMs > 0) setTimeout(letGo, subscriptionPoolConfig.releaseGraceMs);
    else queueMicrotask(letGo);
  };
}
