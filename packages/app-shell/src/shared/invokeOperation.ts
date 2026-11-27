/**
 * The host's one way to run a declared operation: drawn before it lands, queued where it says, and
 * said when it fails. Templates (`ops.*`), stores and modules all come through here.
 *
 * ## Drawn before it lands
 *
 * One invocation id and time, minted here, serve two runs. The first is speculative
 * (`speculateOperation`): the same runner over the dataset as this host sees it — the committed rows
 * with this agent's pending predictions over them — recording every write instead of making it. The
 * writes go into the predictions every read draws (`@we/entities`' `predictions/`), so a pressed
 * reaction fills and a dropped card sits in its new column on every surface at once. The second run
 * is the real one, with the same id, so the records it makes have the ids the prediction drew, and
 * its rows replace the prediction exactly as they arrive. A real run that fails withdraws the
 * prediction; a speculation that fails draws nothing, so a write that will be refused is never shown
 * as having worked.
 *
 * The queues, the speculations and the predictions are one composition's (`createOperations`, made
 * once by `composeStores`), never the module's, so two compositions — two tests, or two hosts in one
 * process — neither wait on each other nor draw each other's writes.
 *
 * Speculations run one after another per dataset, so each reads the predictions of the ones before
 * it: a second press, made before the first has landed, is predicted from the first one's answer.
 * Their reads are answered from the rows the host's live reads hold where those are enough
 * (`@we/entities`' `predictions/held.ts`), so a gesture on something on screen is drawn without
 * waiting on the backend at all.
 *
 * ## Queued where it says
 *
 * An operation that reads before it writes declares a `serial` key, and invocations with the same
 * key in the same dataset run one after another (see `serialKey`). Two presses of one reaction both
 * reading before either wrote is how one person came to be listed twice under one type.
 *
 * ## Said when it fails
 *
 * With `notify`, a failure reaches the person once, as `operationFailureMessage` says it: an error
 * the operation declares in its own words, a refusal not at all (the write check said it), anything
 * else in the caller's `failure` words. The error still reaches the caller, for a template's
 * `onError` or a store's own handling.
 */
import {
  createPredictions,
  datasetKey,
  onSpeculationMiss,
  type Predictions,
  runOperation,
  serialKey,
  speculateOperation,
} from '@we/entities';

import { operationFailureMessage } from './operationFailure';

export interface InvokeOptions {
  /** The dataset the operation reads and writes. */
  dataset: unknown;
  /** Who it runs as. */
  invoker: string;
  /** The caller's judgement of an entity chosen at call time — see `RunOperationOptions.admitChosen`. */
  admitChosen?: (entity: string) => boolean;
  /** How a failure reaches the person. Absent, nobody is told here: the caller says it. */
  notify?: (message: string) => void;
  /** The host's words for a failure the operation does not name. */
  failure?: string;
  /**
   * The invocation's id, for a caller that must know the ids of the records it makes before they are
   * made (a form planning its blocks). Fresh otherwise.
   */
  invocationId?: string;
  /**
   * Work that must be done before the real run and need not be before the prediction is drawn — a
   * staged suggestion settled so it cannot overwrite the write. Failing, it fails the invocation.
   */
  before?: () => Promise<unknown>;
}

/*
  In a development build, and outside tests, a read a speculation sends past the rows on screen is
  logged the first time and at each doubling, per operation, entity and query, with the count. A
  gesture listed here draws its prediction a round trip late. Production and tests stay silent.
*/
if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
  const seen = new Map<string, number>();
  onSpeculationMiss(({ operation, entity, query }) => {
    const key = `${operation} ${entity} ${JSON.stringify(query ?? {})}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1 || Number.isInteger(Math.log2(count)))
      console.info(`[speculation] ${operation} read ${entity} past the held rows (${count}×)`, query ?? {});
  });
}

/** `work`, once everything queued before it under `key` has finished, however that went. */
function after<K, T>(tails: Map<K, Promise<unknown>>, key: K, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  // A queue that has drained is forgotten, so the map holds only what is waiting.
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** How a composition runs declared operations, and the predictions they draw into. */
export interface Operations {
  /** Run a declared operation as the host runs every one — see the file's note. */
  invoke(name: string, args: Record<string, unknown> | undefined, options: InvokeOptions): Promise<unknown>;
  /** The predictions every invocation draws into, and every read of this composition draws from. */
  predictions: Predictions;
}

/**
 * The operation runner for one composed store graph (`composeStores`), with its own queues and its
 * own speculations, over the predictions it is given — the composition's. Two compositions never
 * queue behind each other, and never draw each other's pending writes.
 */
export function createOperations(predictions: Predictions = createPredictions()): Operations {
  /** The tail of each queue, by dataset and key. */
  const queues = new Map<string, Promise<unknown>>();
  /** The tail of each dataset's speculations. */
  const speculations = new Map<unknown, Promise<unknown>>();

  async function invoke(
    name: string,
    args: Record<string, unknown> | undefined,
    options: InvokeOptions,
  ): Promise<unknown> {
    const { dataset, invoker, admitChosen, notify, failure } = options;
    const invocation = {
      dataset,
      invoker,
      invocationId: options.invocationId ?? crypto.randomUUID(),
      invokedAt: new Date().toISOString(),
      ...(admitChosen ? { admitChosen } : {}),
    };
    let settled = false;

    // Drawn as soon as it is predicted, which does not wait for any queue the real run joins.
    void after(speculations, datasetKey(dataset), async () => {
      try {
        const { writes } = await speculateOperation(name, args, { ...invocation, predictions });
        if (!settled) predictions.predict(dataset, invocation.invocationId, writes);
      } catch {
        // A run that would fail draws nothing; the real run says why.
      }
    });

    const real = async () => {
      await options.before?.();
      return runOperation(name, args, invocation);
    };
    const key = serialKey(name, args);
    try {
      const result = await (key === undefined
        ? real()
        : after(queues, `${String(datasetKey(dataset))}\u0000${key}`, real));
      settled = true;
      predictions.landed(invocation.invocationId);
      return result;
    } catch (error) {
      settled = true;
      predictions.withdraw(invocation.invocationId);
      const message = notify ? operationFailureMessage(error, failure) : null;
      if (message) {
        console.error(`${name} failed`, error);
        notify!(message);
      }
      throw error;
    }
  }

  return { invoke, predictions };
}
