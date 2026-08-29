/**
 * What the Pocket's store does that a template could not.
 *
 * Almost all of it is one question — what reference gets written down — and the cases below are the
 * ones where getting it wrong is invisible: a personal space's key silently claiming to be portable,
 * a drag out of the Pocket being re-stamped with wherever you happen to be, and the same thing
 * gathered twice becoming two rows.
 */
import type { ModuleStoreDeps } from '@we/module-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPocketStore } from './store';

/** A stand-in root dataset: an array per entity, and a record of what was asked of it. */
function fakeAgentData() {
  const rows: Record<string, Record<string, unknown>[]> = { PocketFolder: [], PocketItem: [] };
  const parents: Record<string, string> = {};
  let next = 0;
  return {
    rows,
    parents,
    port: {
      ready: () => true,
      create: async (entity: string, fields: Record<string, unknown>, options?: { parent?: { id: string } }) => {
        const id = `${entity}-${++next}`;
        rows[entity] = [...(rows[entity] ?? []), { id, ...fields }];
        if (options?.parent) parents[id] = options.parent.id;
        return id;
      },
      find: async (entity: string, query?: { where?: Record<string, unknown>; limit?: number }) => {
        const where = query?.where ?? {};
        const matched = (rows[entity] ?? []).filter((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        );
        return query?.limit ? matched.slice(0, query.limit) : matched;
      },
      remove: async (entity: string, id: string) => {
        rows[entity] = (rows[entity] ?? []).filter((row) => row.id !== id);
      },
    },
  };
}

function deps(overrides: Partial<ModuleStoreDeps> = {}): {
  deps: ModuleStoreDeps;
  data: ReturnType<typeof fakeAgentData>;
} {
  const data = fakeAgentData();
  return {
    data,
    deps: {
      signal: <T>(initial: T): [() => T, (next: T) => void] => {
        let value = initial;
        return [() => value, (next: T) => void (value = next)];
      },
      agentData: data.port,
      datasetRefKey: () => 'n:QmSpace',
      datasetUri: () => 'neighbourhood://QmSpace',
      datasets: { get: () => ({ name: 'Design' }), open: vi.fn(), openRef: vi.fn() },
      ...overrides,
    } as ModuleStoreDeps,
  };
}

const drop = (ref: { entity: string; id: string; dataset?: string }, label = 'A post') => ({
  items: [{ ref, label, icon: 'newspaper' }],
});

let clock: number;
beforeEach(() => {
  clock = 0;
  vi.restoreAllMocks();
  vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => `2026-08-28T00:00:0${clock++}.000Z`);
});

describe('what gets written down', () => {
  it('stamps the dataset the drop happened in, which the source could not know', async () => {
    const { deps: d, data } = deps();
    const store = createPocketStore(d);

    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));

    const [item] = data.rows.PocketItem;
    expect(item.ref).toBe('we:n:QmSpace/CollectionBlock/ad4m://obj/abc');
    expect(item.sourceName).toBe('Design');
  });

  it('writes the reference apart as well as whole, so a row can be dragged back out', async () => {
    // A template cannot parse a string, and teaching the design system what a record URI is would
    // be a dependency pointing the wrong way.
    const { deps: d, data } = deps();
    await createPocketStore(d).gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));

    const [item] = data.rows.PocketItem;
    expect(item.datasetKey).toBe('n:QmSpace');
    expect(item.recordId).toBe('ad4m://obj/abc');
    expect(item.entity).toBe('CollectionBlock');
  });

  it('keeps the dataset a source named, rather than re-stamping it', async () => {
    // Dragging a row *out* of the Pocket and into a composition: the row already knows where it
    // came from, and assuming "wherever we are now" would rewrite what it points at.
    const { deps: d, data } = deps();
    await createPocketStore(d).gather(drop({ entity: 'TextBlock', id: 'ad4m://obj/xyz', dataset: 'n:QmElsewhere' }));

    expect(data.rows.PocketItem[0].ref).toBe('we:n:QmElsewhere/TextBlock/ad4m://obj/xyz');
  });

  it('gives a person their own form, since an agent is in no dataset', async () => {
    const { deps: d, data } = deps();
    await createPocketStore(d).gather(drop({ entity: 'Agent', id: 'did:key:z6Mkabc' }, 'Anna'));

    expect(data.rows.PocketItem[0].ref).toBe('we:agent/did:key:z6Mkabc');
  });

  it('writes nothing when there is no dataset to name', async () => {
    // Boot, or a screen with no space open. A half-formed reference is worse than no row: it looks
    // gathered and resolves to nothing.
    const { deps: d, data } = deps({ datasetRefKey: () => '' });
    await createPocketStore(d).gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));

    expect(data.rows.PocketItem).toHaveLength(0);
  });
});

