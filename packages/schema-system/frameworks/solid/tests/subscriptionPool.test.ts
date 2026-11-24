/**
 * Identical live queries share one subscription, which ends only when nobody is left asking.
 *
 * The AD4M executor hands two identical model subscriptions the same id and ends it for both when
 * either disposes, so the kanban's involvements went quiet whenever the inspector re-ran the same
 * query. See `subscriptionPool`.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  acquireSubscription,
  clearLastAnswers,
  clearLastAnswersFor,
  subscriptionPoolConfig,
} from '../src/subscriptionPool';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

type Snap = { status: 'loading' | 'ready'; data?: { results: unknown[] }; initial: boolean };

/** A live query by hand: `answer` opens it on the first rows, `push` is a change after that. */
function model() {
  const builders: {
    subscribe: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    push: (rows: unknown[]) => void;
    answer: (rows: unknown[]) => void;
    fail: (error: Error) => void;
  }[] = [];
  const Model = {
    query: vi.fn(() => {
      const listeners = new Set<(snapshot: Snap) => void>();
      let current: Snap = { status: 'loading', initial: false };
      let resolveFirst: (rows: unknown) => void = () => {};
      let rejectFirst: (error: Error) => void = () => {};
      const first = new Promise<unknown>((resolve, reject) => {
        resolveFirst = resolve;
        rejectFirst = reject;
      });
      const emit = (rows: unknown[], initial: boolean) => {
        current = { status: 'ready', data: { results: rows }, initial };
        for (const fn of [...listeners]) fn(current);
      };
      const builder = {
        first,
        subscribe: vi.fn((fn: (snapshot: Snap) => void) => {
          listeners.add(fn);
          if (current.status === 'ready') fn(current);
          return () => void listeners.delete(fn);
        }),
        dispose: vi.fn(),
        push: (rows: unknown[]) => emit(rows, false),
        answer: (rows: unknown[]) => {
          emit(rows, true);
          resolveFirst({ results: rows });
        },
        fail: (error: Error) => rejectFirst(error),
      };
      builders.push(builder);
      return builder;
    }),
  };
  return { Model, builders };
}

