/**
 * How a setting on a space record is written: published onto the held record and the space on screen,
 * reported when it cannot be stored, and — for a save shown before it lands — held over the live read
 * until it does, then let go.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { Space } from '@we/entities';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { createSpaceWrites, type SpaceWrites } from '../src/shared/stores/space/writes';
import { reactivityPorts } from './support/engines';
import { flush, type SpaceHarness, spaceHarness } from './support/spaceParts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dispose of disposers.splice(0)) dispose();
  });

  async function build(): Promise<{ h: SpaceHarness; spaces: SpaceList; writes: SpaceWrites; shown: string[] }> {
    const h = await spaceHarness(makePort(), [{ id: 'ds-a', name: 'Allotment' }]);
    await Space.create((await h.datasets.get('ds-a')).handle, { uuid: 'ds-a', name: 'The Allotment' });
    const shown: string[] = [];
    let spaces!: SpaceList;
    let writes!: SpaceWrites;
    disposers.push(
      h.reactivity.root(() => {
        spaces = createSpaceList({
          ...h.ctx,
          routeStore: { segments: () => [], navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
        });
        writes = createSpaceWrites({
          ...h.ctx,
          spaces,
          onScreen: {
            currentSpace: () => null,
            showOnScreen: (_ds, fields) => void shown.push(JSON.stringify(fields)),
          },
        });
      }),
    );
    await spaces.members.loadSpaces();
    return { h, spaces, writes, shown };
  }

  it('stores fields and shows them on the held record and the space on screen', async () => {
    const { h, spaces, writes, shown } = await build();
    h.datasets.show('ds-a');
    const ds = await h.datasets.get('ds-a');
    await writes.writeSpaceFields(ds, spaces.heldSpace(ds)!, { threadMode: 'flat' });
    expect(spaces.heldSpace(ds)?.threadMode).toBe('flat');
    expect(shown).toEqual(['{"threadMode":"flat"}']);
    const [stored] = await Space.findAll(ds.handle, {});
    expect(stored.threadMode).toBe('flat');
  });

  it('says a write that could not be stored, and shows nothing', async () => {
    const { h, spaces, writes, shown } = await build();
    const ds = await h.datasets.get('ds-a');
    const held = spaces.heldSpace(ds)!;
    // A dataset the backend cannot write to: its handle names nothing it holds.
    await expect(
      writes.writeSpaceFields({ ...ds, handle: null as never }, held, { threadMode: 'flat' }),
    ).rejects.toThrow();
    expect(h.toasts.said).toEqual(['error: Could not save this change for the space.']);
    expect(shown).toEqual([]);
  });

  it('holds a default being saved over the live read until the last save of it ends', async () => {
    const { h, writes } = await build();
    const ds = await h.datasets.get('ds-a');
    const first = writes.defaultSaveFor(ds, 'defaultTemplateId');
    first.value = 'one';
    first.pending += 1;
    const second = writes.defaultSaveFor(ds, 'defaultTemplateId');
    expect(second).toBe(first);
    second.value = 'two';
    second.pending += 1;
    expect(writes.pendingDefaults(ds)).toEqual({ defaultTemplateId: 'two' });
    writes.endDefaultSave(first);
    expect(writes.pendingDefaults(ds)).toEqual({ defaultTemplateId: 'two' });
    writes.endDefaultSave(second);
    expect(writes.pendingDefaults(ds)).toEqual({});
  });

  it('runs a default’s writes in the order they were asked, whether or not one fails', async () => {
    const { h, writes } = await build();
    const ds = await h.datasets.get('ds-a');
    const save = writes.defaultSaveFor(ds, 'defaultThemeId');
    const ran: string[] = [];
    let release!: () => void;
    const slow = writes.queueDefaultWrite(
      save,
      () =>
        new Promise<void>((_resolve, reject) => {
          release = () => {
            ran.push('first');
            reject(new Error('refused'));
          };
        }),
    );
    const next = writes.queueDefaultWrite(save, () => Promise.resolve(void ran.push('second')));
    await flush();
    expect(ran).toEqual([]);
    release();
    await expect(slow).rejects.toThrow('refused');
    await next;
    expect(ran).toEqual(['first', 'second']);
  });
});
