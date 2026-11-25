/**
 * The space store's extraction part: each asked-about collection's own answer, read live and deferring
 * to the space's default where it has none; who may change the space's own; and the space's defaults,
 * narrowed to what could be extracted and written whole.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { CollectionBlock, Space } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, describe, expect, it } from 'vitest';

import { createSpaceExtraction, type SpaceExtraction } from '../src/shared/stores/space/extraction';
import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { createSpaceWrites } from '../src/shared/stores/space/writes';
import { flush, reactivityPorts, type SpaceHarness, spaceHarness } from './support/spaceParts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  interface Built {
    h: SpaceHarness;
    spaces: SpaceList;
    extraction: SpaceExtraction;
    setOnScreen: Setter<Space | null>;
    setRoot: Setter<string>;
    admin: { yes: boolean };
    collections: { own: string; inherits: string };
  }

  async function build(space: Partial<Space> = {}): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-b', name: 'Bakery' },
    ]);
    const handle = (await h.datasets.get('ds-a')).handle;
    await Space.create(handle, { uuid: 'ds-a', name: 'The Allotment', ...space });
    await Space.create((await h.datasets.get('ds-b')).handle, {
      uuid: 'ds-b',
      name: 'The Bakery',
      autoInterpret: false,
    });
    const own = (await CollectionBlock.create(handle, { kind: 'call', autoExtract: true })).id;
    const inherits = (await CollectionBlock.create(handle, { kind: 'call' })).id;
    const { reactivity } = h;
    const admin = { yes: true };
    let spaces!: SpaceList;
    let extraction!: SpaceExtraction;
    let setOnScreen!: Setter<Space | null>;
    let setRoot!: Setter<string>;
    disposers.push(
      reactivity.root(() => {
        const [onScreen, writeOnScreen] = reactivity.signal<Space | null>(null);
        const [root, writeRoot] = reactivity.signal('');
        setOnScreen = writeOnScreen;
        setRoot = writeRoot;
        spaces = createSpaceList({
          ...h.ctx,
          routeStore: { segments: () => [], navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
          newSpace: {
            enableView: () => Promise.resolve(),
            writeAdminGrant: () => Promise.resolve(),
            writeStartingPolicy: () => Promise.resolve(),
          },
        });
        const writes = createSpaceWrites({
          ...h.ctx,
          spaces,
          onScreen: { current: onScreen, show: () => {} },
        });
        extraction = createSpaceExtraction({
          ...h.ctx,
          shapeStore: {
            interpretationCandidates: () => ['TaskBlock', 'EventBlock', 'NoteBlock'],
            interpretationCandidatesLoaded: () => true,
            interpretationCandidatesFor: () => Promise.resolve({ candidates: [], installed: [] }),
            provideInterpretationEnroller: () => () => {},
          } as never,
          spaces,
          navigation: { members: { currentSpace: onScreen, root } },
          writes,
          canAdministerCurrentSpace: () => admin.yes,
        });
      }),
    );
    await spaces.members.loadSpaces();
    h.datasets.show('ds-a');
    setOnScreen(spaces.heldSpace(await h.datasets.get('ds-a'))!);
    return { h, spaces, extraction, setOnScreen, setRoot, admin, collections: { own, inherits } };
  }

  it('answers false for a collection until its own answer is read, then gives it', async () => {
    const { extraction, collections } = await build({ autoInterpret: false });
    expect(extraction.members.autoInterpretFor(collections.own)).toBe(false);
    await flush();
    expect(extraction.members.autoInterpretFor(collections.own)).toBe(true);
    // Made without an answer of its own: the space's default, which says no.
    expect(extraction.members.autoInterpretFor(collections.inherits)).toBe(false);
  });

  it('defers to the space’s default for a collection made without its own', async () => {
    const { extraction, collections } = await build({ autoInterpret: true });
    extraction.members.autoInterpretFor(collections.inherits);
    await flush();
    expect(extraction.members.autoInterpretFor(collections.inherits)).toBe(true);
    expect(extraction.members.autoInterpret()).toBe(true);
  });

  it('forgets what it read about the last space’s collections when the space changes', async () => {
    const { h, spaces, extraction, collections, setOnScreen } = await build();
    extraction.members.autoInterpretFor(collections.own);
    await flush();
    expect(extraction.members.autoInterpretFor(collections.own)).toBe(true);
    h.datasets.show('ds-b');
    setOnScreen(spaces.heldSpace(await h.datasets.get('ds-b'))!);
    expect(extraction.members.autoInterpretFor(collections.own)).toBe(false);
    await flush();
    // Not in this space: nothing of its own here, and this space's default says no.
    expect(extraction.members.autoInterpretFor(collections.own)).toBe(false);
  });

  it('shows a switch on the press and stores it; the space’s own is its administrators’', async () => {
    const { h, extraction, collections, setRoot, admin } = await build();
    extraction.members.autoInterpretFor(collections.inherits);
    await flush();
    const press = extraction.members.setAutoInterpretFor(collections.inherits, true);
    expect(extraction.members.autoInterpretFor(collections.inherits)).toBe(true);
    await press;
    const stored = await CollectionBlock.findOne((await h.datasets.get('ds-a')).handle, {
      where: { id: collections.inherits },
    });
    expect(stored?.autoExtract).toBe(true);

    setRoot(collections.own);
    admin.yes = false;
    expect(extraction.members.canSetInterpretationFor(collections.own)).toBe(false);
    expect(extraction.members.canSetInterpretationFor(collections.inherits)).toBe(true);
    await extraction.members.setAutoInterpretFor(collections.own, false);
    expect(h.toasts.said.at(-1)).toContain('Only someone who administers this space');
  });

  it('narrows the space’s list to what could be extracted, and writes each switch on the one before', async () => {
    const { extraction, spaces, h } = await build({ extractionTargets: ['TaskBlock', 'Retired'] as never });
    expect(extraction.members.interpretationTargets()).toEqual(['TaskBlock']);
    await Promise.all([
      extraction.members.setInterpretationTarget('EventBlock', true),
      extraction.members.setInterpretationTarget('NoteBlock', true),
    ]);
    const ds = await h.datasets.get('ds-a');
    const [stored] = await Space.findAll(ds.handle, {});
    expect(stored.extractionTargets).toEqual(['TaskBlock', 'Retired', 'EventBlock', 'NoteBlock']);
    expect(spaces.heldSpace(ds)?.extractionTargets).toEqual(['TaskBlock', 'Retired', 'EventBlock', 'NoteBlock']);
  });
});
