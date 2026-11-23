/**
 * Identical live queries share one subscription, which ends only when nobody is left asking.
 *
 * The AD4M executor hands two identical model subscriptions the same id and ends it for both when
 * either disposes, so the kanban's involvements went quiet whenever the inspector re-ran the same
 * query. See `subscriptionPool`.
 */
import { describe, expect, it, vi } from 'vitest';

import { acquireSubscription, subscriptionPoolConfig } from '../src/subscriptionPool';

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
