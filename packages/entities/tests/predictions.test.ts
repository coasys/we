/**
 * Predicted writes in reads: how one meets a result, and when a live read stops drawing it.
 */
import { createLiveQuery, type LivePage } from '@we/backend-shared';
import { afterEach, describe, expect, it } from 'vitest';

import { defineEntity } from '../src/entityProxy';
import { registerEntity, unregisterEntity } from '../src/entityRegistry';
import {
  applyPredictions,
  createPredictions,
  type Prediction,
  readShapeOf,
  withPredictedPages,
  withPredictions,
} from '../src/predictions';
import { bindPredictions, boundPredictions } from '../src/predictions';

const DS = { uuid: 'ds-1' };
const predictions = createPredictions();
const at = (writes: Prediction['writes']): Prediction => ({ invocationId: 'i', writes, landed: false });

afterEach(() => predictions.clear());

describe('a prediction laid over rows', () => {
  const posts = [
    { id: 'p1', title: 'One', signals: [{ id: 's1', value: 1, author: 'did:b' }] },
    { id: 'p2', title: 'Two', signals: [] },
  ];

  it('places a create under its parent wherever the parent is read with that relation', () => {
    const out = applyPredictions(posts, readShapeOf(['CollectionBlock'], {}), [
      at([
        {
          kind: 'create',
          entity: 'Signal',
          id: 'urn:s2',
          fields: { value: 1, author: 'did:me' },
          parent: { id: 'p2', relation: 'signals' },
        },
      ]),
    ]);
    expect(out[1].signals).toEqual([{ id: 'urn:s2', value: 1, author: 'did:me', __subjectClass: 'Signal' }]);
    // What the prediction does not touch is the same object, so a keyed renderer keeps it.
    expect(out[0]).toBe(posts[0]);
  });

  it('takes a deleted record out of an included relation, and edits one in place', () => {
    const out = applyPredictions(posts, readShapeOf(['CollectionBlock'], {}), [
      at([{ kind: 'edit', entity: 'Signal', id: 's1', fields: { value: 4 } }]),
    ]);
    expect(out[0].signals).toEqual([{ id: 's1', value: 4, author: 'did:b' }]);
    const gone = applyPredictions(posts, readShapeOf(['CollectionBlock'], {}), [
      at([{ kind: 'delete', entity: 'Signal', id: 's1' }]),
    ]);
    expect(gone[0].signals).toEqual([]);
  });

  it('places a create at the top only where the read is of its entity and its where matches', () => {
    const create = at([{ kind: 'create', entity: 'Involvement', id: 'v1', fields: { node: 'n1', kind: 'assignee' } }]);
    expect(applyPredictions([], readShapeOf(['Involvement'], { where: { node: 'n1' } }), [create])).toHaveLength(1);
    expect(applyPredictions([], readShapeOf(['Involvement'], { where: { node: 'n2' } }), [create])).toHaveLength(0);
    expect(applyPredictions([], readShapeOf(['Signal'], {}), [create])).toHaveLength(0);
    // A walk it cannot judge is left to the real rows.
    expect(
      applyPredictions([], readShapeOf(['Involvement'], { scope: { via: 'x', anchorId: 'a', transitive: true } }), [
        create,
      ]),
    ).toHaveLength(0);
  });

  it('moves a card between columns, by the records the result already holds', () => {
    const columns = [
      { id: 'c1', arranges: [{ id: 't1', title: 'Task' }] },
      { id: 'c2', arranges: [] as unknown[] },
    ];
    const out = applyPredictions(columns, readShapeOf(['CollectionBlock'], {}), [
      at([
        { kind: 'set', entity: 'CollectionBlock', id: 'c1', relation: 'arranges', targets: [] },
        { kind: 'set', entity: 'CollectionBlock', id: 'c2', relation: 'arranges', targets: ['t1'] },
      ]),
    ]);
    expect(out.map((c) => c.arranges)).toEqual([[], [{ id: 't1', title: 'Task' }]]);
  });

  it('is idempotent: a result already carrying the write is unchanged', () => {
    const rows = [{ id: 'c1', arranges: ['t2', 't1'] }];
    const prediction = at([
      { kind: 'set', entity: 'CollectionBlock', id: 'c1', relation: 'arranges', targets: ['t2', 't1'] },
    ]);
    expect(applyPredictions(rows, readShapeOf(null, {}), [prediction])).toBe(rows);
  });
});

