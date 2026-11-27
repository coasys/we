/**
 * `json` properties through the real model layer: a list or an object written by `create`,
 * `update` and `save` reaches the executor as one `literal:json:` target, and reads back as the
 * value. Against a perspective stand-in that stores each property's target and hydrates rows as the
 * executor does — parsing `literal:` targets — since the real one needs an executor.
 */
import { Ad4mModel, Literal, Model, Property } from '@coasys/ad4m';
import type { EntityManifest } from '@we/backend-shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installJsonValues } from './jsonValues';

@Model({ name: 'JsonThing' })
class JsonThing extends Ad4mModel {
  @Property({ through: 'test://title' })
  title: string = '';

  @Property({ through: 'test://items' })
  items?: unknown;

  @Property({ through: 'test://settings' })
  settings?: unknown;
}

const PREDICATES: Record<string, string> = {
  'test://title': 'title',
  'test://items': 'items',
  'test://settings': 'settings',
};

const MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    JsonThing: {
      properties: {
        title: { type: 'string', predicate: 'test://title' },
        items: { type: 'json', predicate: 'test://items' },
        settings: { type: 'json', predicate: 'test://settings' },
      },
      relations: {},
    },
  },
};

/** What the executor holds: each record's targets, by property. */
const stored = new Map<string, Record<string, unknown>>();

/** A target as the executor hydrates it — `literal:` parsed, anything else as it is. */
const hydrated = (target: unknown) =>
  typeof target === 'string' && target.startsWith('literal:') ? (Literal.fromUrl(target).get() as unknown) : target;

const perspective = {
  uuid: 'p',
  createBatch: () => Promise.resolve('batch'),
  commitBatch: () => Promise.resolve(),
  discardBatch: () => Promise.resolve(),
  createSubject: (_cls: unknown, id: string, initial?: Record<string, unknown>) => {
    stored.set(id, { ...(initial ?? {}) });
    return Promise.resolve();
  },
  executeAction: (
    commands: { action: string; predicate: string; target: string }[],
    id: string,
    params: { name: string; value: unknown }[],
  ) => {
    const row = stored.get(id) ?? {};
    for (const command of commands) {
      const field = PREDICATES[command.predicate];
      if (!field) continue;
      if (command.action === 'removeLink') delete row[field];
      else row[field] = params.find((p) => p.name === command.target)?.value;
    }
    stored.set(id, row);
    return Promise.resolve();
  },
  modelQuery: (_className: string, queryJson: string) => {
    const query = JSON.parse(queryJson) as { where?: { id?: string } };
    const rows = [...stored.entries()]
      .filter(([id]) => !query.where?.id || id === query.where.id)
      .map(([id, row]) => ({
        id,
        ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, hydrated(v)])),
      }));
    return Promise.resolve({ instances: rows, totalCount: rows.length });
  },
};

const p = perspective as never;

describe('json properties on AD4M', () => {
  beforeAll(() => installJsonValues(Ad4mModel, MANIFEST));
  beforeEach(() => stored.clear());

  it('stores a list and an object as one literal:json: target each, and reads them back as values', async () => {
    const made = await JsonThing.create(p, { title: 'One', items: ['a', 'b'], settings: { call: { on: true } } });
    const row = stored.get(made.id)!;
    expect(row.items).toBe(Literal.from(['a', 'b']).toUrl());
    expect(row.settings).toBe(Literal.from({ call: { on: true } }).toUrl());
    // The instance a create answers with holds the values, not their stored form.
    expect(made.items).toEqual(['a', 'b']);

    const read = await JsonThing.findOne(p, { where: { id: made.id } });
    expect(read?.items).toEqual(['a', 'b']);
    expect(read?.settings).toEqual({ call: { on: true } });
  });

  it('saves a reordered list, which the model layer would compare as a set', async () => {
    const made = await JsonThing.create(p, { title: 'Order', items: ['a', 'b'] });
    await JsonThing.update(p, made.id, { items: ['b', 'a'] });
    expect((await JsonThing.findOne(p, { where: { id: made.id } }))?.items).toEqual(['b', 'a']);
  });

  it('saves a value changed in place, and writes nothing when the value is the same', async () => {
    const made = await JsonThing.create(p, { title: 'Same', settings: { a: 1 } });
    const read = (await JsonThing.findOne(p, { where: { id: made.id } }))!;
    expect(read.changedFields()).toEqual([]);
    (read.settings as Record<string, number>).a = 2;
    expect(read.changedFields()).toEqual(['settings']);
    await read.save();
    expect((await JsonThing.findOne(p, { where: { id: made.id } }))?.settings).toEqual({ a: 2 });
  });

  it('keeps an empty list, which is a value, and clears on an empty write', async () => {
    const made = await JsonThing.create(p, { title: 'Empty', items: [] });
    expect((await JsonThing.findOne(p, { where: { id: made.id } }))?.items).toEqual([]);
    await JsonThing.update(p, made.id, { items: '' });
    expect(stored.get(made.id)).not.toHaveProperty('items');
  });

  it('takes text as JSON, and refuses text that is not', async () => {
    const made = await JsonThing.create(p, { title: 'Text', items: '["x"]' });
    expect((await JsonThing.findOne(p, { where: { id: made.id } }))?.items).toEqual(['x']);
    await expect(JsonThing.create(p, { title: 'Bad', items: 'not json' })).rejects.toThrow(/not JSON/);
  });

  it('reads stored text that is not JSON as absent, reporting it once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stored.set('legacy-1', { title: 'Old', items: 'not json' });
    stored.set('legacy-2', { title: 'Old', items: 'not json either' });
    const rows = await JsonThing.findAll(p, {});
    expect(rows.map((r) => r.items)).toEqual([undefined, undefined]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
