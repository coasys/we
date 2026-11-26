/**
 * Reads with this agent's predictions in them: a live query's pages, and one-shot finds.
 *
 * Wrapped at the entity — the class a store reaches through `@we/entities`' proxies, and the class
 * the renderer's data bindings hand a `$query` — so every surface that reads records sees the same
 * pending writes, and none of them knows there are any.
 *
 * ## When a live read stops drawing a prediction
 *
 * The lifecycle is `@we/optimism`'s, applied per read and per invocation, with the value held being
 * what the read says about the records the invocation writes (`predictionFingerprint`):
 *
 * - while the real run is going, the prediction is drawn whatever the data says (rule 4);
 * - once it has returned, the read's next page is the baseline (rule 3), and the prediction is
 *   dropped the moment the data says what it predicted — the real rows have arrived, with the same
 *   ids — or says something else than the baseline did: somebody else's write landed and the real
 *   rows win over the prediction (rule 2);
 * - a failure withdraws it everywhere at once, and a backstop retires one nothing ever answers.
 *
 * Judged per read, because a read is the only evidence there is: one subscription carrying the
 * write back says nothing about another that has not yet. Each prediction is judged against the data
 * with the predictions made before it laid over, so on, off and on again — three invocations on one
 * record — retire one by one as their rows arrive, and the control never shows an older answer.
 *
 * One-shot reads (`findAll`, `findOne`) draw only predictions still running: by the time a run has
 * returned, a read made afterwards is answered from the committed rows themselves.
 */
import type { LivePage, LiveQuery } from '@we/backend-shared';
import { DEFAULT_TTL_MS, done, hold, type Holds, reconcile } from '@we/optimism';

import { applyPrediction, predictionFingerprint, type ReadShape, readShapeOf } from './overlay';
import { anyPredictions, datasetKey, onPredictionsChange, type Prediction, predictionsFor } from './registry';

const RULES = { same: (a: string, b: string) => a === b, ttlMs: DEFAULT_TTL_MS };

/**
 * A live query with the dataset's predictions laid over its pages.
 *
 * The wrapped handle opens when the underlying one does and fails when it fails; disposing this one
 * disposes it.
 */