/** A live query over rows a test changes, and a way to change them. */
function source(initial: Record<string, unknown>[]) {
  let rows = initial;
  const listeners = new Set<() => void>();
  const live = createLiveQuery<LivePage<Record<string, unknown>>>({
    read: () => ({ results: rows }),
    watch: (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  });
  return {
    live,
    set(next: Record<string, unknown>[]) {
      rows = next;
      for (const fn of listeners) fn();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ids = (live: { getSnapshot: () => { data?: LivePage<Record<string, unknown>> } }) =>
  (live.getSnapshot().data?.results ?? []).map((r) => r.id);

describe('a live read with predictions', () => {
  const create = (id: string) => [{ kind: 'create' as const, entity: 'Involvement', id, fields: { node: 'n1' } }];

  it('draws a prediction at once, and hands it over to the real row of the same id', async () => {
    const data = source([]);
    const live = withPredictedPages(
      predictions,
      data.live,
      DS,
      readShapeOf(['Involvement'], { where: { node: 'n1' } }),
    );
    await live.first;
    predictions.predict(DS, 'inv-1', create('v1'));
    expect(ids(live)).toEqual(['v1']);
    predictions.landed('inv-1');
    data.set([{ id: 'v1', node: 'n1', author: 'did:me' }]);
    await settle();
    expect(live.getSnapshot().data?.results).toEqual([{ id: 'v1', node: 'n1', author: 'did:me' }]);
    // Spent: a later page without the row is the data's answer, not the prediction's.
    data.set([]);
    await settle();
    expect(ids(live)).toEqual([]);
  });

  it('stops drawing a failed prediction', async () => {
    const data = source([]);
    const live = withPredictedPages(predictions, data.live, DS, readShapeOf(['Involvement'], {}));
    await live.first;
    predictions.predict(DS, 'inv-1', create('v1'));
    expect(ids(live)).toEqual(['v1']);
    predictions.withdraw('inv-1');
    expect(ids(live)).toEqual([]);
  });

  it('keeps drawing a landed prediction until the data moves, and yields to a concurrent write', async () => {
    const data = source([{ id: 'c1', arranges: ['a', 'b'] }]);
    const live = withPredictedPages(predictions, data.live, DS, readShapeOf(['CollectionBlock'], {}));
    await live.first;
    predictions.predict(DS, 'inv-1', [
      { kind: 'set', entity: 'CollectionBlock', id: 'c1', relation: 'arranges', targets: ['b', 'a'] },
    ]);
    predictions.landed('inv-1');
    const order = () => live.getSnapshot().data?.results[0].arranges;
    expect(order()).toEqual(['b', 'a']);
    // Somebody else's order arrives first: the real rows win.
    data.set([{ id: 'c1', arranges: ['a', 'c', 'b'] }]);
    await settle();
    expect(order()).toEqual(['a', 'c', 'b']);
  });

  it('retires on, off, on one by one, never showing an older answer', async () => {
    const data = source([]);
    const live = withPredictedPages(predictions, data.live, DS, readShapeOf(['Involvement'], {}));
    await live.first;
    predictions.predict(DS, 'on', create('v1'));
    predictions.predict(DS, 'off', [{ kind: 'delete', entity: 'Involvement', id: 'v1' }]);
    predictions.predict(DS, 'again', create('v2'));
    expect(ids(live)).toEqual(['v2']);
    // The first press's echo arrives while the third is still going.
    predictions.landed('on');
    data.set([{ id: 'v1', node: 'n1' }]);
    await settle();
    expect(ids(live)).toEqual(['v2']);
  });

  it('reaches one-shot reads through an entity wrapper, for predictions still running', async () => {
    const cls = {
      findAll: async (_dataset?: unknown) => [{ id: 'c1', arranges: ['a'] }],
      findOne: async (_dataset?: unknown) => ({ id: 'c1', arranges: ['a'] }),
      other: () => 'untouched',
    };
    const wrapped = withPredictions(predictions, cls, ['CollectionBlock']);
    predictions.predict(DS, 'inv-1', [
      { kind: 'add', entity: 'CollectionBlock', id: 'c1', relation: 'arranges', target: 'b' },
    ]);
    expect(await wrapped.findAll(DS)).toEqual([{ id: 'c1', arranges: ['a', 'b'] }]);
    expect(await wrapped.findOne(DS)).toEqual({ id: 'c1', arranges: ['a', 'b'] });
    expect(wrapped.other()).toBe('untouched');
    predictions.landed('inv-1');
    expect(await wrapped.findAll(DS)).toEqual([{ id: 'c1', arranges: ['a'] }]);
  });
});

describe('predictions per composition', () => {
  const add = (target: string) => [
    { kind: 'add' as const, entity: 'CollectionBlock', id: 'c1', relation: 'arranges', target },
  ];
  const board = () => ({ findAll: async (_dataset?: unknown) => [{ id: 'c1', arranges: ['a'] }] });

  it('keeps two sets of predictions apart: neither draws what the other predicted', async () => {
    const mine = createPredictions();
    const theirs = createPredictions();
    mine.predict(DS, 'inv-mine', add('b'));
    expect(mine.for(DS)).toHaveLength(1);
    expect(theirs.for(DS)).toEqual([]);
    expect(theirs.any()).toBe(false);
    expect(await withPredictions(mine, board(), ['CollectionBlock']).findAll(DS)).toEqual([
      { id: 'c1', arranges: ['a', 'b'] },
    ]);
    expect(await withPredictions(theirs, board(), ['CollectionBlock']).findAll(DS)).toEqual([
      { id: 'c1', arranges: ['a'] },
    ]);
    // Clearing one leaves the other's.
    theirs.clear();
    expect(mine.for(DS)).toHaveLength(1);
    mine.clear();
  });

  it('has the entity stand-ins draw the predictions bound to them, and the rows alone once unbound', async () => {
    registerEntity('PredictedProbe', board() as never);
    const Probe = defineEntity('PredictedProbe') as unknown as ReturnType<typeof board>;
    const bound = createPredictions();
    const other = createPredictions();
    other.predict(DS, 'inv-other', add('x'));
    const unbind = bindPredictions(bound);
    try {
      bound.predict(DS, 'inv-bound', add('b'));
      expect(await Probe.findAll(DS)).toEqual([{ id: 'c1', arranges: ['a', 'b'] }]);
    } finally {
      unbind();
      unregisterEntity('PredictedProbe');
    }
    expect(boundPredictions()).toBeNull();
    bound.clear();
    other.clear();
  });
});
