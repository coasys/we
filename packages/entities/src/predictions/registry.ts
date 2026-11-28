/**
 * What this agent has asked for and the data has not yet been seen to carry: the writes each
 * invocation of an operation is predicted to make, kept per dataset until the real rows replace them.
 *
 * A host runs an operation twice with one invocation id: once against its own view of the dataset,
 * where every write is recorded instead of made (`speculateOperation`), and once for real. The first
 * run's writes are put here and every read draws them (`overlay.ts`, `live.ts`); the second run's
 * rows, which have the same ids because the ids derive from the invocation, then replace them. So
 * reconciling is exact rather than guessed: a predicted create of `urn:uuid:…` is retired by a row of
 * that id arriving, not by something that looks like it.
 *
 * Plain listeners, no framework: the stores, the renderer's data bindings and the speculative runner
 * all read it, and none of them may depend on how another host does reactivity. One instance per
 * composed store graph — see {@link createPredictions}.
 */
import type { ParentRef } from '@we/backend-shared';
import { DEFAULT_TTL_MS } from '@we/optimism';

import { heldAnswer, type HeldRead, type HeldRow, heldRows } from './held';

/** One write an invocation is predicted to make. */
export type PredictedWrite =
  | {
      kind: 'create';
      entity: string;
      id: string;
      /** The fields given, with the record's own `author` and `createdAt` as the backend will stamp them. */
      fields: Record<string, unknown>;
      parent?: ParentRef;
    }
  | { kind: 'edit'; entity: string; id: string; fields: Record<string, unknown> }
  | { kind: 'delete'; entity: string; id: string }
  | { kind: 'add' | 'remove'; entity: string; id: string; relation: string; target: string }
  | { kind: 'set'; entity: string; id: string; relation: string; targets: readonly string[] };

/** Everything one invocation is predicted to write. */
export interface Prediction {
  invocationId: string;
  writes: readonly PredictedWrite[];
  /**
   * The real run has returned successfully. Until then a read draws the prediction whatever the data
   * says; after, only until the data has been seen to move (`live.ts`), and never in a one-shot read,
   * which by then reads the committed rows themselves.
   */
  landed: boolean;
}

/**
 * One host's predictions: what it has asked for and not yet seen land, per dataset, and the live
 * reads it is showing (`held.ts`), which a speculative run reads first.
 *
 * Made once per composed store graph (`composeStores`), so two compositions — two tests, two hosts
 * in one process — never draw each other's pending writes, and a composition's predictions go with
 * it. Everything that draws or makes one is handed the instance: the host's operation runner, the
 * renderer's data bindings, a store's reads; the entity stand-ins draw the one bound to them
 * (`bindPredictions`).
 */
export interface Predictions {
  /** The predictions drawn in a dataset, oldest first — the order they were made in, which is the order they apply. */
  for(dataset: unknown): readonly Prediction[];
  /** Whether any dataset has a prediction drawn — the cheap test a read makes before it overlays anything. */
  any(): boolean;
  /** Draw what an invocation is predicted to write. A second prediction for the same invocation replaces the first. */
  predict(dataset: unknown, invocationId: string, writes: readonly PredictedWrite[]): void;
  /**
   * The real run returned: the rows it wrote will now arrive, and replace the prediction as they do.
   *
   * Kept a while after, rather than dropped, because the run returning is earlier than the data
   * arriving — dropping now would draw the old answer for the rest of the round trip. The backstop is
   * the same one every held write has (`@we/optimism`'s): a backend that never carries the write back
   * stops being stood in for once it has passed.
   */
  landed(invocationId: string, ttlMs?: number): void;
  /** The real run failed, or the prediction is spent: stop drawing it. */
  withdraw(invocationId: string): void;
  /**
   * Forget every prediction — for a change of subject, such as moving to another space, where what is
   * drawn is a promise about records nothing on screen is showing.
   */
  clear(): void;
  /** Be told when a dataset's predictions change, with the dataset's {@link datasetKey}. Returns a remover. */
  onChange(listener: (dataset: unknown) => void): () => void;
  /** Say what a followed read holds, for as long as it is followed. Returns the remover. See `held.ts`. */
  hold(read: HeldRead): () => void;
  /** A read answered from what this host holds, or undefined when that may not be all of it. See `held.ts`. */
  heldAnswer(entity: string, dataset: unknown, query?: Record<string, unknown>): HeldRow[] | undefined;
  /** Every record of `entity` matching `where` that some held read carries. See `held.ts`. */
  heldRows(entity: string, dataset: unknown, where?: Record<string, unknown>): HeldRow[];
}

