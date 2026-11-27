/**
 * The space store's details part: the space's own record — its name and description, the template
 * and theme it opens with, how deep its conversations go, what a chosen picture is stored as — and
 * its members, read once the first screen is up.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import type { AgentProfileSummary } from '@we/backend-shared';
import { Space } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, describe, expect, it } from 'vitest';

import { createSpaceDetails, type SpaceDetails } from '../src/shared/stores/space/details';
import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { createSpaceWrites } from '../src/shared/stores/space/writes';
import { reactivityPorts } from './support/engines';
import { flush, ME, type SpaceHarness, spaceHarness } from './support/spaceParts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  interface Built {
    h: SpaceHarness;
    spaces: SpaceList;
    details: SpaceDetails;
    setOnScreen: Setter<Space | null>;
    openFirstScreen: () => void;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [{ id: 'ds-a', name: 'Allotment' }]);
    await Space.create((await h.datasets.get('ds-a')).handle, { uuid: 'ds-a', name: 'The Allotment' });
    const { reactivity } = h;
    let spaces!: SpaceList;
    let details!: SpaceDetails;
    let setOnScreen!: Setter<Space | null>;
    let openFirstScreen!: () => void;
    disposers.push(
      reactivity.root(() => {
        const [onScreen, writeOnScreen] = reactivity.signal<Space | null>(null);
        const [open, setOpen] = reactivity.signal(false);
        const [profiles] = reactivity.signal<AgentProfileSummary[]>([{ did: ME, name: 'Me' } as AgentProfileSummary]);
        setOnScreen = writeOnScreen;
        openFirstScreen = () => setOpen(true);
        const ctx = { ...h.ctx, firstScreen: { open, whenOpen: () => Promise.resolve() } };
        spaces = createSpaceList({
          ...ctx,
          routeStore: { segments: () => [], navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
        });
        const writes = createSpaceWrites({
          ...ctx,
          spaces,
          onScreen: {
            currentSpace: onScreen,
            showOnScreen: (_ds, fields) => writeOnScreen({ ...reactivity.untrack(onScreen), ...fields } as Space),
          },
        });
        details = createSpaceDetails({
          ...ctx,
          profileStore: { profiles, fetchProfile: () => Promise.resolve(undefined) } as never,
          spaces,
          onScreen: { currentSpace: onScreen },
          writes,
        });
      }),
    );
    await spaces.members.loadSpaces();
    h.datasets.show('ds-a');
    setOnScreen(spaces.heldSpace(await h.datasets.get('ds-a'))!);
    await flush();
    return { h, spaces, details, setOnScreen, openFirstScreen };
  }

  it('lists this agent alone until the first screen is up, then the space’s members', async () => {
    const { details, openFirstScreen } = await build();
    expect(details.members.memberDids()).toEqual([ME]);
    openFirstScreen();
    await flush();
    expect(details.members.memberDids()[0]).toBe(ME);
    expect(details.members.members().map((m) => m.did)).toEqual([ME]);
  });

  it('reads the space on screen’s defaults off its record', async () => {
    const { h, spaces, details, setOnScreen } = await build();
    expect(details.members.spaceDefaultTemplateId()).toBe('');
    const ds = await h.datasets.get('ds-a');
    setOnScreen({ ...spaces.heldSpace(ds)!, defaultTemplateId: 'tpl-garden', defaultThemeId: 'theme-moss' } as Space);
    expect(details.members.spaceDefaultTemplateId()).toBe('tpl-garden');
    expect(details.members.spaceDefaultThemeId()).toBe('theme-moss');
  });

  it('makes a chosen picture into what the record stores, sized for an avatar, and stores nothing', async () => {
    const { h, details } = await build();
    const picture = new File([new Uint8Array([137, 80, 78, 71])], 'me.png', { type: 'image/png' });
    const prepared = await details.members.prepareSpaceImage('avatar', picture);
    expect(prepared).toMatchObject({ name: 'space-image', file_type: 'image/png' });
    expect(typeof prepared.data_base64).toBe('string');
    await expect(details.members.prepareSpaceImage('coverImage', new File(['x'], 'a.txt'))).rejects.toThrow();
    const [stored] = await Space.findAll((await h.datasets.get('ds-a')).handle);
    expect(stored.avatar ?? '').toBe('');
  });

  it('writes how deep conversations go, and the space’s name, onto its record', async () => {
    const { h, spaces, details } = await build();
    await details.members.setThreadMode('flat');
    await details.members.setThreadMode('anything else');
    await details.members.updateSpaceMeta({ name: 'The Big Allotment' });
    const ds = await h.datasets.get('ds-a');
    const [stored] = await Space.findAll(ds.handle);
    expect(stored.threadMode).toBe('fractal');
    expect(stored.name).toBe('The Big Allotment');
    expect(spaces.heldSpace(ds)?.name).toBe('The Big Allotment');
  });
});