describe('a shared subscription', () => {
  const dataset = { uuid: 'space' };
  const question = { where: { kind: 'reviewer' } };

  it('is asked once for two identical questions, and both hear every answer', async () => {
    const { Model, builders } = model();
    const a = vi.fn();
    const b = vi.fn();
    acquireSubscription(Model, dataset, question, a, vi.fn());
    acquireSubscription(Model, { uuid: 'space' }, { where: { kind: 'reviewer' } }, b, vi.fn());
    expect(Model.query).toHaveBeenCalledTimes(1);

    builders[0].answer([{ id: 'i1' }]);
    await tick();
    builders[0].push([{ id: 'i1' }, { id: 'i2' }]);
    expect(a).toHaveBeenLastCalledWith([{ id: 'i1' }, { id: 'i2' }]);
    expect(b).toHaveBeenLastCalledWith([{ id: 'i1' }, { id: 'i2' }]);
  });

  it('keeps delivering to the others when one listener throws', async () => {
    const { Model, builders } = model();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = vi.fn();
    const bError = vi.fn();
    acquireSubscription(
      Model,
      dataset,
      question,
      () => {
        throw new Error('first listener');
      },
      () => {
        throw new Error('first listener');
      },
    );
    acquireSubscription(Model, dataset, question, b, bError);

    builders[0].answer([{ id: 'i1' }]);
    await tick();
    expect(b).toHaveBeenCalledWith([{ id: 'i1' }]);

    const failing = model();
    acquireSubscription(failing.Model, dataset, { where: { kind: 'other' } }, vi.fn(), () => {
      throw new Error('first listener');
    });
    acquireSubscription(failing.Model, dataset, { where: { kind: 'other' } }, vi.fn(), bError);
    failing.builders[0].fail(new Error('down'));
    await tick();
    expect(bError).toHaveBeenCalledWith(expect.objectContaining({ message: 'down' }));
    quiet.mockRestore();
  });

  it('shares by entity name, whatever object the host wraps the model in', async () => {
    // The AD4M bindings build a fresh wrapper on every lookup; keyed by object, nothing ever matched.
    const { Model, builders } = model();
    const wrap = () => ({
      query: (dataset: unknown, options: Record<string, unknown>) =>
        (Model.query as (...args: unknown[]) => unknown)(dataset, options),
    });
    const kanban = vi.fn();
    acquireSubscription(wrap(), dataset, question, kanban, vi.fn(), 'Involvement');
    acquireSubscription(wrap(), dataset, question, vi.fn(), vi.fn(), 'Involvement');
    expect(Model.query).toHaveBeenCalledTimes(1);
    builders[0].answer([]);
    await tick();
    builders[0].push([{ id: 'i1' }]);
    expect(kanban).toHaveBeenLastCalledWith([{ id: 'i1' }]);
  });

  it('keeps a subscription nobody holds for its grace period', async () => {
    subscriptionPoolConfig.releaseGraceMs = 30;
    const { Model, builders } = model();
    const release = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn(), 'Involvement');
    builders[0].answer([]);
    await tick();
    release();
    await tick();
    // A panel remounting a moment later finds it still there.
    acquireSubscription(Model, dataset, question, vi.fn(), vi.fn(), 'Involvement');
    expect(Model.query).toHaveBeenCalledTimes(1);
    expect(builders[0].dispose).not.toHaveBeenCalled();
  });

  it('stays live for the others when one lets go', async () => {
    const { Model, builders } = model();
    const kanban = vi.fn();
    const releaseInspector = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn());
    const releaseKanban = acquireSubscription(Model, dataset, question, kanban, vi.fn());
    builders[0].answer([]);
    await tick();

    releaseInspector();
    await tick();
    expect(builders[0].dispose).not.toHaveBeenCalled();
    builders[0].push([{ id: 'i1' }]);
    expect(kanban).toHaveBeenLastCalledWith([{ id: 'i1' }]);

    releaseKanban();
    await tick();
    expect(builders[0].dispose).toHaveBeenCalledOnce();
  });

  it('gives a late joiner the rows already answered', async () => {
    const { Model, builders } = model();
    acquireSubscription(Model, dataset, question, vi.fn(), vi.fn());
    builders[0].answer([{ id: 'i1' }]);
    await tick();

    const late = vi.fn();
    acquireSubscription(Model, dataset, question, late, vi.fn());
    await tick();
    expect(late).toHaveBeenCalledWith([{ id: 'i1' }]);
  });

  it('keeps the subscription when the same question is released and asked again in one pass', async () => {
    const { Model, builders } = model();
    const release = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn());
    builders[0].answer([]);
    await tick();

    release();
    acquireSubscription(Model, dataset, question, vi.fn(), vi.fn());
    await tick();
    expect(Model.query).toHaveBeenCalledTimes(1);
    expect(builders[0].dispose).not.toHaveBeenCalled();
  });

  it('disposes a subscription let go of before it answered, and the next asker starts its own', async () => {
    const { Model, builders } = model();
    const release = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn());
    release();
    await tick();
    expect(builders[0].dispose).toHaveBeenCalledOnce();

    acquireSubscription(Model, dataset, question, vi.fn(), vi.fn());
    expect(Model.query).toHaveBeenCalledTimes(2);
  });

  it('tells every listener when the first open fails', async () => {
    const { Model, builders } = model();
    const onError = vi.fn();
    acquireSubscription(Model, dataset, question, vi.fn(), onError);
    builders[0].fail(new Error('executor unreachable'));
    await tick();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'executor unreachable' }));
  });
});

