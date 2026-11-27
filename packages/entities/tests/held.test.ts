/**
 * Reads answered from what the host's live reads hold — and refused, so the backend is asked, when
 * what they hold may not be the whole answer.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { heldAnswer, heldRows, holdRead, readShapeOf } from '../src/predictions';

const DS = { uuid: 'ds-held' };
const removers: (() => void)[] = [];
afterEach(() => removers.splice(0).forEach((remove) => remove()));

function hold(entities: string[], query: Record<string, unknown>, rows: Record<string, unknown>[]) {
  removers.push(holdRead({ dataset: 'ds-held', shape: readShapeOf(entities, query), query, rows: () => rows }));
}

const posts = [
  {
    id: 'p1',
    kind: 'post',
    author: 'did:a',
    signals: [
      { id: 's1', signalTypeId: 'like', author: 'did:me', value: 1, createdAt: '2' },
      { id: 's2', signalTypeId: 'like', author: 'did:b', value: 1, createdAt: '1' },
    ],
  },
  { id: 'p2', kind: 'post', author: 'did:b', signals: [] },
];

describe('heldAnswer', () => {
  it('answers a read by id from any held read carrying the record, relations as ids', () => {
    hold(['CollectionBlock'], { where: { kind: 'post' }, include: { signals: true } }, posts);
    expect(heldAnswer('CollectionBlock', DS, { where: { id: 'p1' } })).toEqual([
      { id: 'p1', kind: 'post', author: 'did:a', signals: ['s1', 's2'] },
    ]);
    // A record nothing holds is the backend's to answer.
    expect(heldAnswer('CollectionBlock', DS, { where: { id: 'p9' } })).toBeUndefined();
  });

  it('answers a read under a parent from an include that holds all of the relation', () => {
    hold(['CollectionBlock'], { where: { kind: 'post' }, include: { signals: true } }, posts);
    const mine = heldAnswer('Signal', DS, {
      parent: { id: 'p1', relation: 'signals' },
      where: { signalTypeId: 'like', author: 'did:me' },
      order: { createdAt: 'asc' },
    });
    expect(mine?.map((row) => row.id)).toEqual(['s1']);
    // An empty relation is an answer too: nobody has reacted.
    expect(heldAnswer('Signal', DS, { parent: { id: 'p2', relation: 'signals' } })).toEqual([]);
  });

  it('does not answer from an include that was narrowed or limited', () => {
    hold(['CollectionBlock'], { include: { signals: { limit: 1 } } }, posts);
    expect(heldAnswer('Signal', DS, { parent: { id: 'p1', relation: 'signals' } })).toBeUndefined();
  });

  it('answers from a wider read of the same entity, and not from a narrower one', () => {
    hold(['Involvement'], {}, [
      { id: 'v1', node: 'n1', agent: 'did:me', kind: 'going' },
      { id: 'v2', node: 'n2', agent: 'did:me', kind: 'going' },
    ]);
    expect(heldAnswer('Involvement', DS, { where: { node: 'n1', agent: 'did:me' } })?.map((r) => r.id)).toEqual(['v1']);
    removers.splice(0).forEach((remove) => remove());
    hold(['Involvement'], { where: { node: 'n1' } }, [{ id: 'v1', node: 'n1', agent: 'did:me' }]);
    expect(heldAnswer('Involvement', DS, { where: { agent: 'did:me' } })).toBeUndefined();
  });

  it('counts a limited read as whole only while it came back short of its limit', () => {
    const placements = [{ id: 'pl1', node: 'n1' }];
    hold(['Placement'], { parent: { id: 'c1', relation: 'children' }, limit: 200 }, placements);
    expect(heldAnswer('Placement', DS, { parent: { id: 'c1', relation: 'children' } })).toHaveLength(1);
    removers.splice(0).forEach((remove) => remove());
    hold(['Placement'], { parent: { id: 'c1', relation: 'children' }, limit: 1 }, placements);
    expect(heldAnswer('Placement', DS, { parent: { id: 'c1', relation: 'children' } })).toBeUndefined();
  });

  it('leaves to the backend what held rows cannot judge', () => {
    hold(['CollectionBlock'], { where: { kind: 'post' }, include: { signals: true } }, posts);
    // A quantifier asks about linked records; a walk, about depth; a field list, about less than a row.
    expect(heldAnswer('CollectionBlock', DS, { where: { signals: { some: {} } } })).toBeUndefined();
    expect(heldAnswer('Signal', DS, { parent: { id: 'p1', relation: 'signals', levels: [2] } })).toBeUndefined();
    expect(heldAnswer('CollectionBlock', DS, { where: { id: 'p1' }, select: ['kind'] })).toBeUndefined();
    // And another dataset's reads say nothing about this one.
    expect(heldAnswer('CollectionBlock', { uuid: 'ds-other' }, { where: { id: 'p1' } })).toBeUndefined();
  });

  it('lists what is on screen for a preview, with no claim that it is all', () => {
    hold(['Placement'], { parent: { id: 'c1', relation: 'children' } }, [
      { id: 'pl1', node: { id: 'n1', title: 'One' } },
      { id: 'pl2', node: { id: 'n2', title: 'Two' } },
    ]);
    expect(heldRows('Placement', DS, { node: 'n1' }).map((row) => row.id)).toEqual(['pl1']);
  });
});
