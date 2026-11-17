/**
 * The records kernel's reads resolve their class per dataset.
 *
 * A class a community defined for its own space is registered *per dataset*, not in WE's global
 * registry — that is how two spaces can each have a `Sighting` — and a read that looked only at the
 * global one threw `Model "ActionItem" not found in registry` while the rows sat in the space. In
 * the Feed, whose activity finds run in one `Promise.all`, that one class was the whole Feed in
 * every space with its own SHACL classes.
 */
import {
  type EntityClass,
  mergeDynamicEntities,
  registerDynamicEntities,
  registerEntity,
  unregisterEntity,
} from '@we/entities';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findEntityRows, subscribeEntityRows } from '../src/shared/recordsRead';

/** A uuid no space's sweep will claim, so these registrations cannot leak into a neighbouring test. */
const UUID = 'recordsRead-test';
const dataset = { uuid: UUID };

/** A class as a space's own SHACL shape registers one — the query surface a records read uses. */
function foreignModel(rows: Record<string, unknown>[], dispose?: () => void): EntityClass {
  const model = class {};
  Object.assign(model, {
    findAll: async () => rows,
    query: () => ({ subscribe: async () => rows, dispose: dispose ?? (() => {}) }),
  });
  return model as unknown as EntityClass;
}

afterEach(() => {
  // `registerDynamicEntities` replaces the perspective's map, which is also how one is cleared.
  registerDynamicEntities(UUID, {});
  unregisterEntity('GlobalThing');
});

describe('a records read of a class the space defines itself', () => {
  it('find answers its rows, resolved from the dataset’s own registry', async () => {
    const rows = [{ id: 'item-1', title: 'Ship it' }];
    registerDynamicEntities(UUID, { ActionItem: foreignModel(rows) });

    await expect(findEntityRows('ActionItem', dataset, {})).resolves.toEqual(rows);
  });

  it('subscribe answers its rows and hands back the subscription’s dispose', async () => {
    const rows = [{ id: 'item-1' }];
    const dispose = vi.fn();
    mergeDynamicEntities(UUID, { ActionItem: foreignModel(rows, dispose) });

    const seen: Record<string, unknown>[][] = [];
    const stop = subscribeEntityRows('ActionItem', dataset, {}, (r) => seen.push(r));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual([rows]);
    stop();
    expect(dispose).toHaveBeenCalled();
  });

  it('still prefers WE’s own class where both registries hold the name', async () => {
    const native = foreignModel([{ id: 'native' }]);
    registerEntity('GlobalThing', native);
    registerDynamicEntities(UUID, { GlobalThing: foreignModel([{ id: 'foreign' }]) });

    await expect(findEntityRows('GlobalThing', dataset, {})).resolves.toEqual([{ id: 'native' }]);
  });
});

describe('a records read of a class neither registry holds', () => {
  it('a find rejects naming the class', async () => {
    await expect(findEntityRows('Nope', dataset, {})).rejects.toThrow(/Nope/);
  });

  it('a subscribe warns naming the class and answers a dispose — it cannot reject', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cb = vi.fn();

    const stop = subscribeEntityRows('Nope', dataset, {}, cb);

    expect(cb).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Nope'));
    expect(() => stop()).not.toThrow();
    warn.mockRestore();
  });
});
