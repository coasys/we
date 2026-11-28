/**
 * The space store's spaces part: the records of the spaces the agent holds, read once the app is up
 * and merged with what is held, kept through a removal and a lock, and the share and join actions
 * that change them.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { Role, RoleGrant, Space } from '@we/entities';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_ROLE } from '../src/shared/spaceRoles';
import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { reactivityPorts } from './support/engines';
import { flush, ME, type SpaceHarness, spaceHarness } from './support/spaceParts';

const NO_DETAILS = () => ({
  canAdminister: false,
  modules: [],
  views: [],
  usesSections: true,
  templateOverride: '',
  themeOverride: '',
});

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  function build(h: SpaceHarness) {
    let spaces!: SpaceList;
    disposers.push(
      h.reactivity.root(() => {
        spaces = createSpaceList({
          ...h.ctx,
          routeStore: { segments: () => [], navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
        });
      }),
    );
    return spaces;
  }

  async function seeded() {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-b', name: 'Bakery' },
      { id: 'ds-root', name: 'we-root' },
    ]);
    await Space.create((await h.datasets.get('ds-b')).handle, { uuid: 'ds-b', name: 'The Bakery' });
    await Space.create((await h.datasets.get('ds-a')).handle, { uuid: 'ds-a', name: 'The Allotment' });
    return h;
  }

  it('reads each space’s record once the app is up, and says the list is in', async () => {
    const h = await seeded();
    const spaces = build(h);
    const row = (id: string) =>
      spaces.listRow(
        h.ctx.datasetStore.datasets().find((d) => d.id === id)!,
        NO_DETAILS,
      );

    expect(row('ds-a')).toMatchObject({ name: 'Allotment', kind: 'foreign', loading: true });
    await spaces.members.loadSpaces();
    expect(row('ds-a')).toMatchObject({ name: 'The Allotment', kind: 'personal', loading: false, isWeSpace: true });
    expect(spaces.members.orderedSidebarItems().map((item) => item.name)).toEqual(['The Allotment', 'The Bakery']);
    expect(
      spaces.members
        .mySpaces()
        .map((space) => space.uuid)
        .sort(),
    ).toEqual(['ds-a', 'ds-b']);
  });

  it('keeps a space it already holds over the one a later list read finds', async () => {
    const h = await seeded();
    const spaces = build(h);
    const ds = await h.datasets.get('ds-a');
    const [onScreen] = await Space.findAll(ds.handle, {});
    const newer = Object.assign(Object.create(Object.getPrototypeOf(onScreen) as object), onScreen, {
      name: 'Renamed on screen',
    }) as Space;
    spaces.holdSpace(newer, ds);
    await spaces.members.loadSpaces();
    expect(spaces.heldSpace(ds)?.name).toBe('Renamed on screen');
    expect(spaces.members.mySpaces().filter((space) => space.uuid === 'ds-a')).toHaveLength(1);
  });

  it('lets go of a removed space before telling whoever asked to hear of it', async () => {
    const h = await seeded();
    const spaces = build(h);
    await spaces.members.loadSpaces();
    const heard: string[][] = [];
    const stop = spaces.onRemoved(() => heard.push(spaces.members.mySpaces().map((s) => s.uuid)));
    await spaces.members.removeSpace('ds-a');
    expect(heard).toEqual([['ds-b']]);
    stop();
    await spaces.members.removeSpace('ds-b');
    expect(heard).toHaveLength(1);
  });

  it('forgets the spaces when the agent locks', async () => {
    const h = await seeded();
    const spaces = build(h);
    await spaces.members.loadSpaces();
    h.setBootState('login');
    expect(spaces.members.mySpaces()).toEqual([]);
    const row = spaces.listRow(h.ctx.datasetStore.datasets()[0], NO_DETAILS);
    expect(row.loading).toBe(true);
  });

  it('shares a space, and offers a failed share again from the toast', async () => {
    const h = await seeded();
    const spaces = build(h);
    await spaces.members.loadSpaces();
    const publish = vi.spyOn(h.ports.lifecycle, 'publish').mockRejectedValueOnce(new Error('no route'));

    await spaces.members.shareSpace('ds-a');
    const ds = () => h.ctx.datasetStore.datasets().find((d) => d.id === 'ds-a')!;
    expect(spaces.listRow(ds(), NO_DETAILS)).toMatchObject({ sharing: 'failed', shareError: 'no route' });
    expect(h.toasts.said).toEqual(['error: Could not share “The Allotment”. It is here, unshared.']);
    expect(h.toasts.actions.map((action) => action.label)).toEqual(['Try again']);

    h.toasts.actions[0].run();
    await flush();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(spaces.listRow(ds(), NO_DETAILS)).toMatchObject({ sharing: '', kind: 'shared' });
    const [stored] = await Space.findAll(ds().handle, {});
    expect(stored.url).toBe(ds().sharedId);
  });

  it('makes two presses on one join into one join, and goes to the space', async () => {
    const h = await seeded();
    const spaces = build(h);
    h.ports.lifecycle.seedShared({ id: 'ds-c', name: 'Choir', sharedUri: 'inmemory://choir' });
    const join = vi.spyOn(h.ports.lifecycle, 'join');

    const first = spaces.members.joinSpace('choir');
    expect(spaces.members.joiningSpace()).toBe('choir');
    await Promise.all([first, spaces.members.joinSpace('choir')]);

    expect(join).toHaveBeenCalledTimes(1);
    expect(h.datasets.switched).toEqual(['ds-c', 'ds-c']);
    expect(spaces.members.joiningSpace()).toBe('');
    expect(spaces.members.joinError()).toBeNull();
  });

  it('makes a space with its collection and its creator as its first admin', async () => {
    const h = await seeded();
    const spaces = build(h);
    const id = await spaces.members.createSpace('Garden', 'Beds and paths', 'personal', 'hidden');
    expect(id).toBeTruthy();
    const handle = (await h.datasets.get(id!)).handle;
    expect(((await Role.findAll(handle, {})) as Role[]).map((role) => role.slug)).toEqual([ADMIN_ROLE]);
    expect(((await RoleGrant.findAll(handle, {})) as RoleGrant[]).map((grant) => [grant.role, grant.agent])).toEqual([
      [ADMIN_ROLE, ME],
    ]);
    const made = spaces.members.mySpaces().find((space) => space.uuid === id);
    expect(made).toMatchObject({ name: 'Garden', description: 'Beds and paths' });
    expect(made?.root).toBeTruthy();
    expect(spaces.members.creatingSpace()).toBe(false);
  });
});
