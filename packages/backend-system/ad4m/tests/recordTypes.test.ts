/**
 * A row's record type, named as WE names the class.
 *
 * The executor answers a union read, and a polymorphic member, with the class each row was read as,
 * by its target class IRI. The contract's `__subjectClass` is the entity name a template compares with
 * `'TaskBlock'`. These pin the translation, in both spellings, and that WE's class and another app's
 * class of the same name stay apart.
 */
import { Ad4mModel } from '@coasys/ad4m';
import { createLiveQuery } from '@we/backend-shared';
import { getEntityTargetClass, registerDynamicEntities, registerEntity, unregisterEntity } from '@we/entities';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { toRendererEntity, toRendererUnion } from '../src/ad4mAdapter';
import { EventBlock, TaskBlock, Topic, WeNode } from '../src/entities';
import { entityNameOfClass, nameRecordTypes, namingLive } from '../src/recordTypes';

const MODELS = { TaskBlock, EventBlock, Topic };
const iri = (model: unknown) => getEntityTargetClass(model as never) as string;
const TASK = iri(TaskBlock);
const EVENT = iri(EventBlock);
const TOPIC = iri(Topic);

/** Flux's topic, as a foreign class: registered for one dataset, under its IRI. */
const fluxTopic = { generateSHACL: () => ({ shape: { targetClass: 'flux://Topic' } }) };
const dataset = { uuid: 'p-record-types' };

beforeAll(() => {
  for (const [name, model] of Object.entries(MODELS)) registerEntity(name, model as never);
  registerDynamicEntities(dataset.uuid, { 'flux://Topic': fluxTopic as never });
});
afterAll(() => {
  for (const name of Object.keys(MODELS)) unregisterEntity(name);
  registerDynamicEntities(dataset.uuid, {});
});
afterEach(() => vi.restoreAllMocks());

describe("WE's classes, by IRI", () => {
  it('each has a target class of its own, and is found by it', () => {
    expect(new Set([TASK, EVENT, TOPIC]).size).toBe(3);
    for (const [name, model] of Object.entries(MODELS)) {
      expect(entityNameOfClass(iri(model))).toBe(name);
      expect((model as unknown as typeof Ad4mModel).queriedAs()).toBe(iri(model));
    }
  });
});

describe('entityNameOfClass', () => {
  it('names a target class, and leaves a name as it is', () => {
    expect(entityNameOfClass(TASK)).toBe('TaskBlock');
    expect(entityNameOfClass('TaskBlock')).toBe('TaskBlock');
  });

  it("names WE's Topic and Flux's Topic apart", () => {
    expect(entityNameOfClass(TOPIC, dataset)).toBe('Topic');
    expect(entityNameOfClass('flux://Topic', dataset)).toBe('flux://Topic');
  });

  it('leaves a class nothing in WE registered as the executor sent it', () => {
    expect(entityNameOfClass('nowhere://Thing', dataset)).toBe('nowhere://Thing');
  });
});

describe('nameRecordTypes', () => {
  it('names every row, its class list, and the members it carries', () => {
    const rows = [
      {
        id: 'a',
        __subjectClass: TASK,
        __subjectClasses: [TASK, TOPIC],
        children: [{ id: 'b', __subjectClass: EVENT }],
        parent: { id: 'c', __subjectClass: 'flux://Topic' },
      },
      { id: 'd', __subjectClass: 'TaskBlock' },
    ];

    nameRecordTypes(rows, dataset);

    expect(rows[0].__subjectClass).toBe('TaskBlock');
    expect(rows[0].__subjectClasses).toEqual(['TaskBlock', 'Topic']);
    expect(rows[0].children?.[0]?.__subjectClass).toBe('EventBlock');
    expect(rows[0].parent?.__subjectClass).toBe('flux://Topic');
    expect(rows[1].__subjectClass).toBe('TaskBlock');
  });

  it('passes a row with no record type, and a value that is not rows, untouched', () => {
    const rows = [{ id: 'x', title: 'plain' }];
    expect(nameRecordTypes(rows)).toEqual([{ id: 'x', title: 'plain' }]);
    expect(nameRecordTypes(null)).toBeNull();
  });
});