/**
 * The key a dataset handle is held under: its `uuid`, else its `id`, else the handle itself.
 *
 * Not the handle alone, because a handle is not always the same object twice — a binding may mint a
 * fresh `{ id }` for each read — and a prediction made against one must be drawn in a read of another.
 */
export function datasetKey(dataset: unknown): unknown {
  if (dataset && typeof dataset === 'object') {
    const { uuid, id } = dataset as { uuid?: unknown; id?: unknown };
    if (typeof uuid === 'string' && uuid) return uuid;
    if (typeof id === 'string' && id) return id;
  }
  return dataset;
}

const NONE: readonly Prediction[] = Object.freeze([]);

/** A fresh set of predictions, with nothing drawn and nothing held. */
export function createPredictions(): Predictions {
  const byDataset = new Map<unknown, Prediction[]>();
  const listeners = new Set<(dataset: unknown) => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const held = new Set<HeldRead>();

  const changed = (key: unknown) => {
    for (const listener of [...listeners]) {
      try {
        listener(key);
      } catch (error) {
        console.error('A prediction listener threw', error);
      }
    }
  };

  const withdraw = (invocationId: string) => {
    clearTimeout(timers.get(invocationId));
    timers.delete(invocationId);
    for (const [key, list] of byDataset) {
      if (!list.some((p) => p.invocationId === invocationId)) continue;
      const next = list.filter((p) => p.invocationId !== invocationId);
      if (next.length) byDataset.set(key, next);
      else byDataset.delete(key);
      changed(key);
      return;
    }
  };

  return {
    for: (dataset) => byDataset.get(datasetKey(dataset)) ?? NONE,
    any: () => byDataset.size > 0,
    predict(dataset, invocationId, writes) {
      if (!writes.length) return;
      const key = datasetKey(dataset);
      const list = (byDataset.get(key) ?? []).filter((p) => p.invocationId !== invocationId);
      byDataset.set(key, [...list, { invocationId, writes, landed: false }]);
      changed(key);
    },
    landed(invocationId, ttlMs = DEFAULT_TTL_MS) {
      for (const [key, list] of byDataset) {
        const index = list.findIndex((p) => p.invocationId === invocationId);
        if (index < 0) continue;
        const next = [...list];
        next[index] = { ...list[index], landed: true };
        byDataset.set(key, next);
        clearTimeout(timers.get(invocationId));
        timers.set(
          invocationId,
          setTimeout(() => withdraw(invocationId), ttlMs),
        );
        changed(key);
        return;
      }
    },
    withdraw,
    clear() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      const keys = [...byDataset.keys()];
      byDataset.clear();
      for (const key of keys) changed(key);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    hold(read) {
      held.add(read);
      return () => void held.delete(read);
    },
    heldAnswer: (entity, dataset, query) => heldAnswer(held, entity, dataset, query),
    heldRows: (entity, dataset, where) => heldRows(held, entity, dataset, where),
  };
}

const BOUND_KEY = Symbol.for('we.entities.boundPredictions');
type Bound = { current: Predictions | null };
// On the global object, as the entity registry is: the stand-ins and whoever binds them may be two
// copies of this package in one page.
const bound: Bound = ((globalThis as unknown as Record<symbol, Bound>)[BOUND_KEY] ??= { current: null });

/**
 * The predictions the entity stand-ins draw — `Space.findAll(…)` through `@we/entities` — or null,
 * when no composition has bound any and the stand-ins read the backend's rows as they are.
 */
export function boundPredictions(): Predictions | null {
  return bound.current;
}

/**
 * Bind `predictions` to the entity stand-ins, for as long as the composition that made them lasts.
 * Returns the unbinding, which puts back whatever was bound before.
 *
 * The stand-ins are the page's, as the entity registry they resolve through is: whichever backend
 * connected last registered the classes they forward to. So they draw one composition's predictions
 * at a time — the one living in this page. Everything else that draws predictions (the operation
 * runner, the renderer's bindings, a speculative run's reads) is handed its composition's instance.
 */
export function bindPredictions(predictions: Predictions): () => void {
  const previous = bound.current;
  bound.current = predictions;
  return () => {
    if (bound.current === predictions) bound.current = previous;
  };
}