describe('the last answer of a question let go of', () => {
  const dataset = { uuid: 'space' };
  const question = { where: { kind: 'reviewer' } };

  /** Ask, answer, let go and wait out the (zero) grace — the entry is gone and its rows are kept. */
  async function askAndLetGo(
    Model: ReturnType<typeof model>['Model'],
    builders: ReturnType<typeof model>['builders'],
    rows: unknown[],
    q: Record<string, unknown> = question,
  ) {
    const release = acquireSubscription(Model, dataset, q, vi.fn(), vi.fn(), 'Involvement');
    builders[builders.length - 1].answer(rows);
    await tick();
    release();
    await tick();
  }

  it('is shown at once to the same question asked again, then replaced by the live answer', async () => {
    const { Model, builders } = model();
    await askAndLetGo(Model, builders, [{ id: 'i1' }]);

    const again = vi.fn();
    acquireSubscription(Model, dataset, question, again, vi.fn(), 'Involvement');
    expect(Model.query).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(again).toHaveBeenCalledTimes(1);
    expect(again).toHaveBeenLastCalledWith([{ id: 'i1' }]);

    builders[1].answer([{ id: 'i1' }, { id: 'i2' }]);
    await tick();
    expect(again).toHaveBeenLastCalledWith([{ id: 'i1' }, { id: 'i2' }]);
  });

  it('never arrives after a live answer', async () => {
    const { Model, builders } = model();
    await askAndLetGo(Model, builders, [{ id: 'old' }]);

    const again = vi.fn();
    acquireSubscription(Model, dataset, question, again, vi.fn(), 'Involvement');
    // The subscription speaks before the microtask that would deliver the kept rows.
    builders[1].push([{ id: 'live' }]);
    await tick();
    expect(again.mock.calls.map((c) => c[0])).toEqual([[{ id: 'live' }]]);
  });

  it('is not shown for another question, another dataset, or a caller with no entity name', async () => {
    const { Model, builders } = model();
    await askAndLetGo(Model, builders, [{ id: 'i1' }]);

    const other = vi.fn();
    acquireSubscription(Model, dataset, { where: { kind: 'other' } }, other, vi.fn(), 'Involvement');
    acquireSubscription(Model, { uuid: 'elsewhere' }, question, other, vi.fn(), 'Involvement');
    acquireSubscription(Model, dataset, question, other, vi.fn());
    await tick();
    expect(other).not.toHaveBeenCalled();
  });

  it('keeps no more than its bound, dropping the longest unused first', async () => {
    subscriptionPoolConfig.lastAnswersLimit = 2;
    try {
      const { Model, builders } = model();
      for (const n of [1, 2, 3]) await askAndLetGo(Model, builders, [{ id: `r${n}` }], { where: { n } });

      const evicted = vi.fn();
      const kept = vi.fn();
      acquireSubscription(Model, dataset, { where: { n: 1 } }, evicted, vi.fn(), 'Involvement');
      acquireSubscription(Model, dataset, { where: { n: 3 } }, kept, vi.fn(), 'Involvement');
      await tick();
      expect(evicted).not.toHaveBeenCalled();
      expect(kept).toHaveBeenCalledWith([{ id: 'r3' }]);
    } finally {
      subscriptionPoolConfig.lastAnswersLimit = 300;
    }
  });

  it('is emptied by clearLastAnswers', async () => {
    const { Model, builders } = model();
    await askAndLetGo(Model, builders, [{ id: 'i1' }]);
    clearLastAnswers();

    const again = vi.fn();
    acquireSubscription(Model, dataset, question, again, vi.fn(), 'Involvement');
    await tick();
    expect(again).not.toHaveBeenCalled();
  });

  it('keeps nothing from a failed entry, which the next asker retries', async () => {
    const { Model, builders } = model();
    const failing = vi.fn();
    const releaseFailing = acquireSubscription(Model, dataset, question, vi.fn(), failing, 'Involvement');
    builders[0].fail(new Error('No SHACL shape stored for class X'));
    await tick();
    expect(failing).toHaveBeenCalledOnce();
    releaseFailing();
    await tick();

    const retry = vi.fn();
    const queries = Model.query.mock.calls.length;
    acquireSubscription(Model, dataset, question, retry, vi.fn(), 'Involvement');
    await tick();
    // Nothing kept to show, and a new subscription rather than the failed one.
    expect(retry).not.toHaveBeenCalled();
    expect(Model.query.mock.calls.length).toBe(queries + 1);
  });

  it('retries a failed entry that is still held when the question is asked again', async () => {
    const { Model, builders } = model();
    subscriptionPoolConfig.releaseGraceMs = 30;
    acquireSubscription(Model, dataset, question, vi.fn(), vi.fn(), 'Involvement');
    builders[0].fail(new Error('No SHACL shape stored for class X'));
    await tick();

    const retry = vi.fn();
    acquireSubscription(Model, dataset, question, retry, vi.fn(), 'Involvement');
    expect(Model.query).toHaveBeenCalledTimes(2);
    builders[1].answer([{ id: 'i1' }]);
    await tick();
    expect(retry).toHaveBeenCalledWith([{ id: 'i1' }]);
  });

  it('puts nothing back from a release that was waiting when the session ended', async () => {
    const { Model, builders } = model();
    subscriptionPoolConfig.releaseGraceMs = 20;
    const release = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn(), 'Involvement');
    builders[0].answer([{ id: 'old-agent' }]);
    await tick();
    release();
    clearLastAnswers();
    // The grace runs out after the clear: the old agent's rows must not be remembered by it.
    await new Promise((r) => setTimeout(r, 40));

    const next = vi.fn();
    acquireSubscription(Model, dataset, question, next, vi.fn(), 'Involvement');
    await tick();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not join, or show the rows of, a subscription opened in the session that ended', async () => {
    const { Model, builders } = model();
    subscriptionPoolConfig.releaseGraceMs = 20;
    acquireSubscription(Model, dataset, question, vi.fn(), vi.fn(), 'Involvement');
    builders[0].answer([{ id: 'old-agent' }]);
    await tick();
    clearLastAnswers();

    const next = vi.fn();
    acquireSubscription(Model, dataset, question, next, vi.fn(), 'Involvement');
    await tick();
    expect(Model.query).toHaveBeenCalledTimes(2);
    expect(next).not.toHaveBeenCalled();
  });

  it('is emptied for one dataset by clearLastAnswersFor, and for no other', async () => {
    const { Model, builders } = model();
    await askAndLetGo(Model, builders, [{ id: 'i1' }]);
    const elsewhere = acquireSubscription(Model, { uuid: 'elsewhere' }, question, vi.fn(), vi.fn(), 'Involvement');
    builders[builders.length - 1].answer([{ id: 'e1' }]);
    await tick();
    elsewhere();
    await tick();
    clearLastAnswersFor('space');

    const gone = vi.fn();
    const kept = vi.fn();
    acquireSubscription(Model, dataset, question, gone, vi.fn(), 'Involvement');
    acquireSubscription(Model, { uuid: 'elsewhere' }, question, kept, vi.fn(), 'Involvement');
    await tick();
    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledWith([{ id: 'e1' }]);
  });

  it('is not restored by an entry of the cleared dataset still waiting out its grace', async () => {
    subscriptionPoolConfig.releaseGraceMs = 20;
    try {
      const { Model, builders } = model();
      const release = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn(), 'Involvement');
      builders[0].answer([{ id: 'i1' }]);
      await tick();
      release();
      clearLastAnswersFor('space');
      await new Promise((r) => setTimeout(r, 40));

      const again = vi.fn();
      acquireSubscription(Model, dataset, question, again, vi.fn(), 'Involvement');
      await tick();
      expect(again).not.toHaveBeenCalled();
    } finally {
      subscriptionPoolConfig.releaseGraceMs = 0;
    }
  });

  it('is not delivered when the dataset is cleared before the queued delivery runs', async () => {
    const { Model, builders } = model();
    await askAndLetGo(Model, builders, [{ id: 'i1' }]);
    const again = vi.fn();
    acquireSubscription(Model, dataset, question, again, vi.fn(), 'Involvement');
    clearLastAnswersFor('space');
    await tick();
    expect(again).not.toHaveBeenCalled();
  });

  it('is shown to every reader that joins before the live answer, and the live answer still wins', async () => {
    const { Model, builders } = model();
    await askAndLetGo(Model, builders, [{ id: 'i1' }]);

    const first = vi.fn();
    const second = vi.fn();
    acquireSubscription(Model, dataset, question, first, vi.fn(), 'Involvement');
    acquireSubscription(Model, dataset, question, second, vi.fn(), 'Involvement');
    expect(Model.query).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(first).toHaveBeenLastCalledWith([{ id: 'i1' }]);
    expect(second).toHaveBeenLastCalledWith([{ id: 'i1' }]);

    builders[1].push([{ id: 'live' }]);
    const third = vi.fn();
    acquireSubscription(Model, dataset, question, third, vi.fn(), 'Involvement');
    await tick();
    expect(third.mock.calls.map((c) => c[0])).toEqual([[{ id: 'live' }]]);
  });

  it('drops the kept rows of a question whose live answer then fails', async () => {
    const { Model, builders } = model();
    await askAndLetGo(Model, builders, [{ id: 'i1' }]);
    const denied = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn(), 'Involvement');
    builders[builders.length - 1].fail(new Error('denied'));
    await tick();
    denied();
    await tick();

    const retry = vi.fn();
    acquireSubscription(Model, dataset, question, retry, vi.fn(), 'Involvement');
    await tick();
    expect(retry).not.toHaveBeenCalled();
  });

  it('does not keep an answer longer than the row bound, nor the older one it replaces', async () => {
    subscriptionPoolConfig.lastAnswerRowsLimit = 2;
    try {
      const { Model, builders } = model();
      await askAndLetGo(Model, builders, [{ id: 'a' }]);
      await askAndLetGo(Model, builders, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      const again = vi.fn();
      acquireSubscription(Model, dataset, question, again, vi.fn(), 'Involvement');
      await tick();
      expect(again).not.toHaveBeenCalled();
    } finally {
      subscriptionPoolConfig.lastAnswerRowsLimit = 500;
    }
  });
});

