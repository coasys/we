/**
 * The space store's roles-and-policy part: who administers a space, its roles read live so a grant
 * made elsewhere moves the controls, the changes only an administrator may make, and the policy in
 * force.
 *
 * Run once under each reactivity port, against the in-memory backend.
 */
import { describeRefusal } from '@we/backend-shared';
import { CollectionBlock, getEntity, Role, RoleGrant, Space } from '@we/entities';
import type { Setter } from '@we/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_ROLE, ADMIN_ROLE_RECORD, cannotRevoke } from '../src/shared/spaceRoles';
import { createSpaceRoles, type SpaceRoles, writeAdminGrant } from '../src/shared/stores/space/roles';
import { createSpaceList, type SpaceList } from '../src/shared/stores/space/spaces';
import { reactivityPorts } from './support/engines';
import { flush, ME, type SpaceHarness, spaceHarness } from './support/spaceParts';

const SOMEBODY = 'did:key:z6MkSomebodyElse';
const later = () => new Promise((resolve) => setTimeout(resolve, 5));

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
    dispose: () => void;
  }

  async function build(): Promise<Built> {
    const h = await spaceHarness(makePort(), [
      { id: 'ds-a', name: 'Allotment' },
      { id: 'ds-p', name: 'Notebook' },
      // Open here, but holding no space record: not known to be a space.
      { id: 'ds-x', name: 'Scratch' },
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
    let dispose!: () => void;
    disposers.push(
      (dispose = reactivity.root(() => {
        const [onScreen, writeOnScreen] = reactivity.signal<Space | null>(null);
        setOnScreen = writeOnScreen;
        spaces = createSpaceList({
          ...h.ctx,
          routeStore: { segments: () => [], navigate: () => {} },
          templateStore: { appTemplate: () => null, preloadSpaceTemplates: () => Promise.resolve() } as never,
          shapeStore: { addRecordTypes: () => Promise.resolve([]) } as never,
        });
        roles = createSpaceRoles({ ...h.ctx, spaces, onScreen: { currentSpace: onScreen } });
      })),
    );
    await spaces.members.loadSpaces();
    return { h, spaces, roles, setOnScreen, dispose };
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
    await writeAdminGrant(h.ctx.sessionStore, (await h.datasets.get('ds-a')).handle);
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

  const failRead = (entity: string) =>
    vi
      .spyOn(getEntity(entity) as unknown as { findAll: (...a: unknown[]) => Promise<unknown> }, 'findAll')
      .mockRejectedValue(new Error('backend unreachable'));

  it.each(['Role', 'RoleGrant'])(
    'refuses a write to another space whose %s records cannot be read, rather than judging it with no admins',
    async (entity) => {
      const built = await build();
      const { h } = built;
      await enter(built, 'ds-p');
      const handle = (await h.datasets.get('ds-a')).handle;
      const failing = failRead(entity);
      await expect(CollectionBlock.create(handle, { kind: 'post' })).rejects.toMatchObject({
        refusal: { reason: 'unreadable', action: 'CollectionBlock.create' },
      });
      failing.mockRestore();
      await expect(CollectionBlock.create(handle, { kind: 'post' })).resolves.toBeTruthy();
    },
  );

  it('refuses a write to a dataset known to be a space whose own record cannot be read', async () => {
    const built = await build();
    const { h } = built;
    await enter(built, 'ds-p');
    const handle = (await h.datasets.get('ds-a')).handle;
    const failing = failRead('Space');
    await expect(CollectionBlock.create(handle, { kind: 'post' })).rejects.toMatchObject({
      refusal: { reason: 'unreadable' },
    });
    failing.mockRestore();
    await expect(CollectionBlock.create(handle, { kind: 'post' })).resolves.toBeTruthy();
  });

  it('refuses a write to a dataset known to be a space whose own record has not arrived, as still arriving', async () => {
    const built = await build();
    const { h } = built;
    await enter(built, 'ds-p');
    const handle = (await h.datasets.get('ds-a')).handle;
    // The read succeeds and finds nothing: the space's record is still syncing, not absent.
    const empty = vi
      .spyOn(getEntity('Space') as unknown as { findAll: (...a: unknown[]) => Promise<unknown> }, 'findAll')
      .mockResolvedValue([]);
    await expect(CollectionBlock.create(handle, { kind: 'post' })).rejects.toMatchObject({
      refusal: { reason: 'unreadable', action: 'CollectionBlock.create', arriving: true },
    });
    expect(h.toasts.said).toEqual(['error: This space is still arriving. Try again in a moment.']);
    // The space's own record is the one write it lets through: it is what the space is waiting for.
    await expect(Space.create(handle, { name: 'Allotment' })).resolves.toBeTruthy();
    empty.mockRestore();
    // Not held: once the record is there the write is judged as any other.
    await expect(CollectionBlock.create(handle, { kind: 'post' })).resolves.toBeTruthy();
  });

  it('does not judge a write to a dataset not known to be a space when its record is not there', async () => {
    const built = await build();
    const { h } = built;
    await enter(built, 'ds-p');
    const handle = (await h.datasets.get('ds-x')).handle;
    const empty = vi
      .spyOn(getEntity('Space') as unknown as { findAll: (...a: unknown[]) => Promise<unknown> }, 'findAll')
      .mockResolvedValue([]);
    await expect(CollectionBlock.create(handle, { kind: 'post' })).resolves.toBeTruthy();
    empty.mockRestore();
  });

  it('does not judge a write to a dataset not known to be a space when its record cannot be read', async () => {
    const built = await build();
    const { h } = built;
    await enter(built, 'ds-p');
    const handle = (await h.datasets.get('ds-x')).handle;
    const failing = failRead('Space');
    await expect(CollectionBlock.create(handle, { kind: 'post' })).resolves.toBeTruthy();
    failing.mockRestore();
  });

  it('forgets the last space’s roles on leaving it', async () => {
    const built = await build();
    const { h, roles } = built;
    await writeAdminGrant(h.ctx.sessionStore, (await h.datasets.get('ds-a')).handle);
    await enter(built, 'ds-a');
    expect(roles.members.myRoles()).toEqual([ADMIN_ROLE]);
    await enter(built, 'ds-p');
    expect(roles.members.myRoles()).toEqual([]);
    expect(roles.members.rolesLoaded()).toBe(true);
  });

  /**
   * The allotment under the community rules with SOMEBODY its admin and this agent a plain member,
   * holding one post of each of theirs. Set up while this agent still administers it — the creator
   * does, until somebody holds the role — so every step is a write the rules allow.
   */
  async function asMember(built: Built) {
    const { h, roles } = built;
    const handle = (await h.datasets.get('ds-a')).handle;
    await writeAdminGrant(h.ctx.sessionStore, handle);
    await enter(built, 'ds-a');
    await roles.members.setPolicyPreset('community');
    // A version is judged by the roles held when it was written, by the millisecond: step past it.
    await later();
    await roles.members.grantRole(ADMIN_ROLE, SOMEBODY);
    await roles.members.revokeRole(ADMIN_ROLE, ME);
    await flush();
    const mine = await CollectionBlock.create(handle, { kind: 'post' });
    const theirs = await h.as(SOMEBODY, () => CollectionBlock.create(handle, { kind: 'post' }));
    await flush();
    return { handle, mine, theirs };
  }

  it('under the community rules, lets a member edit their own record and refuses someone else’s, said once', async () => {
    const built = await build();
    const { h, roles } = built;
    const { handle, mine, theirs } = await asMember(built);
    expect(roles.members.myRoles()).toEqual([]);
    expect(roles.members.policy()).toMatchObject({ preset: 'community', roles: [] });
    h.toasts.said.length = 0;
    await expect(CollectionBlock.update(handle, mine.id, { kind: 'reply' })).resolves.toBeDefined();
    await expect(CollectionBlock.update(handle, theirs.id, { kind: 'reply' })).rejects.toMatchObject({
      refusal: { action: 'CollectionBlock.edit' },
    });
    expect(h.toasts.said).toHaveLength(1);
    expect(h.toasts.said[0]).toMatch(/^error: /);
  });

  it('keeps a plain member from changing the rules or handing out roles', async () => {
    const built = await build();
    const { h, roles } = built;
    await asMember(built);
    h.toasts.said.length = 0;
    await expect(roles.members.grantRole('moderator', ME)).rejects.toThrow(/administers/);
    await expect(roles.members.createRole({ name: 'Gardener' })).rejects.toThrow(/administers/);
    // Not refused by the store: the write check judges `Policy.edit` like any other write.
    await expect(roles.members.setPolicyPreset('open')).rejects.toMatchObject({ refusal: { action: 'Policy.edit' } });
    await flush();
    expect(roles.members.policy().preset).toBe('community');
  });

  it('refuses to take the last admin away, in the roles’ own sentence', async () => {
    const built = await build();
    const { h, roles } = built;
    await writeAdminGrant(h.ctx.sessionStore, (await h.datasets.get('ds-a')).handle);
    await enter(built, 'ds-a');
    await roles.members.revokeRole(ADMIN_ROLE, ME);
    await flush();
    expect(h.toasts.said).toEqual([`error: ${cannotRevoke(roles.members.roles(), ADMIN_ROLE, ME)}`]);
    expect(roles.members.myRoles()).toEqual([ADMIN_ROLE]);
  });

  it('renames a role and keeps who holds it', async () => {
    const built = await build();
    const { roles } = built;
    await enter(built, 'ds-a');
    await roles.members.createRole({ name: 'Moderator' });
    await roles.members.grantRole('moderator', SOMEBODY);
    await roles.members.updateRole('moderator', { name: 'Steward', description: 'Tends the beds' });
    await flush();
    expect(roles.members.roles().find((role) => role.slug === 'moderator')).toMatchObject({
      name: 'Steward',
      description: 'Tends the beds',
      holders: [SOMEBODY],
    });
  });

  it('judges a write to the space on screen by the rules it has loaded, without reading them again', async () => {
    const built = await build();
    const { h, roles } = built;
    await enter(built, 'ds-a');
    expect(roles.members.policy().loaded).toBe(true);
    const handle = (await h.datasets.get('ds-a')).handle;
    const read = vi.spyOn(getEntity('Policy') as unknown as { findAll: () => Promise<unknown> }, 'findAll');
    await CollectionBlock.create(handle, { kind: 'post' });
    await CollectionBlock.create(handle, { kind: 'post' });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });

  it('reads another space’s rules once for several writes close together', async () => {
    const built = await build();
    const { h } = built;
    await enter(built, 'ds-p');
    const handle = (await h.datasets.get('ds-a')).handle;
    const read = vi.spyOn(getEntity('Policy') as unknown as { findAll: () => Promise<unknown> }, 'findAll');
    await CollectionBlock.create(handle, { kind: 'post' });
    await CollectionBlock.create(handle, { kind: 'post' });
    await CollectionBlock.create(handle, { kind: 'post' });
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRestore();
  });

  it('stops judging writes once its root is disposed', async () => {
    const built = await build();
    const { theirs, handle } = await asMember(built);
    await expect(CollectionBlock.update(handle, theirs.id, { kind: 'reply' })).rejects.toBeDefined();
    built.dispose();
    await expect(CollectionBlock.update(handle, theirs.id, { kind: 'reply' })).resolves.toBeDefined();
  });
});