describe('namingLive', () => {
  it('names the rows of the first page and of every change after it', async () => {
    let page = [{ __subjectClass: TASK }];
    let changed!: () => void;
    const live = createLiveQuery({
      read: () => ({ results: page }),
      watch: (onChange) => {
        changed = onChange;
        return () => undefined;
      },
    });
    const named = namingLive(live, dataset);
    expect((await named.first).results).toEqual([{ __subjectClass: 'TaskBlock' }]);
    expect(named.getSnapshot().initial).toBe(true);

    page = [{ __subjectClass: 'flux://Topic' }];
    changed();
    await vi.waitFor(() => expect(named.getSnapshot().data?.results).toEqual([{ __subjectClass: 'flux://Topic' }]));
    expect(named.getSnapshot().initial).toBe(false);
    named.dispose();
  });
});

describe('toRendererUnion', () => {
  it('reads its classes as one query, and answers each row by entity name', async () => {
    const findAllOf = vi.spyOn(Ad4mModel, 'findAllOf').mockResolvedValue([
      { id: 'a', __subjectClass: TASK },
      { id: 'b', __subjectClass: EVENT },
    ] as never);
    const union = toRendererUnion([TaskBlock, EventBlock] as never);

    const rows = await union.findAll(dataset as never, {} as never);

    expect(findAllOf.mock.calls[0][1]).toEqual([TaskBlock, EventBlock]);
    expect(rows.map((r) => (r as { __subjectClass: string }).__subjectClass)).toEqual(['TaskBlock', 'EventBlock']);
  });
});

describe('toRendererEntity over an abstract class', () => {
  // An abstract read (WeNode, TextContent, a Container) answers each row as the concrete class it was
  // read as, by IRI. The renderer sees entity names, as for a union.
  it('names each row of a read', async () => {
    vi.spyOn(WeNode as unknown as typeof Ad4mModel, 'findAll').mockResolvedValue([
      { id: 'a', __subjectClass: TASK, __subjectClasses: [TASK] },
      { id: 'b', __subjectClass: EVENT },
      { id: 'c', __subjectClass: 'flux://Topic' },
    ] as never);

    const rows = await toRendererEntity(WeNode as never).findAll(dataset as never, {} as never);

    expect(rows.map((r) => (r as { __subjectClass: string }).__subjectClass)).toEqual([
      'TaskBlock',
      'EventBlock',
      'flux://Topic',
    ]);
    expect((rows[0] as { __subjectClasses: string[] }).__subjectClasses).toEqual(['TaskBlock']);
  });

  it('names the members of a row that says no class of its own', async () => {
    // A concrete read (a collection) has no `__subjectClass`; its polymorphic `children` each do.
    const perspective = { uuid: 'p-own-state', __subjectClass: TASK };
    vi.spyOn(WeNode as unknown as typeof Ad4mModel, 'findAll').mockResolvedValue([
      {
        id: 'col',
        _perspective: perspective,
        children: [{ id: 't', __subjectClass: TASK }],
        cover: { __subjectClass: EVENT },
      },
    ] as never);

    const [row] = (await toRendererEntity(WeNode as never).findAll(dataset as never, {} as never)) as never as {
      __subjectClass?: string;
      children: { __subjectClass: string }[];
      cover: { __subjectClass: string };
    }[];

    expect(row.__subjectClass).toBeUndefined();
    expect(row.children[0].__subjectClass).toBe('TaskBlock');
    expect(row.cover.__subjectClass).toBe('EventBlock');
    // An instance's own state is not data, and is not walked.
    expect(perspective.__subjectClass).toBe(TASK);
  });

  it('names each row of a live read', async () => {
    const source = createLiveQuery({
      read: () => ({ results: [{ id: 'a', __subjectClass: TOPIC }] }),
      watch: () => () => undefined,
    });
    vi.spyOn(WeNode as unknown as typeof Ad4mModel, 'query').mockReturnValue(source as never);

    const live = toRendererEntity(WeNode as never).query(dataset as never, {} as never);

    expect((await live.first).results).toEqual([{ id: 'a', __subjectClass: 'Topic' }]);
  });
});