describe('a subscription and the schema revision', () => {
  const dataset = { uuid: 'space' };
  const question = { where: { kind: 'reviewer' } };

  it('is not joined by a question asked under a newer revision, so a late rejection cannot stick', async () => {
    const { Model, builders } = model();
    const first = vi.fn();
    const releaseFirst = acquireSubscription(Model, dataset, question, vi.fn(), first, 'Involvement', 0);
    // Upkeep finishes first: the effect re-runs under revision 1, before the rejection has landed.
    releaseFirst();
    const second = vi.fn();
    const secondError = vi.fn();
    acquireSubscription(Model, dataset, question, second, secondError, 'Involvement', 1);
    expect(Model.query).toHaveBeenCalledTimes(2);
    builders[0].fail(new Error('No SHACL shape stored for class X'));
    await tick();
    builders[1].answer([{ id: 'i1' }]);
    await tick();
    expect(secondError).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith([{ id: 'i1' }]);
  });

  it('still shows the rows kept under an older revision', async () => {
    const { Model, builders } = model();
    const release = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn(), 'Involvement', 0);
    builders[0].answer([{ id: 'i1' }]);
    await tick();
    release();
    await tick();
    const again = vi.fn();
    acquireSubscription(Model, dataset, question, again, vi.fn(), 'Involvement', 3);
    await tick();
    expect(again).toHaveBeenCalledWith([{ id: 'i1' }]);
  });
});
