/**
 * The space store's details part: the space's own record — its name and description, the template
 * and theme it opens with, how deep its conversations go — and its members, read once the first
 * screen is up.
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
import { flush, ME, reactivityPorts, type SpaceHarness, spaceHarness } from './support/spaceParts';

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
    themeExplained: { count: number };
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [{ id: 'ds-a', name: 'Allotment' }]);
    await Space.create((await h.datasets.get('ds-a')).handle, { uuid: 'ds-a', name: 'The Allotment' });
    const { reactivity } = h;
    const themeExplained = { count: 0 };
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
          newSpace: {
            enableView: () => Promise.resolve(),
            writeAdminGrant: () => Promise.resolve(),
            writeStartingPolicy: () => Promise.resolve(),
          },
        });
        const writes = createSpaceWrites({
          ...ctx,
          spaces,
          onScreen: {
            current: onScreen,
            show: (_ds, fields) => writeOnScreen({ ...reactivity.untrack(onScreen), ...fields } as Space),
          },
        });
        details = createSpaceDetails({
          ...ctx,
          profileStore: { profiles, fetchProfile: () => Promise.resolve(undefined) } as never,
          themeStore: { explainSpaceThemeHidden: () => void themeExplained.count++ },
          spaces,
          navigation: { members: { currentSpace: onScreen } },
          writes,
        });
      }),
    );
    await spaces.members.loadSpaces();
    h.datasets.show('ds-a');
    setOnScreen(spaces.heldSpace(await h.datasets.get('ds-a'))!);
    await flush();
    return { h, spaces, details, setOnScreen, openFirstScreen, themeExplained };
  }

  it('lists this agent alone until the first screen is up, then the space’s members', async () => {
    const { details, openFirstScreen } = await build();
    expect(details.members.memberDids()).toEqual([ME]);
    openFirstScreen();
    await flush();
    expect(details.members.memberDids()[0]).toBe(ME);
    expect(details.members.members().map((m) => m.did)).toEqual([ME]);
  });

  it('shows a new default template at once and stores it on the space', async () => {
    const { h, details } = await build();
    const saving = details.members.setSpaceDefaultTemplate('tpl-garden');
    expect(details.members.spaceDefaultTemplateId()).toBe('tpl-garden');
    await saving;
    const [stored] = await Space.findAll((await h.datasets.get('ds-a')).handle);
    expect(stored.defaultTemplateId).toBe('tpl-garden');
  });

  it('says why a theme is hidden when the default theme changes for the space on screen', async () => {
    const { details, themeExplained } = await build();
    await details.members.setSpaceDefaultTheme('theme-moss');
    expect(details.members.spaceDefaultThemeId()).toBe('theme-moss');
    expect(themeExplained.count).toBe(1);
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
