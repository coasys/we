/**
 * Who stands where in a space, and what its rules allow: its roles and who holds them, whether this
 * agent administers a space, the policy in force, and the write check every write is judged by. Part
 * of `SpaceStore` — see `../SpaceStore.ts`.
 *
 * Both are read live rather than once: somebody made an admin by another member is owed the controls
 * that come with it now, and a rule an admin changed holds from the next write, not the next space
 * switch. What the records mean is `shared/spaceRoles.ts` and `shared/spacePolicy.ts`.
 *
 * Everything compares persons rather than signing keys, through the backend's `PersonPort` — so a
 * role granted to somebody covers every device they speak from.
 */
import { isPolicyRefusal, isRecordExists, SELF_PERSONS, validatePolicy } from '@we/backend-shared';
import {
  type DatasetProxy,
  deriveIdentityId,
  identityDomainOf,
  Policy,
  registerEntityWriteCheck,
  Role,
  RoleGrant,
  Space,
} from '@we/entities';
import type { SpaceStarter } from '@we/schema-shared';

import { datasetOfHandle } from '../../datasetIdentity';
import { distinctSignal } from '../../distinctSignal';
import { followLive } from '../../followLive';
import {
  createPolicyCheck,
  type GovernedSpace,
  POLICY_PRESETS,
  policyInForce,
  type PolicyPreset,
  type PolicyVersion,
  policyView,
  presetOf,
  type SpacePolicyView,
  type SpaceStanding,
} from '../../spacePolicy';
import {
  ADMIN_ROLE,
  ADMIN_ROLE_RECORD,
  administers,
  cannotRevoke,
  type GrantRow,
  type RoleRow,
  rolesOf,
  rolesView,
  type RoleView,
} from '../../spaceRoles';
import { spaceSelfWhere } from '../../spaceSync';
import { isSystemDataset } from '../../systemDatasets';
import { deriveSlug } from '../../utils';
import type { SpaceStore } from '../SpaceStore';
import type { SpaceContext } from './context';
import type { SpaceNavigation } from './navigation';
import type { SpaceList } from './spaces';
import type { LiveRows } from './types';

export interface SpaceRolesDeps extends SpaceContext {
  spaces: { members: Pick<SpaceList['members'], 'mySpaces'> };
  navigation: { members: Pick<SpaceNavigation['members'], 'currentSpace'> };
}

/** The grant records as the store holds them. */
const grantRowsOf = (grants: RoleGrant[]): GrantRow[] =>
  grants.map((g) => ({
    id: g.id,
    role: g.role,
    agent: g.agent,
    createdAt: g.createdAt as GrantRow['createdAt'],
    revokedAt: g.revokedAt,
  }));

/** Spaces other than the one on screen are remembered this long — see `governedElsewhere`. */
const GOVERNED_TTL_MS = 5_000;

