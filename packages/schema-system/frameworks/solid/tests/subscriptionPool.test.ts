/**
 * Identical live queries share one subscription, which ends only when nobody is left asking.
 *
 * The AD4M executor hands two identical model subscriptions the same id and ends it for both when
 * either disposes, so the kanban's involvements went quiet whenever the inspector re-ran the same
 * query. See `subscriptionPool`.
 */
import { describe, expect, it, vi } from 'vitest';

import { acquireSubscription } from '../src/subscriptionPool';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function model() {
  const builders: {
    subscribe: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    push: (rows: unknown[]) => void;
    answer: (rows: unknown[]) => void;
  }[] = [];
  const Model = {
    query: vi.fn(() => {
      let push: (rows: unknown[]) => void = () => {};
      let answer: (rows: unknown[]) => void = () => {};
      const builder = {
        subscribe: vi.fn((cb: (rows: unknown[]) => void) => {
          push = cb;
          return new Promise<unknown[]>((resolve) => {
            answer = resolve;
          });
        }),
        dispose: vi.fn(),
        push: (rows: unknown[]) => push(rows),
        answer: (rows: unknown[]) => answer(rows),
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

  it('disposes again once answered when let go of before the answer came', async () => {
    const { Model, builders } = model();
    const release = acquireSubscription(Model, dataset, question, vi.fn(), vi.fn());
    release();
    await tick();
    const early = builders[0].dispose.mock.calls.length;

    builders[0].answer([]);
    await tick();
    expect(builders[0].dispose.mock.calls.length).toBe(early + 1);

    // And the next asker starts a subscription of its own rather than joining a dead one.
    acquireSubscription(Model, dataset, question, vi.fn(), vi.fn());
    expect(Model.query).toHaveBeenCalledTimes(2);
  });
});
