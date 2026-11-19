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
 * ## Two timing rules
 *
 * - **Release waits a grace period.** An effect that re-runs with the same question releases and
 *   re-acquires in one pass, and a panel remounting does so a frame apart; disposing in between sends
 *   the executor a dispose and a subscribe for the same id at once, and whichever it handles second
 *   decides whether the query is live. Held for {@link subscriptionPoolConfig}`.releaseGraceMs`, a
 *   question asked again soon is simply still there.
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

/** How long a subscription nobody holds is kept for somebody to ask again. Tests set it to 0. */
export const subscriptionPoolConfig = { releaseGraceMs: 1500, lastAnswersLimit: 300 };

/** Keyed by entity, then by dataset id, then by the question as JSON. Emptied as entries go. */
const pool = new Map<unknown, Map<unknown, Map<string, Entry>>>();

/**
 * The last rows a released subscription answered with, kept so the same question asked again —
 * a space returned to after the grace period let its entries go — can draw them at once and then
 * be corrected by the live answer.
 *
 * Insertion order is the eviction order: reading an entry re-queues it, and the oldest goes once
 * the bound is passed. Keyed as the pool is — entity name, dataset id and the question as JSON,
 * joined on NUL, which JSON.stringify escapes so it cannot appear in the question key. Memory
 * only, deliberately: nothing here is persisted.
 */
const lastAnswers = new Map<string, Rows>();

function lastAnswerKey(kind: string, at: string, key: string): string {
  return `${kind}\u0000${at}\u0000${key}`;
}

/** Keep an entry's last answer for the next asker, where the question has a name at all. */
function rememberLastAnswer(kind: unknown, at: unknown, key: string | null, entry: Entry): void {
  // Only string kinds (entity names) and string dataset keys are cached; an object key — a caller
  // with no name, a handle with no uuid — identifies nothing across releases.
  if (key === null || typeof kind !== 'string' || typeof at !== 'string') return;
  if (entry.failed || entry.latest === null) return;
  const id = lastAnswerKey(kind, at, key);
  lastAnswers.delete(id);
  lastAnswers.set(id, entry.latest);
  if (lastAnswers.size > subscriptionPoolConfig.lastAnswersLimit) {
    lastAnswers.delete(lastAnswers.keys().next().value!);
  }
}

/** The kept rows for a question being asked again, re-queued as most recently used. */
function lastAnswerFor(kind: unknown, at: unknown, key: string): Rows | undefined {
  if (typeof kind !== 'string' || typeof at !== 'string') return undefined;
  const id = lastAnswerKey(kind, at, key);
  const rows = lastAnswers.get(id);
  if (rows === undefined) return undefined;
  lastAnswers.delete(id);
  lastAnswers.set(id, rows);
  return rows;
}

/** Forget every kept last answer — a session ending or changing agent, so one user never sees another's rows. */
export function clearLastAnswers(): void {
  lastAnswers.clear();
}

/** Forget every shared subscription without disposing any — for a test's isolation, never the app. */
export function resetSubscriptionPool(): void {
  pool.clear();
  lastAnswers.clear();
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
  entityName = '',
): () => void {
  const listener: Listener = { onRows, onError };
  const key = questionKey(options);
  const at = datasetKey(dataset);
  // The name where there is one — see "Keyed by what is asked". The object, for a caller with no name.
  const kind: unknown = entityName || model;

  let entry = key === null ? undefined : pool.get(kind)?.get(at)?.get(key);
  if (entry?.failed) {
    // A failure already answered is not a subscription to share: whoever asks next retries it —
    // which is how a query that failed on a missing schema recovers once the shape is written.
    if (key !== null) forget(kind, at, key, entry);
    if (!entry.disposed) dispose(entry);
    entry = undefined;
  }
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
      let byDataset = pool.get(kind);
      if (!byDataset) pool.set(kind, (byDataset = new Map<unknown, Map<string, Entry>>()));
      let byQuestion = byDataset.get(at);
      if (!byQuestion) byDataset.set(at, (byQuestion = new Map<string, Entry>()));
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
    if (key !== null) {
      // What this question last answered, shown while the live subscription is still out —
      // asynchronously, as a fresh subscription would answer. A live answer always wins: the kept
      // rows are delivered only while the subscription has said nothing yet.
      const rows = lastAnswerFor(kind, at, key);
      if (rows !== undefined) {
        queueMicrotask(() => {
          if (!created.listeners.has(listener) || created.latest !== null || created.failed) return;
          listener.onRows(rows);
        });
      }
    }
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
      rememberLastAnswer(kind, at, key, held);
      if (key !== null) forget(kind, at, key, held);
      dispose(held);
    };
    if (subscriptionPoolConfig.releaseGraceMs > 0) setTimeout(letGo, subscriptionPoolConfig.releaseGraceMs);
    else queueMicrotask(letGo);
  };
}