export function createSpaceRoles(deps: SpaceRolesDeps) {
  const { reactivity, toasts, sessionStore: session, datasetStore, spaces, navigation } = deps;
  const { memo, effect, untrack, batch, onCleanup } = reactivity;
  const { mySpaces } = spaces.members;
  const { currentSpace } = navigation.members;

  // The space on screen's roles, as read.
  const [roleRows, setRoleRows] = reactivity.signal<RoleRow[]>([]);
  const [grantRows, setGrantRows] = reactivity.signal<GrantRow[]>([]);
  const [rolesLoaded, setRolesLoaded] = distinctSignal(reactivity, false);
  /** Who the viewer is as a person, and who made the space on screen — see `PersonPort`. */
  const [mePerson, setMePerson] = distinctSignal<string | null>(reactivity, null);
  const [authorPerson, setAuthorPerson] = distinctSignal<string | null>(reactivity, null);
  // The space's policy versions, as read.
  const [policyRows, setPolicyRows] = reactivity.signal<PolicyVersion[]>([]);
  const [policyLoaded, setPolicyLoaded] = distinctSignal(reactivity, false);

  const roleViews = memo<RoleView[]>(() => rolesView(roleRows(), grantRows()));

  /**
   * Whether this agent may change what every member of a space sees.
   *
   * **A UI affordance, not enforcement.** A shared space is one every member can write to; nothing
   * stops another member's client writing a section of its own. This decides whether to *offer* the
   * controls, which is worth doing — an owner should see what is theirs to manage — but it must never
   * be described to the user as protection. The policy, judged at the write check below, is what
   * protects.
   *
   * Answered from the space's roles: whoever holds `admin` administers it, or its creator while nobody
   * does (`administers` in `shared/spaceRoles.ts`). A space's roles are read once it is open, so a
   * space in the list that is not the one on screen still answers by who made it.
   *
   * A predicate rather than an inline `author === me` in each template, because what "may
   * administer" means keeps growing: templates asking the question by name follow it; templates that
   * had compared two DIDs would all need editing.
   */
  function canAdministerSpace(uuid: string): boolean {
    const space = mySpaces().find((s) => s.uuid === uuid);
    if (!space) return false;
    // A personal space has no one else to answer to.
    if (!space.url) return true;
    const me = session.me()?.did;
    // The space on screen answers from its roles. Any other space, whose roles are not read until it
    // is opened, answers as it always has: by who made it.
    if (uuid === datasetStore.currentDataset()?.id && rolesLoaded()) {
      return administers(roleViews(), mePerson() ?? me ?? null, authorPerson() ?? space.author ?? null);
    }
    return Boolean(me && space.author === me);
  }

  /**
   * The same question about the space on screen, as a value a schema can read.
   *
   * `canAdministerSpace` is an action, and an expression cannot call one — so every template that
   * wanted to gate a control on "may I change what everyone here sees?" wrote
   * `x.author == me.did` instead. That is a *different* question: it asks who made the row, not who
   * runs the space, and it is why a template installed into a space by one member could not be
   * removed by anybody else, the space's own author included. Asked here, the answer can grow
   * (several admins, roles) without every template being rewritten.
   *
   * A plain accessor rather than a memo: it reads its signals when called, so it is reactive either
   * way, and cheap enough that memoising buys nothing.
   */
  const canAdministerCurrentSpace = (): boolean => {
    const uuid = currentSpace()?.uuid;
    return uuid ? canAdministerSpace(uuid) : false;
  };

  const persons = () => session.backendPorts()?.persons ?? SELF_PERSONS;
  const personOf = async (did: string): Promise<string> => (await persons().personOf(did)) ?? did;

  effect(() => {
    const did = session.me()?.did;
    if (!did) return setMePerson(null);
    void personOf(did).then((person) => {
      if (session.me()?.did === did) setMePerson(person);
    });
  });
  effect(() => {
    const author = currentSpace()?.author;
    if (!author) return setAuthorPerson(null);
    void personOf(author).then((person) => {
      if (currentSpace()?.author === author) setAuthorPerson(person);
    });
  });

  async function reloadRoles(): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    const uuid = datasetStore.currentDataset()?.id;
    if (!dataset || !datasetStore.isWeSpace()) {
      batch(() => {
        setRoleRows([]);
        setGrantRows([]);
        setRolesLoaded(true);
      });
      return;
    }
    try {
      const [roles, grants] = await Promise.all([Role.findAll(dataset), RoleGrant.findAll(dataset)]);
      if (datasetStore.currentDataset()?.id !== uuid) return;
      batch(() => {
        applyRoles(roles);
        applyGrants(grants);
      });
    } catch (error) {
      console.warn('SpaceStore: could not read the space’s roles', error);
    } finally {
      if (datasetStore.currentDataset()?.id === uuid) setRolesLoaded(true);
    }
  }

  /** The space's role records, as the store holds them — from a read, or from what a watch pushed. */
  function applyRoles(roles: Role[]): void {
    setRoleRows(roles.map((r) => ({ id: r.id, slug: r.slug, name: r.name, description: r.description })));
  }

  /** The space's grants, likewise. */
  function applyGrants(grants: RoleGrant[]): void {
    setGrantRows(grantRowsOf(grants));
  }

  effect(() => {
    const dataset = datasetStore.currentDataset()?.handle;
    const weSpace = datasetStore.isWeSpace();
    batch(() => {
      setRoleRows([]);
      setGrantRows([]);
      setRolesLoaded(false);
    });
    const schemas = session.backendPorts()?.schemas;
    if (!dataset || !weSpace) {
      // Nothing to follow: no roles, and answered.
      void untrack(reloadRoles);
      return;
    }
    // A space made before roles existed has neither entity installed; `ensure` is the diff-first
    // install the kinds of involvement use.
    const installed = (async () => {
      if (schemas) {
        for (const Model of [Role, RoleGrant]) await schemas.ensure(dataset, Model as never).catch(() => undefined);
      }
    })();
    // A half that is missing would change who administers the space: roles are not loaded without both.
    let halves = 0;
    let both = true;
    const half = (loaded: boolean) => {
      both &&= loaded;
      if (++halves === 2 && both) setRolesLoaded(true);
    };
    /*
      Each watch pushes its own model's records whole, which is all its half of the roles is made of —
      so its first result is the read, and a change is applied from it, the other half left as it is.
      A half is in once its watch opened, or once it was read after its watch failed to open.
    */
    const followHalf = <T>(query: () => LiveRows<T>, read: () => Promise<T[]>, apply: (rows: T[]) => void) =>
      followLive(
        reactivity,
        async (current) => {
          await installed;
          return current() ? query() : undefined;
        },
        { store: 'SpaceStore', what: 'the space’s roles', apply, stored: { read }, settled: half },
      );
    followHalf(
      () => Role.query(dataset, {}) as LiveRows<Role>,
      () => Role.findAll(dataset),
      applyRoles,
    );
    followHalf(
      () => RoleGrant.query(dataset, {}) as LiveRows<RoleGrant>,
      () => RoleGrant.findAll(dataset),
      applyGrants,
    );
  });

  const myRoles = memo<string[]>(() => rolesOf(roleViews(), mePerson() ?? session.me()?.did));

  /** The `admin` role, when the space has none yet, and its creator's grant of it — see `Role`. */
  async function writeAdminGrant(dataset: DatasetProxy): Promise<void> {
    const me = session.me()?.did;
    if (!me) return;
    const existing = (await Role.findAll(dataset, { where: { slug: ADMIN_ROLE } }).catch(() => [])) as Role[];
    if (!existing.length) await createRoleRecord(dataset, { ...ADMIN_ROLE_RECORD });
    await RoleGrant.create(dataset, { role: ADMIN_ROLE, agent: await personOf(me) });
  }

  /** The open space's dataset, for a change only whoever administers it may make. Throws otherwise. */
  function administeredDataset(what: string): DatasetProxy {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) throw new Error('No space is open');
    if (!canAdministerCurrentSpace()) throw new Error(`Only whoever administers this space can ${what}`);
    return p;
  }

  /*
    Roles are written here rather than by a declared operation, and that is the format's rule, not a
    gap: what decides who may write is never written by an operation, so a template cannot reach it
    through one. They follow the operations' slug rule all the same — derived from the name, refused
    when the space holds it — and its identity: a role's id derives from its slug as a vocabulary
    create's does, within the space's own record, so two nodes naming one role at once write one record.
  */
  async function createRoleRecord(dataset: DatasetProxy, fields: { slug: string; name: string; description?: string }) {
    const id = await deriveIdentityId('Role', [['slug', fields.slug]], await identityDomainOf(dataset));
    try {
      await Role.create(dataset, fields, { id });
    } catch (error) {
      // Made meanwhile, by another node or another press: the role asked for is there.
      if (!isRecordExists(error)) throw error;
    }
  }

  async function createRole(config: { name: string; description?: string }): Promise<void> {
    const name = config?.name?.trim();
    if (!name) return;
    const p = administeredDataset('name its roles');
    const slug = deriveSlug(name);
    if (!slug) return;
    if (((await Role.findAll(p, { where: { slug } }).catch(() => [])) as Role[]).length) {
      toasts.error('This space already has one called that.');
      return;
    }
    await createRoleRecord(p, { slug, name, description: config.description?.trim() ?? '' });
    await reloadRoles();
  }

  async function updateRole(slug: string, updates: { name?: string; description?: string }): Promise<void> {
    const p = administeredDataset('change its roles');
    const fields = {
      ...(updates?.name?.trim() ? { name: updates.name.trim() } : {}),
      ...(updates?.description !== undefined ? { description: updates.description.trim() } : {}),
    };
    if (!Object.keys(fields).length) return;
    for (const record of (await Role.findAll(p, { where: { slug } }).catch(() => [])) as Role[]) {
      await Role.update(p, record.id, fields);
    }
    await reloadRoles();
  }

  async function grantRole(slug: string, agent: string): Promise<void> {
    if (!slug || !agent) return;
    const p = administeredDataset('give its roles');
    const person = await personOf(agent);
    if (
      roleViews()
        .find((role) => role.slug === slug)
        ?.holders.includes(person)
    )
      return;
    await RoleGrant.create(p, { role: slug, agent: person });
    await reloadRoles();
  }

  async function revokeRole(slug: string, agent: string): Promise<void> {
    if (!slug || !agent) return;
    const p = administeredDataset('take its roles away');
    const person = await personOf(agent);
    const refused = cannotRevoke(roleViews(), slug, person);
    if (refused) {
      toasts.error(refused);
      return;
    }
    // Marked rather than deleted: the policy's history is judged by who held what when. See `RoleGrant`.
    const revokedAt = new Date().toISOString();
    for (const grant of grantRows().filter((g) => g.role === slug && g.agent === person && !g.revokedAt)) {
      await RoleGrant.update(p, grant.id, { revokedAt });
    }
    await reloadRoles();
  }

  /*
    ── Policy ───────────────────────────────────────────────────────────────────────────────────

    The space's rules: who may do what to its records. A version per `Policy` record, the one in
    force worked out by `policyInForce`.

    The same rules are what the write check judges every write by. It is registered here, once,
    because only this store knows which dataset is which space and who holds what in it; every
    backend asks it from its own write path. See `shared/spacePolicy.ts`.
  */
  const currentStanding = (): SpaceStanding => ({
    roles: roleViews(),
    creator: authorPerson() ?? currentSpace()?.author ?? null,
    history: { roles: roleRows(), grants: grantRows() },
  });
  const currentPolicy = memo(() => policyInForce(policyRows(), currentStanding()));
  const currentPolicyView = memo<SpacePolicyView>(() =>
    policyView(
      currentPolicy(),
      currentStanding(),
      mePerson() ?? session.me()?.did ?? null,
      policyLoaded() && rolesLoaded(),
    ),
  );

  /** Every version, with its author as a person. Rejects when they cannot be read: no versions is the open policy. */
  async function readPolicyVersions(dataset: DatasetProxy): Promise<PolicyVersion[]> {
    return policyVersionsOf(await Policy.findAll(dataset));
  }

  /** The policy records as versions — from a read, or from what a watch pushed. */
  function policyVersionsOf(rows: Policy[]): Promise<PolicyVersion[]> {
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        document: row.document,
        createdAt: row.createdAt as PolicyVersion['createdAt'],
        author: row.author ? await personOf(row.author) : null,
      })),
    );
  }

  async function reloadPolicy(): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    const uuid = datasetStore.currentDataset()?.id;
    if (!dataset || !datasetStore.isWeSpace()) {
      batch(() => {
        setPolicyRows([]);
        setPolicyLoaded(true);
      });
      return;
    }
    // Loaded only with the versions in: while they cannot be read, the write check reads them itself.
    try {
      const versions = await readPolicyVersions(dataset);
      if (datasetStore.currentDataset()?.id !== uuid) return;
      batch(() => {
        setPolicyRows(versions);
        setPolicyLoaded(true);
      });
    } catch (error) {
      console.warn('SpaceStore: could not read the space’s policy', error);
    }
  }

  effect(() => {
    const dataset = datasetStore.currentDataset()?.handle;
    const weSpace = datasetStore.isWeSpace();
    batch(() => {
      setPolicyRows([]);
      setPolicyLoaded(false);
    });
    const schemas = session.backendPorts()?.schemas;
    if (!dataset || !weSpace) {
      // Nothing to follow: no versions, and answered.
      void untrack(reloadPolicy);
      return;
    }
    followLive(
      reactivity,
      async (current) => {
        // A space made before policies existed has the entity uninstalled; see the roles effect above.
        if (schemas) await schemas.ensure(dataset, Policy as never).catch(() => undefined);
        // The query's first result is every version, which is what a read would have given.
        return current() ? Policy.query(dataset, {}) : undefined;
      },
      {
        store: 'SpaceStore',
        what: 'the space’s policy',
        /*
          The pushed rows are every version, whole — the read `reloadPolicy` makes — so a new version is
          applied from them, once its authors are resolved. A later push supersedes an earlier one still
          resolving, and loaded is not told before the newest push's versions are in.
        */
        map: policyVersionsOf,
        // Loaded with the rows: a push after an opening that gave none is how the policy recovers.
        apply: (versions) =>
          batch(() => {
            setPolicyRows(versions);
            setPolicyLoaded(true);
          }),
        /*
          No page of versions reached `policyRows`: the watch failed to open, or the newest page could
          not be turned into versions. An empty list is the open policy, which would judge every write,
          so the stored versions are read instead, and the policy is loaded only once that read is in.
          While they cannot be read, the policy stays not loaded: the write check then reads it for
          each write, and refuses the write when that read fails too.
        */
        stored: { read: () => readPolicyVersions(dataset) },
      },
    );
  });

  /** The dataset a write names, among the ones this agent has open. */
  function datasetOfWrite(handle: unknown) {
    const known = [
      ...datasetStore.datasets(),
      datasetStore.rootDataset(),
      datasetStore.personalDataset(),
      datasetStore.testDataset(),
    ].filter((d): d is NonNullable<typeof d> => Boolean(d));
    return datasetOfHandle(known, handle);
  }

  /*
    Spaces other than the one on screen, read when a write reaches one and kept a few seconds — long
    enough that a write of several records reads them once, short enough that a change to another
    space's rules is not held over.
  */
  const governedElsewhere = new Map<string, { at: number; space: Promise<GovernedSpace | null> }>();

  async function readGovernedSpace(ds: { id: string; sharedId?: string; handle: DatasetProxy }) {
    const [self] = (await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) }).catch(() => [])) as Space[];
    if (!self) return null;
    const [roles, grants, versions] = await Promise.all([
      Role.findAll(ds.handle).catch(() => []) as Promise<Role[]>,
      RoleGrant.findAll(ds.handle).catch(() => []) as Promise<RoleGrant[]>,
      readPolicyVersions(ds.handle),
    ]);
    const grantRows = grantRowsOf(grants);
    const standing: SpaceStanding = {
      roles: rolesView(roles, grantRows),
      creator: self.author ? await personOf(self.author) : null,
      history: { roles, grants: grantRows },
    };
    return { ...standing, policy: policyInForce(versions, standing) };
  }

  /** The space a dataset is, with its rules — `null` for anything that is not a space. */
  async function governedSpace(handle: unknown): Promise<GovernedSpace | null> {
    const ds = datasetOfWrite(handle);
    if (!ds || isSystemDataset(ds.name) || datasetStore.systemDatasetUuids().includes(ds.id)) return null;
    if (ds.id === datasetStore.currentDataset()?.id && policyLoaded() && rolesLoaded() && currentSpace()) {
      return { ...currentStanding(), policy: currentPolicy() };
    }
    const cached = governedElsewhere.get(ds.id);
    if (cached && Date.now() - cached.at < GOVERNED_TTL_MS) return cached.space;
    const space = readGovernedSpace(ds);
    // Nothing is remembered about a dataset that is not a space yet: the first record a new space
    // is given is its own `Space`, and every write after it is the space's.
    governedElsewhere.set(ds.id, { at: Date.now(), space });
    // A space whose rules could not be read is read again on the next write, not held as unreadable.
    const forget = () => governedElsewhere.delete(ds.id);
    void space.then((found) => {
      if (!found) forget();
    }, forget);
    return space;
  }

  const policyCheck = createPolicyCheck({
    me: async () => {
      const did = session.me()?.did;
      return did ? (mePerson() ?? (await personOf(did))) : null;
    },
    personOf,
    space: governedSpace,
  });
  registerEntityWriteCheck(async (write) => {
    try {
      await policyCheck(write);
    } catch (error) {
      // Said here, once, for every write — a store that swallows its own errors still tells the person
      // why nothing happened.
      if (isPolicyRefusal(error)) toasts.error(error.message);
      throw error;
    }
  });
  onCleanup(() => registerEntityWriteCheck(null));

  /**
   * The starting policy, written by the space's creator before it is shared — and only by them, as
   * the admin grant is: a member joining later must never write a first version of their own, which
   * would compete with the creator's. A starter's `policy` names the preset.
   *
   * Without one nothing is written, and the space reads as `open`: what every space did before it had
   * a policy. `community` is offered in People rather than chosen for everybody, because some shared
   * work is edited by members who did not make it — a call's interpretation switch, a transcript line
   * from another participant's device, a suggested change to somebody else's record, a board's
   * columns — and `community` keeps editing to a record's author and the space's admins.
   */
  async function writeStartingPolicy(dataset: DatasetProxy, starter: SpaceStarter | undefined): Promise<void> {
    const preset = starter?.policy;
    if (!preset) return;
    await Policy.create(dataset, { document: POLICY_PRESETS[preset].policy });
  }

  async function setPolicyPreset(preset: PolicyPreset): Promise<void> {
    const chosen = POLICY_PRESETS[preset];
    if (!chosen) return;
    const p = datasetStore.currentDataset()?.handle;
    if (!p) throw new Error('No space is open');
    if (presetOf(currentPolicy()) === preset) return;
    const problems = validatePolicy(chosen.policy);
    if (problems.length) throw new Error(problems.join(' '));
    // Judged by the write check like any other write: `Policy.edit` under the version in force.
    await Policy.create(p, { document: chosen.policy });
    await reloadPolicy();
  }

  const members: Pick<
    SpaceStore,
    | 'canAdministerSpace'
    | 'canAdministerCurrentSpace'
    | 'roles'
    | 'myRoles'
    | 'rolesLoaded'
    | 'createRole'
    | 'updateRole'
    | 'grantRole'
    | 'revokeRole'
    | 'policy'
    | 'setPolicyPreset'
  > = {
    canAdministerSpace,
    canAdministerCurrentSpace,
    roles: roleViews,
    myRoles,
    rolesLoaded,
    createRole,
    updateRole,
    grantRole,
    revokeRole,
    policy: currentPolicyView,
    setPolicyPreset,
  };

  return { members, writeAdminGrant, writeStartingPolicy };
}

export type SpaceRoles = ReturnType<typeof createSpaceRoles>;