describe('gathering twice', () => {
  it('is a no-op rather than a second row', async () => {
    const { deps: d, data } = deps();
    const store = createPocketStore(d);

    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));
    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));

    expect(data.rows.PocketItem).toHaveLength(1);
  });

  it('reports what is held, so a card can say it already has been', async () => {
    const { deps: d } = deps();
    const store = createPocketStore(d);

    expect(store.holds('we:n:QmSpace/CollectionBlock/ad4m://obj/abc')).toBe(false);
    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));
    expect(store.holds('we:n:QmSpace/CollectionBlock/ad4m://obj/abc')).toBe(true);
  });
});

describe('the root folder', () => {
  it('is made on the first gather, and only once', async () => {
    const { deps: d, data } = deps();
    const store = createPocketStore(d);

    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/a' }));
    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/b' }));

    expect(data.rows.PocketFolder).toHaveLength(1);
    expect(data.rows.PocketFolder[0].root).toBe(true);
    // Both items hang off it.
    expect(Object.values(data.parents)).toEqual([data.rows.PocketFolder[0].id, data.rows.PocketFolder[0].id]);
  });

  it('puts a gather into whichever folder is open', async () => {
    const { deps: d, data } = deps();
    const store = createPocketStore(d);
    store.enter('PocketFolder-99', 'Reading');

    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/a' }));

    expect(Object.values(data.parents)).toEqual(['PocketFolder-99']);
    // No root was needed, so none was made.
    expect(data.rows.PocketFolder).toHaveLength(0);
  });
});

describe('taking something out', () => {
  it('removes the row and stops claiming to hold it', async () => {
    const { deps: d, data } = deps();
    const store = createPocketStore(d);
    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));

    await store.forget(data.rows.PocketItem[0].id as string);

    expect(data.rows.PocketItem).toHaveLength(0);
    expect(store.holds('we:n:QmSpace/CollectionBlock/ad4m://obj/abc')).toBe(false);
  });
});

describe('going to what you gathered', () => {
  const withNav = () => {
    const openRef = vi.fn();
    const { deps: d } = deps({ datasets: { get: () => undefined, open: vi.fn(), openRef } });
    return { store: createPocketStore(d), openRef };
  };

  it('hands the whole reference to the host, which knows where a record lives', () => {
    // Not the dataset id: a module restating `/space/<segment>/record/<Entity>?id=<id>` would be a
    // second copy of a route that has drifted from itself once already.
    const { store, openRef } = withNav();
    store.goTo('we:n:QmElsewhere/CollectionBlock/ad4m://obj/abc');

    expect(openRef).toHaveBeenCalledWith('we:n:QmElsewhere/CollectionBlock/ad4m://obj/abc');
  });

  it('hands over a gathered space the same way — the host opens the space itself', () => {
    const { store, openRef } = withNav();
    store.goTo('we:n:QmElsewhere');

    expect(openRef).toHaveBeenCalledWith('we:n:QmElsewhere');
  });

  it('offers nothing for a person, who has no page to go to', () => {
    const { store, openRef } = withNav();

    expect(store.canOpen('we:agent/did:key:z6Mkabc')).toBe(false);
    store.goTo('we:agent/did:key:z6Mkabc');
    expect(openRef).not.toHaveBeenCalled();
  });

  it('offers nothing for a relative reference, which has no anchor here', () => {
    // `we:./…` means "the dataset this is read in", and the Pocket is not a record.
    const { store, openRef } = withNav();

    expect(store.canOpen('we:./TextBlock/ad4m://obj/abc')).toBe(false);
    store.goTo('we:./TextBlock/ad4m://obj/abc');
    expect(openRef).not.toHaveBeenCalled();
  });

  it('does nothing at all for a reference it cannot read', () => {
    const { store, openRef } = withNav();
    store.goTo('not a reference');
    expect(openRef).not.toHaveBeenCalled();
  });
});

describe('degrading', () => {
  it('writes nothing on a host with no agent dataset, rather than throwing', async () => {
    // Boot, or a presentation-only host. A module must degrade when a port is absent.
    const { deps: d } = deps({ agentData: undefined });
    const store = createPocketStore(d);

    await expect(store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }))).resolves.toBeUndefined();
    expect(store.refs()).toEqual([]);
  });
});
