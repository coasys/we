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

describe('opening the panel', () => {
  it('makes the root folder, so every write it offers has an anchor', async () => {
    // Before this, the folder was made by the first *gather* — leaving an open, empty Pocket whose
    // "New folder" button wrote with no parent, which the executor refuses as an empty link source.
    const { deps: d, data } = deps();
    const store = createPocketStore(d);

    store.show();
    await vi.waitFor(() => expect(data.rows.PocketFolder).toHaveLength(1));
    expect(store.open()).toBe(true);
  });

  it('makes it once, however many times the panel is opened', async () => {
    const { deps: d, data } = deps();
    const store = createPocketStore(d);

    store.show();
    await vi.waitFor(() => expect(data.rows.PocketFolder).toHaveLength(1));
    store.close();
    store.toggle();
    await vi.waitFor(() => expect(data.rows.PocketFolder).toHaveLength(1));
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

/**
 * Where you are in the Pocket, and the way back out.
 *
 * The reported bug: creating a folder, entering it, and finding no way to leave. It was one fact
 * held as two values — a `folderId` that was `''` at the root because the root's id lived only in a
 * template expression, and a `trail` that therefore never got its first entry, so the back button
 * (gated on the trail being non-empty) never appeared. These pin the single-list replacement.
 */
describe('moving between folders', () => {
  const opened = async () => {
    const { deps: d, data } = deps();
    const store = createPocketStore(d);
    store.show();
    // `show` resolves the root off the port; one turn of the microtask queue settles it.
    await Promise.resolve();
    await Promise.resolve();
    return { store, data };
  };

  it('starts at the root, with the root actually in the path', async () => {
    const { store } = await opened();

    expect(store.crumbs()).toHaveLength(1);
    expect(store.folderId()).toBe('PocketFolder-1');
    // The whole bug in one assertion: an anchor exists before anybody navigates anywhere.
    expect(store.folderId()).not.toBe('');
  });

  it('offers no way back from the root, and refuses to leave it', async () => {
    const { store } = await opened();
    store.up();

    expect(store.canGoUp()).toBe(false);
    expect(store.folderId()).toBe('PocketFolder-1');
  });

  it('can be left again once entered — which it could not before', async () => {
    const { store } = await opened();
    store.enter('PocketFolder-2', 'Reading');

    expect(store.canGoUp()).toBe(true);
    expect(store.folderId()).toBe('PocketFolder-2');

    store.up();
    expect(store.folderId()).toBe('PocketFolder-1');
    expect(store.canGoUp()).toBe(false);
  });

  it('labels each crumb with its own folder, not with the one it was entered from', async () => {
    // The off-by-one in the old pair: `enter(id, name)` pushed the *entered* folder's name as the
    // label for the folder being *left*, so every crumb named the wrong place.
    const { store } = await opened();
    store.enter('PocketFolder-2', 'Reading');
    store.enter('PocketFolder-3', 'Later');

    expect(store.crumbs().map((c) => c.name)).toEqual(['Pocket', 'Reading', 'Later']);
  });

  it('jumps back several levels at once', async () => {
    const { store } = await opened();
    store.enter('PocketFolder-2', 'Reading');
    store.enter('PocketFolder-3', 'Later');
    store.goToCrumb(0);

    expect(store.folderId()).toBe('PocketFolder-1');
    expect(store.crumbs()).toHaveLength(1);
  });

  it('does nothing when the crumb pressed is the one already open', async () => {
    const { store } = await opened();
    store.enter('PocketFolder-2', 'Reading');
    store.goToCrumb(1);

    expect(store.crumbs()).toHaveLength(2);
    expect(store.folderId()).toBe('PocketFolder-2');
  });

  it('puts you back where you were when the panel is re-opened', async () => {
    const { store } = await opened();
    store.enter('PocketFolder-2', 'Reading');
    store.close();
    store.show();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.folderId()).toBe('PocketFolder-2');
  });

  it('gathers into the folder being looked at', async () => {
    const { store, data } = await opened();
    store.enter('PocketFolder-2', 'Reading');
    await store.gather(drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));

    expect(data.parents[data.rows.PocketItem[0].id as string]).toBe('PocketFolder-2');
  });

  it('files into a folder that is not open, which is what a folder drop zone does', async () => {
    const { store, data } = await opened();
    await store.gatherInto('PocketFolder-7', drop({ entity: 'CollectionBlock', id: 'ad4m://obj/abc' }));

    expect(data.parents[data.rows.PocketItem[0].id as string]).toBe('PocketFolder-7');
    // …without moving you.
    expect(store.folderId()).toBe('PocketFolder-1');
  });
});

/**
 * The picture on a gathered row.
 *
 * A post has no thumbnail field and does not need one: the document it carries already holds the
 * image, and it is read here — once, at gather time — rather than parsed per frame by a panel or
 * denormalised onto `CollectionBlock`.
 */
describe('the snapshot a row keeps', () => {
  const withPreview = (preview: Record<string, unknown>) => ({
    items: [{ ref: { entity: 'CollectionBlock', id: 'ad4m://obj/abc' }, label: 'A post', preview }],
  });

  const document = (blocks: unknown[]) => JSON.stringify({ _type: 'document', blocks });

  it('keeps a picture the source gave outright', async () => {
    const { deps: d, data } = deps();
    await createPocketStore(d).gather(withPreview({ thumbnail: 'we-file://cover.jpg' }));

    expect(data.rows.PocketItem[0].thumbnail).toBe('we-file://cover.jpg');
  });

  it('takes one out of a composed post, which carries no thumbnail of its own', async () => {
    const { deps: d, data } = deps();
    await createPocketStore(d).gather(
      withPreview({
        content: document([
          { _type: 'block', text: 'Look at this' },
          { _type: 'image', src: 'we-file://photo.jpg' },
        ]),
      }),
    );

    expect(data.rows.PocketItem[0].thumbnail).toBe('we-file://photo.jpg');
  });

  it('looks inside a nested collection, where an image is still the picture', async () => {
    const { deps: d, data } = deps();
    await createPocketStore(d).gather(
      withPreview({
        content: document([{ _type: 'collection', content: [{ _type: 'video', thumbnail: 'we-file://still.jpg' }] }]),
      }),
    );

    expect(data.rows.PocketItem[0].thumbnail).toBe('we-file://still.jpg');
  });

  it('never stores the document itself', async () => {
    // Copying post bodies out of the spaces they were shared in is the problem that makes sharing a
    // folder a matter of sending references. The picture is taken; the rest is dropped.
    const { deps: d, data } = deps();
    const content = document([{ _type: 'block', text: 'Something private' }]);
    await createPocketStore(d).gather(withPreview({ content }));

    expect(JSON.stringify(data.rows.PocketItem[0])).not.toContain('Something private');
  });

  it('degrades to no picture on a document it cannot read', async () => {
    // Written by a version that shaped it differently. A row with an icon, not a thrown gather.
    const { deps: d, data } = deps();
    await createPocketStore(d).gather(withPreview({ content: 'not json' }));

    expect(data.rows.PocketItem[0].thumbnail).toBe('');
  });

  it('keeps the author, so a tile can draw a face beside the name', async () => {
    const { deps: d, data } = deps();
    await createPocketStore(d).gather(withPreview({ author: 'did:key:z6Mkabc' }));

    expect(data.rows.PocketItem[0].sourceAuthor).toBe('did:key:z6Mkabc');
  });
});
