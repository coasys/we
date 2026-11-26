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
 * all read it, and none of them may depend on how another host does reactivity.
 */
import type { ParentRef } from '@we/backend-shared';
import { DEFAULT_TTL_MS } from '@we/optimism';

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

interface Registry {
  byDataset: Map<unknown, Prediction[]>;
  listeners: Set<(dataset: unknown) => void>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
}

const REGISTRY_KEY = Symbol.for('we.entities.predictions');
// On the global object, as the entity registry is: two copies of this package in one page must
// draw the same predictions, or a store and the renderer would disagree about what is pending.
const registry: Registry = ((globalThis as unknown as Record<symbol, Registry>)[REGISTRY_KEY] ??= {
  byDataset: new Map(),
  listeners: new Set(),
  timers: new Map(),
});

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

const changed = (key: unknown) => {
  for (const listener of [...registry.listeners]) {
    try {
      listener(key);
    } catch (error) {
      console.error('A prediction listener threw', error);
    }
  }
};

/** The predictions drawn in a dataset, oldest first — the order they were made in, which is the order they apply. */
export function predictionsFor(dataset: unknown): readonly Prediction[] {
  return registry.byDataset.get(datasetKey(dataset)) ?? [];
}

/** Whether any dataset has a prediction drawn — the cheap test a read makes before it overlays anything. */
export function anyPredictions(): boolean {
  return registry.byDataset.size > 0;
}

/** Draw what an invocation is predicted to write. A second prediction for the same invocation replaces the first. */
export function predict(dataset: unknown, invocationId: string, writes: readonly PredictedWrite[]): void {
  if (!writes.length) return;
  const key = datasetKey(dataset);
  const list = (registry.byDataset.get(key) ?? []).filter((p) => p.invocationId !== invocationId);
  registry.byDataset.set(key, [...list, { invocationId, writes, landed: false }]);
  changed(key);
}

/**
 * The real run returned: the rows it wrote will now arrive, and replace the prediction as they do.
 *
 * Kept a while after, rather than dropped, because the run returning is earlier than the data
 * arriving — dropping now would draw the old answer for the rest of the round trip. The backstop is
 * the same one every held write has (`@we/optimism`'s): a backend that never carries the write back
 * stops being stood in for once it has passed.
 */
export function predictionLanded(invocationId: string, ttlMs = DEFAULT_TTL_MS): void {
  for (const [key, list] of registry.byDataset) {
    const index = list.findIndex((p) => p.invocationId === invocationId);
    if (index < 0) continue;
    const next = [...list];
    next[index] = { ...list[index], landed: true };
    registry.byDataset.set(key, next);
    clearTimeout(registry.timers.get(invocationId));
    registry.timers.set(
      invocationId,
      setTimeout(() => withdrawPrediction(invocationId), ttlMs),
    );
    changed(key);
    return;
  }
}

/** The real run failed, or the prediction is spent: stop drawing it. */
export function withdrawPrediction(invocationId: string): void {
  clearTimeout(registry.timers.get(invocationId));
  registry.timers.delete(invocationId);
  for (const [key, list] of registry.byDataset) {
    if (!list.some((p) => p.invocationId === invocationId)) continue;
    const next = list.filter((p) => p.invocationId !== invocationId);
    if (next.length) registry.byDataset.set(key, next);
    else registry.byDataset.delete(key);
    changed(key);
    return;
  }
}

/**
 * Forget every prediction — for a change of subject, such as moving to another space, where what is
 * drawn is a promise about records nothing on screen is showing.
 */
export function clearPredictions(): void {
  for (const timer of registry.timers.values()) clearTimeout(timer);
  registry.timers.clear();
  const keys = [...registry.byDataset.keys()];
  registry.byDataset.clear();
  for (const key of keys) changed(key);
}

/** Be told when a dataset's predictions change, with the dataset's {@link datasetKey}. Returns a remover. */
export function onPredictionsChange(listener: (dataset: unknown) => void): () => void {
  registry.listeners.add(listener);
  return () => void registry.listeners.delete(listener);
}