export function withPredictedPages<T>(
  live: LiveQuery<LivePage<T>>,
  dataset: unknown,
  shape: ReadShape,
): LiveQuery<LivePage<T>> {
  const key = datasetKey(dataset);
  let holds: Holds<string> = {};
  const retired = new Set<string>();
  let backstop: ReturnType<typeof setTimeout> | undefined;

  const overlay = (page: LivePage<T>, wake: () => void): LivePage<T> => {
    const predictions = predictionsFor(dataset);
    if (!predictions.length) {
      holds = {};
      return page;
    }
    let current = page.results;
    const present = new Set<string>();
    for (const prediction of predictions) {
      const id = prediction.invocationId;
      present.add(id);
      if (retired.has(id)) continue;
      const before = predictionFingerprint(current, prediction);
      const next = applyPrediction(current, shape, prediction);
      const after = predictionFingerprint(next, prediction);
      if (!holds[id]) {
        // Says nothing about what this read shows — yet. It may later, once its records come into view.
        if (before === after) continue;
        holds = hold(holds, id, after);
      } else holds = { ...holds, [id]: { ...holds[id], value: after } };
      if (prediction.landed && holds[id].writing > 0) holds = done(holds, id);
      const judged = reconcile({ [id]: holds[id] }, () => before, RULES);
      if (!judged[id]) {
        const { [id]: _gone, ...rest } = holds;
        holds = rest;
        retired.add(id);
        continue;
      }
      holds = { ...holds, [id]: judged[id] };
      current = next;
    }
    for (const id of Object.keys(holds)) if (!present.has(id)) delete holds[id];
    for (const id of retired) if (!present.has(id)) retired.delete(id);
    // Something is held: read again once the backstop could have retired it, so it does.
    clearTimeout(backstop);
    if (Object.keys(holds).length) backstop = setTimeout(wake, RULES.ttlMs + 50);
    return current === page.results ? page : { ...page, results: current };
  };

  /*
    The wrapped handle passes the underlying snapshots through as they are while nothing is pending,
    so a read nobody predicted anything for costs one test per page. A snapshot is made again only
    when the page or the predictions change, so it stays the same object in between, as the contract
    asks.
  */
  type Snap = ReturnType<LiveQuery<LivePage<T>>['getSnapshot']>;
  let version = 0;
  let made: { from: Snap; version: number; snapshot: Snap } | undefined;
  const snapshotOf = (from: Snap): Snap => {
    if (from.status !== 'ready' || !from.data) return from;
    if (made && made.from === from && made.version === version) return made.snapshot;
    const data = overlay(from.data, wake);
    const snapshot = data === from.data ? from : { ...from, data };
    made = { from, version, snapshot };
    return snapshot;
  };
  const listeners = new Set<(snapshot: Snap) => void>();
  let last: Snap | undefined;
  const publish = () => {
    const next = snapshotOf(live.getSnapshot());
    if (next === last && next.status === 'ready') return;
    last = next;
    for (const fn of [...listeners]) fn(next);
  };
  function wake() {
    version++;
    publish();
  }
  let disposed = false;
  const stopPages = live.subscribe(() => publish());
  const stopPredictions = onPredictionsChange((changed) => {
    if (changed === key) wake();
  });

  return {
    first: live.first.then((page) => snapshotOf(live.getSnapshot()).data ?? page),
    getSnapshot: () => snapshotOf(live.getSnapshot()),
    subscribe: (fn) => {
      if (disposed) return () => undefined;
      listeners.add(fn);
      const now = snapshotOf(live.getSnapshot());
      if (now.status !== 'loading') fn(now);
      return () => void listeners.delete(fn);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      stopPages();
      stopPredictions();
      clearTimeout(backstop);
      live.dispose();
    },
  };
}

/** Rows a one-shot read answered with, with the predictions still running laid over them. */
export function withPredictedRows<T>(rows: readonly T[], dataset: unknown, shape: ReadShape): T[] {
  const running = predictionsFor(dataset).filter((prediction: Prediction) => !prediction.landed);
  let current = rows as T[];
  for (const prediction of running) current = applyPrediction(current, shape, prediction);
  return current;
}

type Reader = Record<string, unknown>;

const READS = new Set(['query', 'findAll', 'findOne']);

/**
 * An entity's reads with predictions in them, everything else its own: a proxy over the class, so a
 * static that is not a read — a create, an update, a relation write — reaches the class untouched.
 *
 * `entities` is what the reads are of: the class's own name, or the names a combined read spans.
 */
export function withPredictions<C extends object>(cls: C, entities: readonly string[] | null): C {
  const wrapped = new Map<PropertyKey, unknown>();
  return new Proxy(cls, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function' || !READS.has(prop as string)) return value;
      const cached = wrapped.get(prop);
      if (cached) return cached;
      const read = value as (this: unknown, ...args: unknown[]) => unknown;
      const fn = function (this: unknown, dataset: unknown, query?: unknown, ...rest: unknown[]) {
        const answer = read.call(this ?? target, dataset, query, ...rest);
        const shape = () => readShapeOf(entities, query);
        if (prop === 'query') return withPredictedPages(answer as LiveQuery<LivePage<unknown>>, dataset, shape());
        // Nothing pending anywhere is the usual case, and costs one test.
        if (!anyPredictions()) return answer;
        return Promise.resolve(answer).then((found) => {
          if (prop === 'findAll') return withPredictedRows((found ?? []) as Reader[], dataset, shape());
          const rows = withPredictedRows(found ? [found as Reader] : [], dataset, { ...shape(), limit: 1 });
          return rows[0] ?? null;
        });
      };
      wrapped.set(prop, fn);
      return fn;
    },
  });
}
