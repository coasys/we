/**
 * WE's own canvas operations, run against the reference backend: a card's placement written once
 * however often it moves, a style that needs a position, a tree row ranked in one write, and a
 * connection nobody has discussed taken away while one that has been is kept.
 */
import { getEntity, isOperationError, runOperation } from '@we/entities';
import { beforeEach, describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const ME = 'did:test:me';
const CANVAS = 'canvas';

interface Row {
  id: string;
  [field: string]: unknown;
}
type Model = {
  findOne(d: unknown, q: Record<string, unknown>): Promise<Row | null>;
  findAll(d: unknown, q?: Record<string, unknown>): Promise<Row[]>;
  create(d: unknown, data: Record<string, unknown>, o?: Record<string, unknown>): Promise<Row>;
};
const model = (name: string) => getEntity(name) as unknown as Model;

let dataset: unknown;
const run = (name: string, args: Record<string, unknown>) => runOperation(name, args, { dataset, invoker: ME });
const onCanvas = { parent: { id: CANVAS, relation: 'children', entity: 'CollectionBlock' } };
const placements = () => model('Placement').findAll(dataset, onCanvas);

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => ME },
    { agent: { id: ME, unlocked: true }, datasets: [{ id: 'ds-canvas-ops', name: 'Canvas' }] },
  );
  dataset = (await ports.lifecycle.get('ds-canvas-ops'))!.handle;
  await model('CollectionBlock').create(dataset, { kind: 'canvas' }, { id: CANVAS });
});

describe('core.placeCard', () => {
  it('makes a placement under the canvas, and edits that one after, answering with what it held', async () => {
    const first = await run('core.placeCard', {
      canvas: CANVAS,
      node: 'n1',
      nodeType: 'TaskBlock',
      fields: { x: 1, y: 2 },
    });
    expect(first).toEqual({ from: null, to: { x: 1, y: 2 } });
    const [made] = await placements();
    expect(made).toMatchObject({ node: 'n1', nodeType: 'TaskBlock', x: 1, y: 2 });

    const second = await run('core.placeCard', {
      canvas: CANVAS,
      node: 'n1',
      fields: { x: 5, y: 6 },
      placement: made.id,
    });
    expect(second).toEqual({ from: { x: 1, y: 2 }, to: { x: 5, y: 6 } });
    expect(await placements()).toEqual([expect.objectContaining({ id: made.id, x: 5, y: 6 })]);
  });

  it('removes the duplicates the drawn placement outranks, in the same write', async () => {
    const drawn = await model('Placement').create(dataset, { node: ['n1'], x: 1, y: 1 }, onCanvas);
    await model('Placement').create(dataset, { node: ['n1'], x: 9, y: 9 }, { ...onCanvas, id: 'stray' });

    await run('core.placeCard', {
      canvas: CANVAS,
      node: 'n1',
      fields: { x: 3, y: 3 },
      placement: drawn.id,
      duplicates: ['stray'],
    });

    expect((await placements()).map((row) => row.id)).toEqual([drawn.id]);
  });

  it('refuses a style for a card with no placement rather than inventing a position', async () => {
    const error = await run('core.placeCard', {
      canvas: CANVAS,
      node: 'n1',
      fields: { color: 'accent-500' },
      create: false,
    }).catch((e) => e);
    expect(isOperationError(error) && [error.class, error.code]).toEqual(['precondition', 'notPlaced']);
    expect(await placements()).toEqual([]);
  });
});

describe('core.rankCards', () => {
  it('writes a row’s ranks together', async () => {
    const a = await model('Placement').create(dataset, { node: ['a'], rank: 1024 }, onCanvas);
    const b = await model('Placement').create(dataset, { node: ['b'], rank: 2048 }, onCanvas);

    await run('core.rankCards', {
      ranks: [
        { placement: b.id, rank: 1024 },
        { placement: a.id, rank: 2048 },
      ],
    });

    const rows = await placements();
    expect(Object.fromEntries(rows.map((row) => [row.node, row.rank]))).toEqual({ a: 2048, b: 1024 });
  });
});

describe('connections', () => {
  it('connects two records with their types, key and kind, and answers with the connection', async () => {
    const id = await run('core.connectRecords', {
      source: 'p',
      sourceType: 'TaskBlock',
      target: 'c',
      targetType: 'TaskBlock',
      key: 'Plan → Build',
      kind: 'kind-1',
    });
    expect(await model('Relationship').findOne(dataset, { where: { id } })).toMatchObject({
      source: 'p',
      target: 'c',
      connection: 'Plan → Build',
      relationshipTypeId: 'kind-1',
    });
  });

  it('moves one end of a connection, with its key', async () => {
    const id = (await run('core.connectRecords', { source: 'p', target: 'c', key: 'p → c' })) as string;
    await run('core.retargetConnection', {
      connection: id,
      end: 'source',
      node: 'q',
      nodeType: 'TaskBlock',
      key: 'q → c',
    });
    expect(await model('Relationship').findOne(dataset, { where: { id } })).toMatchObject({
      source: 'q',
      sourceType: 'TaskBlock',
      target: 'c',
      connection: 'q → c',
    });
  });

  it('detaches a connection nobody has discussed, and refuses one somebody has', async () => {
    const quiet = (await run('core.connectRecords', { source: 'p', target: 'a' })) as string;
    const argued = (await run('core.connectRecords', { source: 'p', target: 'b' })) as string;
    await model('CollectionBlock').create(
      dataset,
      { kind: 'reply' },
      { parent: { id: argued, relation: 'responses' } },
    );

    await run('core.detachConnection', { connection: quiet });
    const error = await run('core.detachConnection', { connection: argued }).catch((e) => e);

    expect(isOperationError(error) && error.code).toBe('discussed');
    expect((await model('Relationship').findAll(dataset)).map((row) => row.id)).toEqual([argued]);
  });
});

describe('type styles', () => {
  it('colours a kind in the space’s key, settling a doubled pair, and restyles it whole', async () => {
    await model('Space').create(dataset, { name: 'Space' }, { id: 'space' });
    const inKey = { parent: { id: 'space', relation: 'typeStyles', entity: 'Space' } };
    await model('TypeStyle').create(dataset, { nodeType: 'TaskBlock', color: 'a' }, inKey);
    await model('TypeStyle').create(dataset, { nodeType: 'TaskBlock', color: 'b' }, inKey);

    await run('core.colorSpaceType', { space: 'space', nodeType: 'TaskBlock', color: 'c' });
    expect((await model('TypeStyle').findAll(dataset, inKey)).map((row) => row.color)).toEqual(['c']);

    await run('core.restyleSpaceType', { space: 'space', nodeType: 'TaskBlock', fields: {} });
    expect(await model('TypeStyle').findAll(dataset, inKey)).toEqual([]);
  });
});
