/**
 * The space store's roles-and-policy part: who administers a space, its roles read live so a grant
 * made elsewhere moves the controls, the changes only an administrator may make, and the policy in
 * force.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { describeRefusal } from '@we/backend-shared';
import { getEntity, Role, RoleGrant, Space } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_ROLE, ADMIN_ROLE_RECORD } from '../src/shared/spaceRoles';
import { createSpaceRoles, type SpaceRoles } from '../src/shared/stores/space/roles';
import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { reactivityPorts } from './support/engines';
import { flush, ME, type SpaceHarness, spaceHarness } from './support/spaceParts';

const SOMEBODY = 'did:key:z6MkSomebodyElse';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  interface Built {
    h: SpaceHarness;
    spaces: SpaceList;
    roles: SpaceRoles;
    setOnScreen: Setter<Space | null>;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-p', name: 'Notebook' },
    ]);
    await Space.create((await h.datasets.get('ds-a')).handle, {
      uuid: 'ds-a',
      name: 'The Allotment',
      url: 'inmemory://allotment',
    });
    await Space.create((await h.datasets.get('ds-p')).handle, { uuid: 'ds-p', name: 'My notebook' });
    const { reactivity } = h;
    let spaces!: SpaceList;
    let roles!: SpaceRoles;
    let setOnScreen!: Setter<Space | null>;
    disposers.push(
      reactivity.root(() => {
        const [onScreen, writeOnScreen] = reactivity.signal<Space | null>(null);
        setOnScreen = writeOnScreen;
        spaces = createSpaceList({
          ...h.ctx,
          routeStore: { segments: () => [], navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
          newSpace: {
            enableView: () => Promise.resolve(),
            writeAdminGrant: (dataset) => roles.writeAdminGrant(dataset),
            writeStartingPolicy: (dataset, starter) => roles.writeStartingPolicy(dataset, starter),
          },
        });
        roles = createSpaceRoles({ ...h.ctx, spaces, navigation: { members: { currentSpace: onScreen } } });
      }),
    );
    await spaces.members.loadSpaces();
    return { h, spaces, roles, setOnScreen };
  }

  async function enter(built: Built, id: string) {
    built.h.datasets.show(id);
    built.setOnScreen(built.spaces.heldSpace(await built.h.datasets.get(id))!);
    await flush();
  }

  it('answers for a space by who made it until its roles are read, and for a personal one always', async () => {
    const built = await build();
    const { roles } = built;
    // A personal space has nobody else to answer to; a shared one this agent made is its own.
    expect(roles.members.canAdministerSpace('ds-p')).toBe(true);
    expect(roles.members.canAdministerSpace('ds-a')).toBe(true);
    expect(roles.members.canAdministerSpace('ds-unknown')).toBe(false);
    expect(roles.members.canAdministerCurrentSpace()).toBe(false);
    await enter(built, 'ds-a');
    expect(roles.members.rolesLoaded()).toBe(true);
    expect(roles.members.canAdministerCurrentSpace()).toBe(true);
  });

  it('follows the roles live: somebody else made the admin takes the controls', async () => {
    const built = await build();
    const { h, roles } = built;
    await enter(built, 'ds-a');
    const handle = (await h.datasets.get('ds-a')).handle;
    await Role.create(handle, { ...ADMIN_ROLE_RECORD });
    await RoleGrant.create(handle, { role: ADMIN_ROLE, agent: SOMEBODY });
    await flush();
    expect(roles.members.roles().find((role) => role.slug === ADMIN_ROLE)?.holders).toEqual([SOMEBODY]);
    expect(roles.members.myRoles()).toEqual([]);
    expect(roles.members.canAdministerCurrentSpace()).toBe(false);
    await expect(roles.members.createRole({ name: 'Moderator' })).rejects.toThrow(/administers/);
  });

  it('names a role, refuses one the space already has, and gives and takes it', async () => {
    const built = await build();
    const { h, roles } = built;
    await enter(built, 'ds-a');
    await roles.members.createRole({ name: 'Moderator', description: 'Keeps the peace' });
    await roles.members.createRole({ name: 'moderator' });
    expect(h.toasts.said).toEqual(['error: This space already has one called that.']);
    await roles.members.grantRole('moderator', SOMEBODY);
    await flush();
    expect(roles.members.roles().find((role) => role.slug === 'moderator')?.holders).toEqual([SOMEBODY]);
    await roles.members.revokeRole('moderator', SOMEBODY);
    await flush();
    expect(roles.members.roles().find((role) => role.slug === 'moderator')?.holders).toEqual([]);
  });

  it('gives a new space its first admin, then answers from the grant', async () => {
    const built = await build();
    const { h, roles } = built;
    await roles.writeAdminGrant((await h.datasets.get('ds-a')).handle);
    await enter(built, 'ds-a');
    expect(roles.members.myRoles()).toEqual([ADMIN_ROLE]);
    expect(roles.members.canAdministerCurrentSpace()).toBe(true);
  });

  it('reads the policy in force, and writes a preset', async () => {
    const built = await build();
    const { roles } = built;
    await enter(built, 'ds-a');
    expect(roles.members.policy()).toMatchObject({ loaded: true, preset: 'open', me: ME });
    await roles.members.setPolicyPreset('community');
    await flush();
    expect(roles.members.policy().preset).toBe('community');
  });

  it('refuses a write to a space whose rules cannot be read, says so, and reads them again next time', async () => {
    const built = await build();
    const { h } = built;
    // On screen is the notebook, so the allotment's rules are read when a write reaches it.
    await enter(built, 'ds-p');
    const handle = (await h.datasets.get('ds-a')).handle;
    const model = getEntity('Policy') as unknown as { findAll: (...a: unknown[]) => Promise<unknown> };
    const failing = vi.spyOn(model, 'findAll').mockRejectedValue(new Error('backend unreachable'));
    await expect(Role.create(handle, { slug: 'steward', name: 'Steward' })).rejects.toMatchObject({
      refusal: { reason: 'unreadable' },
    });
    // The write check says it once, in the policy's own sentence: an operation that hit it adds nothing.
    expect(h.toasts.said).toEqual([`error: ${describeRefusal({ reason: 'unreadable', action: 'Role.create' })}`]);
    failing.mockRestore();
    // Well inside the few seconds a read is kept for: a failed read was not kept.
    await expect(Role.create(handle, { slug: 'steward', name: 'Steward' })).resolves.toBeTruthy();
  });

  it('forgets the last space’s roles on leaving it', async () => {
    const built = await build();
    const { h, roles } = built;
    await roles.writeAdminGrant((await h.datasets.get('ds-a')).handle);
    await enter(built, 'ds-a');
    expect(roles.members.myRoles()).toEqual([ADMIN_ROLE]);
    await enter(built, 'ds-p');
    expect(roles.members.myRoles()).toEqual([]);
    expect(roles.members.rolesLoaded()).toBe(true);
  });
});
