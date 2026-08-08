import { moduleRegistry, moduleStores } from '@shared/registries/moduleRegistry';
import {
  isSpaceSelf,
  type LocationData,
  removeSpaceFromParent,
  spaceSelfWhere,
  syncSpaceToParent,
} from '@shared/spaceSync';
import { deriveSlug } from '@shared/utils';
import type { AgentProfileSummary } from '@we/backend-shared';
import { createBlocks, deleteBlocks, reconcileBlocks } from '@we/block-shared';
import {
  AGENT_DEFAULT,
  CollectionBlock,
  compressImageToFileData,
  type DatasetProxy,
  dataURIToFileData,
  type FileData,
  FOLLOW_SPACE,
  getModelForPerspective,
  LocationBlock,
  Signal,
  SignalType,
  Space,
  SpacePreference,
} from '@we/models';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  ParentProps,
  untrack,
  useContext,
} from 'solid-js';

import { type AppDataset, useDatasetStore } from './DatasetStore';
import { useProfileStore } from './ProfileStore';
import { useRouteStore } from './RouteStore';
import { useSessionStore } from './SessionStore';
import { useShellStore } from './ShellStore';
import { useTemplateStore } from './TemplateStore';
import { useThemeStore } from './ThemeStore';

/**
 * One row of the spaces list — every joined dataset the agent can act on, space or not.
 *
 * Built over datasets rather than over `mySpaces` because a dataset that is *not* yet a WE space
 * still belongs in the list: a community synced in from another app is a thing you have joined and
 * can act on (by initializing it), and the only place it was previously visible was a raw id in the
 * diagnostics list. A space you cannot see is a space you cannot leave.
 *
 * `kind` replaces what used to be three separate sections. Shared and personal differ by exactly one
 * field on the same model, which is a badge, not a heading — and splitting them gave the page two
 * "none yet" empty states for what is one list.
 */
export interface SpaceListEntry {
  /** The dataset id — stable whether or not a Space record exists, so it keys navigation and settings. */
  uuid: string;
  name: string;
  description: string;
  avatar: string;
  kind: 'shared' | 'personal' | 'foreign';
  /** False for a joined dataset with no WE Space record — the "initialize" state. */
  isWeSpace: boolean;
  /** Whether this agent may change what everyone here sees. See {@link SpaceStore.canAdministerSpace}. */
  canAdminister: boolean;
  /**
   * This space's module settings, carried on the row rather than fetched per space.
   *
   * `$store` resolves a literal path, so a settings page rendered for one row of a list cannot ask
   * for `moduleSettingsFor(<that row's uuid>)` — the same constraint that made `launchModule` take
   * an id. Precomputing puts the answer where the row's context already reaches it.
   */
  modules: ModuleSetting[];
  /** What the community set, so a picker can label the "follow the space" option with it. */
  defaultTemplateId: string;
  defaultThemeId: string;
  /** This agent's override: FOLLOW_SPACE, AGENT_DEFAULT, or a concrete id. Private to this agent. */
  templateOverride: string;
  themeOverride: string;
}

/**
 * Which modules a space has on, from its stored value.
 *
 * An unset field means "not decided", never "none" — see `Space.enabledModules`. Falling back to the
 * registered set is what stops this being a silent regression that strips every existing space of
 * its chrome. A malformed value is a corrupt setting, not a decision to disable everything.
 *
 * A plain function over the stored string rather than a memo over the current space, because the
 * settings page answers this for spaces the agent is not standing in.
 */
function resolveEnabledModules(raw: string | undefined): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
    } catch {
      console.warn('space.enabledModules is not valid JSON; falling back to the registered set');
    }
  }
  return moduleRegistry.all().map((entry) => entry.definition.id);
}

/**
 * Every registered module, with each layer's answer for one space — the shape a settings list renders.
 *
 * All three answers travel together because the settings page has to explain *why* a module is not
 * showing. "Enabled by the community but not installed by you" and "installed but the community has
 * it off" are different situations with different remedies, and a single boolean cannot tell them
 * apart — it would leave a toggle that is on next to a module that is not there.
 */
function moduleSettingsFrom(raw: string | undefined, installed: Set<string>, muted: Set<string>): ModuleSetting[] {
  const on = new Set(resolveEnabledModules(raw));
  return moduleRegistry.all().map(({ definition }) => {
    const enabled = on.has(definition.id);
    const isInstalled = installed.has(definition.id);
    const isMuted = muted.has(definition.id);
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description ?? '',
      icon: definition.icon ?? 'puzzle-piece',
      enabled,
      installed: isInstalled,
      muted: isMuted,
      active: enabled && isInstalled && !isMuted,
    };
  });
}

export interface ModuleSetting {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** The community's decision for this space — shared with every member. */
  enabled: boolean;
  /** This agent's decision, everywhere. */
  installed: boolean;
  /** This agent's decision, here. Private. */
  muted: boolean;
  /** All of the above agreeing — whether it actually renders here for this agent. */
  active: boolean;
}

export interface SpaceMetaUpdate {
  name?: string;
  description?: string;
  discovery?: 'listed' | 'hidden';
  location?: LocationData | null;
}

export interface FluxSubgroupMessage {
  id: string;
  author: string;
  timestamp: string;
  body: string;
}

// Space.avatar/coverImage are typed as string (resolved data URI on read) but accept FileData on write.
// This input type reflects the actual write-path contract.
type SpaceInput = Omit<Partial<Space>, 'avatar' | 'coverImage'> & {
  avatar?: FileData | string;
  coverImage?: FileData | string;
};

export interface SpaceStore {
  // State
  memberDids: Accessor<string[]>;
  members: Accessor<AgentProfileSummary[]>;
  spaceDefaultTemplateId: Accessor<string>;
  spaceDefaultThemeId: Accessor<string>;
  currentSpace: Accessor<Space | null>;
  /** All Space models the agent holds, across every joined dataset. */
  mySpaces: Accessor<Space[]>;
  personalSpaces: Accessor<Space[]>;
  sharedSpaces: Accessor<Space[]>;
  /** Every joined dataset the agent can act on, space or not — the spaces list. See {@link SpaceListEntry}. */
  spaceList: Accessor<SpaceListEntry[]>;
  creatingSpace: Accessor<boolean>;
  /** Sidebar entries in user-defined order — datasets decorated with Space name/avatar when
   * available, plus a virtual pre-join entry for the configured global space. */
  orderedSidebarItems: Accessor<
    { uuid: string; name: string; avatar?: string; spaceId: string; isGlobalPreJoin?: boolean }[]
  >;
  /** Name/description/avatar detected from a foreign app's own model (e.g. Flux's Community),
   * for prefilling the "Initialize as WE space" gate. Null once the dataset is a WE space,
   * or if no recognized foreign model is found. */
  foreignSpacePrefill: Accessor<{ name: string; description: string; avatar: string | null } | null>;
  /** Feature modules this *space* has turned on — the community's decision, shared with every
   *  member. Falls back to everything the seed activated when the space has never decided, so
   *  spaces that predate the setting keep the chrome they had. */
  enabledModules: Accessor<string[]>;
  /** Options for the per-space template override picker, including a "follow the space" entry. */
  templateOverrideOptions: Accessor<{ label: string; value: string }[]>;
  /** Options for the per-space theme override picker, including a "follow the space" entry. */
  themeOverrideOptions: Accessor<{ label: string; value: string }[]>;
  /** Feature modules this *agent* wants available anywhere. Personal; see AgentSettings.installedModules. */
  installedModules: Accessor<string[]>;
  /** What actually renders here for this agent: registered ∩ installed ∩ enabled, less personal mutes. */
  activeModules: Accessor<string[]>;
  /** Every registered module and whether this agent wants it available anywhere — the global list. */
  moduleInstallSettings: Accessor<{ id: string; name: string; description: string; icon: string; installed: boolean }[]>;
  /** Launchers for the modules enabled here — what the module rail renders. */
  moduleLaunchers: Accessor<{ id: string; icon: string; label: string; active: boolean }[]>;

  // Actions
  createSpace: (
    name: string,
    description: string,
    access: 'personal' | 'shared',
    discovery: 'hidden' | 'listed',
    avatarFile?: File,
    coverImageFile?: File,
    location?: LocationData | null,
  ) => Promise<void>;
  /** Join a shared dataset. `focus` defaults to true; pass false to join without navigating to it. */
  joinSpace: (id: string, focus?: boolean) => Promise<void>;
  initializeAsWeSpace: (name: string, description: string, avatarValue?: File | string | null) => Promise<Space>;
  /** Remove a space: clears its global-discovery listing (when authored by this agent) and
   * removes the backing dataset. */
  removeSpace: (uuid: string) => Promise<void>;
  createPost: (json: unknown) => Promise<void>;
  updatePost: (postId: string, json: unknown) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  /** Every space-scoped write takes an optional target uuid; omitted means the space on screen. */
  updateSpaceImage: (field: 'avatar' | 'coverImage', imageFile: File, spaceUuid?: string) => Promise<void>;
  updateSpaceMeta: (updates: SpaceMetaUpdate, spaceUuid?: string) => Promise<void>;
  setSpaceDefaultTemplate: (templateId: string, spaceUuid?: string) => Promise<void>;
  setSpaceDefaultTheme: (themeId: string, spaceUuid?: string) => Promise<void>;
  setModuleEnabled: (moduleId: string, enabled: boolean, spaceUuid?: string) => Promise<void>;
  /** Turn a module on or off for this agent everywhere. */
  setModuleInstalled: (moduleId: string, installed: boolean) => Promise<void>;
  /** Mute or unmute a module for this agent in one space. Private to this agent. */
  setModuleMuted: (moduleId: string, muted: boolean, spaceUuid?: string) => Promise<void>;
  /** Override the template this agent sees in one space; FOLLOW_SPACE follows its default. Private. */
  setSpaceTemplateOverride: (templateId: string, spaceUuid?: string) => Promise<void>;
  /** Override the theme this agent sees in one space; FOLLOW_SPACE follows its default. Private. */
  setSpaceThemeOverride: (themeId: string, spaceUuid?: string) => Promise<void>;
  launchModule: (moduleId: string) => void;
  createSignalType: (config: Partial<SignalType>) => Promise<void>;
  upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
  navigateToSpace: (spaceId: string, view?: string) => Promise<void>;
  /** Whether this agent may change what every member of that space sees. */
  canAdministerSpace: (uuid: string) => boolean;
  getSubgroupMessages: (subgroupId: string) => Promise<FluxSubgroupMessage[]>;
  removeSpaceFromGlobal: (spaceUuid: string) => Promise<void>;
  updateSpaceInCache: (dataset: AppDataset, updates: Partial<Space>) => void;

  // Boot wiring (used by the boot controller, not by schemas)
  loadSpaces: () => Promise<void>;

  // Testing
  test: () => Promise<void>;
}

const SpaceContext = createContext<SpaceStore>();

export function SpaceStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const profileStore = useProfileStore();
  const routeStore = useRouteStore();
  const templateStore = useTemplateStore();
  const themeStore = useThemeStore();
  const shellStore = useShellStore();

  const [mySpaces, setMySpaces] = createSignal<Space[]>([]);
  const [creatingSpace, setCreatingSpace] = createSignal(false);

  // Derived: personal and shared spaces.
  //
  // Shared-ness is read from `url` — the space's global (shared) id, set when its dataset is
  // published — not from the stored `Space.access` field, which records the same fact a second
  // time and can only ever agree or be wrong. `url` is also the fact every backend has, however
  // it implements sharing (a neighbourhood, a published branch, an `is_public` row).
  const personalSpaces = createMemo(() => mySpaces().filter((s) => !s.url));
  const sharedSpaces = createMemo(() => mySpaces().filter((s) => !!s.url));

  /**
   * Whether this agent may change what every member of a space sees.
   *
   * **A UI affordance, not enforcement.** A shared space is a neighbourhood every member can write
   * links to; nothing stops another member's client writing `we://name`. This decides whether to
   * *offer* the controls, which is worth doing — an owner should see what is theirs to manage — but
   * it must never be described to the user as protection.
   *
   * A predicate rather than an inline `author === me` in each template, because creator-only is
   * today's answer and not the last one: multiple admins, roles, or an SDNA-level constraint all
   * change what "may administer" means. Templates asking the question by name keep working; templates
   * that had compared two DIDs would all need editing.
   */
  function canAdministerSpace(uuid: string): boolean {
    const space = mySpaces().find((s) => s.uuid === uuid);
    if (!space) return false;
    // A personal space has no one else to answer to.
    if (!space.url) return true;
    const me = session.me()?.did;
    return Boolean(me && space.author === me);
  }

  /**
   * The middle layer: which modules this agent wants available to them at all, anywhere.
   *
   * Read from the root dataset, so it is personal — turning one off here changes nothing another
   * member sees. Unset means "not decided" and falls back to everything registered, so an agent who
   * never opens the setting keeps what they had.
   */
  const installedModules = createMemo<string[]>(() =>
    resolveEnabledModules(datasetStore.agentSettings()?.installedModules),
  );

  /** This agent's personal choices per space, from the root dataset. See `SpacePreference`. */
  const [spacePreferences, setSpacePreferences] = createSignal<SpacePreference[]>([]);

  const preferenceFor = (spaceUuid: string | undefined): SpacePreference | undefined =>
    spaceUuid ? spacePreferences().find((p) => p.spaceUuid === spaceUuid) : undefined;

  const mutedModulesFor = (spaceUuid: string | undefined): string[] => {
    const raw = preferenceFor(spaceUuid)?.mutedModules;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  };

  /**
   * This agent's template/theme override for a space, normalised to one of the three values a
   * picker offers.
   *
   * Anything falsy becomes {@link FOLLOW_SPACE} here rather than at each call site: a record written
   * before these fields existed has no value, and the picker still needs a matching option to select
   * — bound to `''`, it would show blank and could never be set back.
   */
  const templateOverrideFor = (spaceUuid: string | undefined): string =>
    preferenceFor(spaceUuid)?.templateId || FOLLOW_SPACE;
  const themeOverrideFor = (spaceUuid: string | undefined): string =>
    preferenceFor(spaceUuid)?.themeId || FOLLOW_SPACE;

  /** The Space model behind a dataset id, for resolving what an override falls back to. */
  const spaceForUuid = (uuid: string): Space | undefined => {
    const ds = datasetStore.datasets().find((d) => d.id === uuid);
    return ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
  };

  /**
   * Option lists for the per-space override pickers, with "follow the space" as a real entry.
   *
   * Built here rather than in the schema because the leading entry cannot be expressed there — the
   * schema can `$map` a store array into options, but has no way to prepend one. And it has to
   * exist: without it, overriding is one-way, since a picker offering only concrete templates gives
   * someone no way back to the space's own choice.
   *
   * `createMemo` runs its body immediately, so everything these read must already be declared above
   * them — a `const` referenced from an eagerly-run memo is a TDZ crash at provider construction,
   * not a lazy failure later.
   */

  /** Name the thing an option resolves to, so "the space's default" is not a guess. */
  const withResolved = (label: string, name: string | undefined) => (name ? `${label} (${name})` : label);

  const templateOverrideOptions = createMemo(() => {
    const byId = (id: string) => templateStore.allTemplates().find((t) => t.id === id)?.meta?.name;
    const spaceDefault = spaceForUuid(datasetStore.currentDataset()?.id ?? '')?.defaultTemplateId;
    return [
      { label: withResolved("Use the space's default", byId(spaceDefault ?? '')), value: FOLLOW_SPACE },
      { label: withResolved('Use my default', byId(templateStore.defaultTemplateId())), value: AGENT_DEFAULT },
      ...templateStore.allTemplates().map((t) => ({ label: t.meta?.name || t.id || '', value: t.id || '' })),
    ];
  });

  const themeOverrideOptions = createMemo(() => {
    const byId = (id: string) => themeStore.allThemes().find((t) => t.id === id)?.name;
    const spaceDefault = spaceForUuid(datasetStore.currentDataset()?.id ?? '')?.defaultThemeId;
    return [
      { label: withResolved("Use the space's default", byId(spaceDefault ?? '')), value: FOLLOW_SPACE },
      { label: withResolved('Use my default', byId(themeStore.defaultThemeId())), value: AGENT_DEFAULT },
      ...themeStore.allThemes().map((t) => ({ label: t.name || t.id, value: t.id })),
    ];
  });

  /** `installedModules` as a set — the shape both the list and the intersection want. */
  const installedSet = createMemo(() => new Set(installedModules()));

  /**
   * The spaces list: one row per joined dataset the agent can act on.
   *
   * Ordered by `orderedDatasets`, which already applies the user's sidebar order and drops the
   * system datasets — those belong in the advanced section, where the subject is datasets rather
   * than spaces.
   */
  const spaceList = createMemo<SpaceListEntry[]>(() =>
    datasetStore.orderedDatasets().map((ds) => {
      const space = mySpaces().find((s) => isSpaceSelf(s, ds));
      return {
        uuid: ds.id,
        // A foreign dataset has no Space record to name it, so the dataset's own name stands in.
        name: space?.name || ds.name,
        description: space?.description ?? '',
        avatar: space?.avatar ?? '',
        kind: !space ? 'foreign' : space.url ? 'shared' : 'personal',
        isWeSpace: Boolean(space),
        canAdminister: space ? canAdministerSpace(space.uuid) : false,
        modules: space ? moduleSettingsFrom(space.enabledModules, installedSet(), new Set(mutedModulesFor(ds.id))) : [],
        defaultTemplateId: space?.defaultTemplateId ?? '',
        defaultThemeId: space?.defaultThemeId ?? '',
        templateOverride: templateOverrideFor(ds.id),
        themeOverride: themeOverrideFor(ds.id),
      };
    }),
  );

  // TemplateStore mounts above this store and cannot read it directly — hand it the space lookup
  // it needs to resolve a space's default template (see TemplateStore.provideSpaceLookup).
  templateStore.provideSpaceLookup(mySpaces);

  // A dataset removed from any client takes its Space entry with it.
  datasetStore.onDatasetRemoved((uuid) => {
    setMySpaces((prev) => prev.filter((s) => s.uuid !== uuid));
  });

  // Locking the agent clears the loaded spaces along with the session.
  createEffect(() => {
    if (session.bootState() === 'login') setMySpaces([]);
  });

  // Derived: all non-system datasets with Space avatar/name when available, plain dataset data
  // otherwise. Prepends a virtual pre-join entry for the global space when it is configured but
  // the user hasn't joined yet.
  const orderedSidebarItems = createMemo(() => {
    // For joined spaces, s.uuid is the creator's local UUID which never matches the
    // joiner's p.uuid. Space.url stores only the CID (no neighbourhood:// prefix) to
    // avoid URI resolution in the triple store; strip the prefix when looking up.
    const spaceByUuid = new Map(mySpaces().map((s) => [s.uuid, s]));
    const spaceByUrl = new Map(
      mySpaces()
        .filter((s) => s.url)
        .map((s) => [s.url!, s]),
    );
    const items: { uuid: string; name: string; avatar?: string; spaceId: string; isGlobalPreJoin?: boolean }[] =
      datasetStore.orderedDatasets().map((d) => {
        const s = (d.sharedId ? spaceByUrl.get(d.sharedId) : undefined) ?? spaceByUuid.get(d.id);
        return {
          uuid: d.id,
          name: s?.name ?? d.name,
          avatar: typeof s?.avatar === 'string' ? s.avatar : undefined,
          spaceId: d.sharedId ?? d.id,
        };
      });

    const globalId = datasetStore.globalSpaceId();
    const alreadyJoined = globalId ? items.some((item) => item.spaceId === globalId) : true;
    if (globalId && !alreadyJoined) {
      items.unshift({ uuid: 'global-pre-join', name: 'WE Discovery', spaceId: globalId, isGlobalPreJoin: true });
    }

    const mktId = datasetStore.marketplaceId();

    return mktId ? items.filter((item) => item.spaceId !== mktId) : items;
  });

  /** Load the Space model from every candidate dataset. Runs after DatasetStore.loadDatasets. */
  async function loadSpaces(): Promise<void> {
    try {
      // we-root and we-test are system datasets that never have Space SDNA installed —
      // calling Space.findOne on them produces an RPC 500 "No SHACL shape" error.
      const SYSTEM_PERSPECTIVES = ['we-root', 'we-test'];
      const candidates = datasetStore.datasets().filter((d) => !SYSTEM_PERSPECTIVES.includes(d.name));
      // Any other joined dataset without Space SDNA installed (e.g. a Flux
      // neighbourhood) would throw the same "No SHACL shape" error. Since these run in a
      // Promise.all, one rejection would otherwise abort the whole batch and hide every
      // real space's data (including avatars) until each is visited individually. Catch
      // per-dataset so one bad dataset can't poison the rest.
      const spaces = await Promise.all(
        candidates.map(async (ds) => await Space.findOne(ds.handle, { where: spaceSelfWhere(ds) }).catch(() => null)),
      );
      const filteredSpaces = spaces
        .filter((s): s is Space => !!s)
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
      setMySpaces(filteredSpaces);
    } catch (error) {
      console.error('SpaceStore: loadSpaces error', error);
    }
  }

  async function addSpaceToDataset(
    dataset: DatasetProxy,
    space: SpaceInput,
    location?: Partial<LocationBlock>,
  ): Promise<Space> {
    const spaceModel = await Space.create(dataset, space as Partial<Space>);
    if (location) {
      const locationModel = await LocationBlock.create(dataset, location);
      await spaceModel.setLocation(locationModel);
    }
    return spaceModel;
  }

  async function createSpace(
    name: string,
    description: string,
    access: 'personal' | 'shared',
    discovery: 'hidden' | 'listed',
    avatarFile?: File,
    coverImageFile?: File,
    location?: LocationData | null,
  ): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    setCreatingSpace(true);

    try {
      // Create the dataset
      const spaceRef = await lifecycle.create(name);
      const spaceHandle = spaceRef.handle as DatasetProxy;
      let publishedSharedId: string | undefined;

      // Register SDNA models (full set, same as switchDataset uses)
      const schemas = session.backendPorts()!.schemas;
      await schemas.installSpace(spaceHandle, moduleRegistry.moduleSchemas(schemas));

      // If shared, publish — capture the returned URL so it can be stored on the Space model
      // (the dataset handle's own sharedUrl is not updated in-place).
      if (access === 'shared') {
        if (!lifecycle.publish) throw new Error('This backend cannot publish shared datasets.');
        publishedSharedId = (await lifecycle.publish(spaceRef.id)).sharedId;
      }

      // Process avatar image if provided
      const avatarData = avatarFile ? await compressImageToFileData(avatarFile, 'space-avatar') : undefined;

      // Process cover image if provided
      const coverImageData = coverImageFile ? await compressImageToFileData(coverImageFile, 'space-cover') : undefined;

      // Assemble Space + optional location data — used for both own and parent datasets
      const spaceData = {
        uuid: spaceRef.id,
        url: publishedSharedId,
        name,
        description,
        discovery,
        defaultTemplateId: 'default',
        defaultThemeId: 'dark',
        ...(avatarData && { avatar: avatarData }),
        ...(coverImageData && { coverImage: coverImageData }),
      };
      const locationData = location ?? undefined;

      // Write to own dataset
      const spaceModel = await addSpaceToDataset(spaceHandle, spaceData, locationData);
      console.log('SpaceStore: created space model for new dataset', spaceModel);

      // Sync to global discovery space when the user opted in.
      // Space.create returns relations unhydrated, so we pass avatarData, coverImageData,
      // and locationData directly rather than reading them back from spaceModel.
      if (discovery === 'listed') {
        const globalDs = datasetStore.globalDataset();
        if (globalDs) {
          await syncSpaceToParent(spaceModel, globalDs.handle, session.backendPorts()!.schemas, {
            locationData,
            avatarData,
            coverImageData,
          }).catch((err) => console.error('SpaceStore: sync space to global failed', err));
        }
      }

      // Track locally so the sidebar updates with the action rather than with the backend's
      // change event (which may lag, or on web may not fire at all).
      await datasetStore.trackDataset(spaceRef);
      setMySpaces((prev) => [...prev, spaceModel]);
    } catch (error) {
      console.error('SpaceStore: createSpace error', error);
    } finally {
      setCreatingSpace(false);
    }
  }

  /**
   * Turns the currently-viewed dataset — which already has some other app's
   * SDNA installed (e.g. a Flux Community) but not WE's — into a WE space in place.
   * Unlike createSpace, this never creates a new dataset or publishes a new
   * neighbourhood: the dataset is already a joined, published neighbourhood
   * (that's the only way it could be showing in the sidebar), so access is always
   * 'shared' here, not a real user choice.
   */
  async function initializeAsWeSpace(
    name: string,
    description: string,
    avatarValue?: File | string | null,
  ): Promise<Space> {
    const ds = datasetStore.currentDataset();
    if (!ds) throw new Error('SpaceStore: initializeAsWeSpace called with no active dataset');

    // Additive/idempotent — does not remove or touch the dataset's existing foreign SDNA.
    const initSchemas = session.backendPorts()!.schemas;
    await initSchemas.installSpace(ds.handle, moduleRegistry.moduleSchemas(initSchemas));

    let avatarData: FileData | undefined;
    if (avatarValue instanceof File) {
      avatarData = await compressImageToFileData(avatarValue, 'space-avatar');
    } else if (typeof avatarValue === 'string' && avatarValue) {
      // Untouched prefill from the foreign app's own resolved (data-URI) image value —
      // round-tripped back through FILE_STORAGE_LANGUAGE rather than re-compressed.
      avatarData = dataURIToFileData(avatarValue, 'space-avatar');
    }

    const spaceData: SpaceInput = {
      uuid: ds.id,
      url: ds.sharedId,
      name,
      description,
      discovery: 'hidden',
      defaultTemplateId: 'default',
      defaultThemeId: 'dark',
      ...(avatarData && { avatar: avatarData }),
    };

    const spaceModel = await addSpaceToDataset(ds.handle, spaceData);

    if (!mySpaces().some((s) => s.uuid === spaceModel.uuid)) {
      setMySpaces((prev) => [...prev, spaceModel]);
    }

    // Re-run switchDataset on the same uuid rather than hand-duplicating its
    // classes/registerDynamicModels/manifest refresh: this atomically flips isWeSpace,
    // refreshes the dynamic model registry, and hands this store a new dataset handle
    // so its currentSpace effect re-fires now that a Space instance exists.
    await datasetStore.switchDataset(ds.id);

    return spaceModel;
  }

  /**
   * Join a shared dataset, and by default go to it.
   *
   * `focus: false` joins without moving — for a caller that only needs the dataset present, not
   * open. The marketplace is that case: its routes name `datasetStore.marketplaceDataset` directly,
   * so it reads fine from wherever you are, and focusing dragged you out of the space you were in
   * while still looking like an overlay above it. Every shell overlay stays a layer over the space
   * underneath; that property is what lets one host space-scoped things at all.
   */
  async function joinSpace(id: string, focus: boolean = true): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle?.join) return;
    if (!id || typeof id !== 'string') {
      console.warn('SpaceStore: joinSpace called with invalid id', id);
      return;
    }

    // If already joined locally (by local id, shared id, or full URI), just focus the dataset.
    const existing = datasetStore.datasets().find((d) => d.id === id || d.sharedId === id || d.sharedUri === id);
    if (existing) {
      if (focus) await datasetStore.switchDataset(existing.id);
      return;
    }

    console.log('SpaceStore: joining shared dataset', id);
    try {
      // The adapter normalizes bare shared ids to its own URI scheme.
      const joinedRef = await lifecycle.join(id);
      const joinedHandle = joinedRef.handle as DatasetProxy;

      // Install WE SDNA so Space, SignalType, CollectionBlock etc. are queryable
      // immediately. installSpace diffs against the dataset's actual state before writing,
      // so this is safe to call unconditionally even when the space's creator or an earlier
      // joiner already installed it — it won't write a duplicate copy.
      const joinSchemas = session.backendPorts()!.schemas;
      await joinSchemas.installSpace(joinedHandle, moduleRegistry.moduleSchemas(joinSchemas));

      // Track locally so gates derived from the dataset list (marketplaceJoined, the sidebar,
      // the seed-configured global/marketplace slots) update with the join.
      await datasetStore.trackDataset(joinedRef);

      // Load the Space model and push into mySpaces so the sidebar shows the correct
      // name immediately, without requiring a reboot.
      const joinedSpaceModel = joinedRef.sharedId
        ? await Space.findOne(joinedHandle, { where: { url: joinedRef.sharedId } }).catch(() => null)
        : null;
      if (joinedSpaceModel && !mySpaces().some((s) => s.url === joinedSpaceModel.url)) {
        setMySpaces((prev) => [...prev, joinedSpaceModel]);
      }

      if (focus) await datasetStore.switchDataset(joinedRef.id);
      console.log('SpaceStore: joined space', joinedRef.id);
    } catch (error) {
      console.error('SpaceStore: joinSpace error', error);
    }
  }

  async function removeSpaceFromGlobal(spaceUuid: string): Promise<void> {
    const globalDs = datasetStore.globalDataset();
    if (!globalDs) return;
    return removeSpaceFromParent(spaceUuid, globalDs.handle);
  }

  async function removeSpace(uuid: string): Promise<void> {
    try {
      const globalDs = datasetStore.globalDataset();
      const myDid = session.me()?.did;
      if (globalDs && myDid) {
        // Only remove from global discovery if the current user is the author of that
        // space entry — a peer who joined and later deletes their local copy should not
        // affect the global listing.
        const spaceInGlobal = await Space.findOne(globalDs.handle, { where: { uuid } }).catch(() => null);
        if (spaceInGlobal && spaceInGlobal.author === myDid) {
          await removeSpaceFromParent(uuid, globalDs.handle).catch((err) =>
            console.error('SpaceStore: removeSpaceFromParent on delete error', err),
          );
        }
      }
      // Prunes mySpaces via the onDatasetRemoved callback.
      await datasetStore.removeDataset(uuid);
    } catch (error) {
      console.error('SpaceStore: removeSpace error', error);
    }
  }

  function updateSpaceInCache(dataset: AppDataset, updates: Partial<Space>): void {
    setMySpaces((prev) =>
      prev.map((s) =>
        isSpaceSelf(s, dataset) ? Object.assign(Object.create(Object.getPrototypeOf(s)), s, updates) : s,
      ),
    );
  }

  // Backfill mySpaces when switching to a shared dataset whose Space record wasn't cached at
  // join time (joinSpace's Space.findOne may have returned null if the creator's record hadn't
  // propagated from Holochain yet). Re-runs on every dataset switch.
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    if (!ds?.sharedId) return;
    const sharedCid = ds.sharedId;
    if (untrack(mySpaces).some((s) => s.url === sharedCid)) return;
    void (async () => {
      const spaceModel = await Space.findOne(ds.handle, { where: { url: sharedCid } }).catch(() => null);
      if (spaceModel && !untrack(mySpaces).some((s) => s.url === spaceModel.url)) {
        setMySpaces((prev) => [...prev, spaceModel]);
      }
    })();
  });

  async function test() {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    const spaces = await Space.findAll(p, { include: { location: true } });
    console.log('Spaces in dataset:', spaces);
    console.log('spaceId: ', p.uuid);
  }

  async function createPost(json: unknown): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    await createBlocks(p, json);
  }

  async function updatePost(postId: string, json: unknown): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    const existingRoot = await CollectionBlock.findOne(p, { where: { id: postId } });
    if (!existingRoot) return;
    await reconcileBlocks(p, existingRoot, json);
  }

  async function deletePost(postId: string): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    await deleteBlocks(p, postId);
  }

  async function navigateToSpace(spaceId: string, view?: string): Promise<void> {
    // spaceId may be a local id or a shared id — no shape-guessing needed with refs.
    const ds = datasetStore.datasets().find((d) => d.id === spaceId || d.sharedId === spaceId);

    if (ds) {
      // Pre-load space templates before switching so the template and data arrive together
      await templateStore.preloadSpaceTemplates(ds);
      await datasetStore.switchDataset(ds.id);
    }
    // If no dataset found, route change alone will show the join gate

    const segs = routeStore.segments();
    const currentView = view ?? (segs[0] === 'space' && segs[2] ? segs[2] : 'about');
    const targetPath = '/space/' + spaceId + '/' + currentView;
    shellStore.closeShellView();
    routeStore.navigate(targetPath);
    // Notify embedded app iframes (e.g. Flux) after the dataset has switched
    broadcastPerspectiveNavigation(spaceId);
  }

  function broadcastPerspectiveNavigation(communityId: string): void {
    const iframes = document.querySelectorAll('we-iframe') as NodeListOf<
      HTMLElement & { postMessage: (data: unknown, origin: string) => void }
    >;
    iframes.forEach((el) => {
      if (typeof el.postMessage === 'function') {
        el.postMessage({ type: 'NAVIGATE_PERSPECTIVE', communityId }, '*');
      }
    });
  }

  /**
   * The dataset a space-scoped write targets: a named space, or the one being viewed.
   *
   * Space settings are reached from the spaces list, so the space being configured is usually not
   * the one you are standing in — navigating to it would close the settings overlay
   * (`navigateToSpace` calls `closeShellView`), which is the whole reason the list carries the
   * settings entry point rather than a "current space" page doing it.
   *
   * Omitting the argument keeps the previous meaning, so in-space callers are unchanged.
   */
  function targetDataset(spaceUuid?: string): AppDataset | null {
    if (!spaceUuid) return datasetStore.currentDataset();
    return datasetStore.datasets().find((d) => d.id === spaceUuid) ?? null;
  }

  /** Whether a write is aimed at the space currently on screen — live UI switches only apply then. */
  const isCurrent = (ds: AppDataset) => datasetStore.currentDataset()?.id === ds.id;

  async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const fileData = await compressImageToFileData(imageFile, field === 'avatar' ? 'space-image' : 'space-cover');
    const [spaceModel] = await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) });
    if (!spaceModel) return;
    await Space.update(ds.handle, spaceModel.id, { [field]: fileData });
    // Only the current space has a live subscription refreshing it; every other row in the spaces
    // list is served from this cache, so without it the change would not appear until a reload.
    updateSpaceInCache(ds, { [field]: fileData } as never);
    if (spaceModel.discovery === 'listed') {
      const globalDs = datasetStore.globalDataset();
      if (globalDs) {
        const imageOpt = field === 'avatar' ? { avatarData: fileData } : { coverImageData: fileData };
        await syncSpaceToParent(spaceModel, globalDs.handle, session.backendPorts()!.schemas, imageOpt).catch((err) =>
          console.error('SpaceStore: sync image to global failed', err),
        );
      }
    }
  }

  async function updateSpaceMeta(updates: SpaceMetaUpdate, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const currentDataset = ds.handle;

    const [spaceModel] = await Space.findAll(currentDataset, {
      where: spaceSelfWhere(ds),
      include: { location: true },
    });
    if (!spaceModel) return;

    const previousDiscovery = spaceModel.discovery;

    if (updates.name !== undefined) spaceModel.name = updates.name;
    if (updates.description !== undefined) spaceModel.description = updates.description;
    if (updates.discovery !== undefined) spaceModel.discovery = updates.discovery;
    await spaceModel.save();
    // See updateSpaceImage — only the current space is refreshed by a live subscription.
    const { location: _location, ...scalars } = updates;
    updateSpaceInCache(ds, scalars as never);

    if (updates.location !== undefined) {
      if (updates.location === null) {
        const [existingLoc] = await LocationBlock.findAll(currentDataset);
        if (existingLoc) {
          try {
            await existingLoc.delete();
          } catch (err) {
            console.error('[SpaceStore] location delete failed:', err);
          }
        }
      } else {
        const loc = updates.location;
        // Always delete + recreate so setLocation updates the Space's we://location triple,
        // which triggers the reactive currentSpace subscription to re-query with fresh data.
        // LocationBlock.update only changes nested triples and doesn't trigger the Space query.
        const [existingLoc] = await LocationBlock.findAll(currentDataset);
        if (existingLoc) await existingLoc.delete();
        await session.backendPorts()!.schemas.ensure(currentDataset, LocationBlock);
        const newLoc = await LocationBlock.create(currentDataset, {
          latitude: loc.latitude,
          longitude: loc.longitude,
          ...(loc.name && { name: loc.name }),
          ...(loc.city && { city: loc.city }),
          ...(loc.country && { country: loc.country }),
          ...(loc.countryCode && { countryCode: loc.countryCode }),
        });
        await spaceModel.setLocation(newLoc);
      }
    }

    const globalDs = datasetStore.globalDataset();
    if (!globalDs) return;

    const effectiveDiscovery = updates.discovery ?? previousDiscovery;
    if (effectiveDiscovery === 'listed') {
      // Pass locationData explicitly when location changed — the included spaceModel.location
      // snapshot is stale after our delete+recreate. null signals explicit removal to syncSpaceToParent.
      const syncOpts = updates.location !== undefined ? { locationData: updates.location } : {};
      await syncSpaceToParent(spaceModel, globalDs.handle, session.backendPorts()!.schemas, syncOpts).catch((err) =>
        console.error('SpaceStore: sync meta to global failed', err),
      );
    } else if (previousDiscovery === 'listed') {
      await removeSpaceFromParent(spaceModel.uuid, globalDs.handle).catch((err) =>
        console.error('SpaceStore: remove from global failed', err),
      );
    }
  }

  async function createSignalType(config: Partial<SignalType>): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    // Fixed ranges for modes where the user doesn't configure them
    const rangeOverrides: Record<string, { rangeMin: number; rangeMax: number }> = {
      toggle: { rangeMin: 0, rangeMax: 1 },
      vote: { rangeMin: -1, rangeMax: 1 },
    };
    const slugFromName = config.name ? deriveSlug(config.name) : '';
    const effectiveSlug = config.slug ? config.slug : slugFromName;
    const withSlug = { ...config, slug: effectiveSlug };
    const normalised =
      withSlug.mode && rangeOverrides[withSlug.mode] ? { ...withSlug, ...rangeOverrides[withSlug.mode] } : withSlug;
    await SignalType.create(p, normalised);
  }

  async function upsertSignal(nodeId: string, signalTypeId: string, value: number): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    const myDid = session.me()?.did;
    if (!p || !myDid) return;

    const existing = await Signal.findOne(p, {
      parent: { id: nodeId, predicate: 'we://signal' },
      where: { signalTypeId, author: myDid },
    });

    if (existing) await existing.delete();
    if (value === 0) return;
    await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://signal' } });
  }

  // Ecosystem dialect, feature-detected through the connector's interop surface — a backend
  // without it simply returns nothing.
  async function getSubgroupMessages(subgroupId: string): Promise<FluxSubgroupMessage[]> {
    const ds = datasetStore.currentDataset();
    const fetchMessages = session.backendPorts()?.interop?.fluxSubgroupMessages;
    if (!ds || !fetchMessages) return [];
    try {
      return await fetchMessages(ds.handle, subgroupId);
    } catch (err) {
      console.error('SpaceStore: getSubgroupMessages failed', err);
      return [];
    }
  }

  const [currentSpace, setCurrentSpace] = createSignal<Space | null>(null);

  /**
   * Which modules this space has on.
   *
   * An unset field means "not decided", never "none" — see `Space.enabledModules`. Falling back to
   * the registered set is what stops this shipping as a silent regression that strips every existing
   * space of its chrome.
   */
  const enabledModules = createMemo<string[]>(() => resolveEnabledModules(currentSpace()?.enabledModules));



  /**
   * What actually renders here, for this agent: the three layers intersected, minus personal mutes.
   *
   * Registered ∩ installed ∩ enabled, less muted. The layers answer different questions and none
   * substitutes for another — the deployment says what exists, I say what I want anywhere, the
   * community says what it runs, and I say what I want *here*. A module has to survive all four.
   *
   * This is what the chrome gate and the launcher rail read. `enabledModules` stays the community's
   * decision alone, because that is what the space settings edit and what other members share.
   */
  const activeModules = createMemo<string[]>(() => {
    const installed = installedSet();
    const muted = new Set(mutedModulesFor(datasetStore.currentDataset()?.id));
    return enabledModules().filter((id) => installed.has(id) && !muted.has(id));
  });

  /**
   * The agent layer as a settings list — every registered module and whether this agent wants it.
   *
   * Space-independent by design: this is the page you reach without being in a space, and the
   * decision it edits applies everywhere. Its per-space counterpart travels on each spaces-list row.
   */
  const moduleInstallSettings = createMemo(() => {
    const installed = installedSet();
    return moduleRegistry.all().map(({ definition }) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description ?? '',
      icon: definition.icon ?? 'puzzle-piece',
      installed: installed.has(definition.id),
    }));
  });

  /**
   * What the module rail renders: one entry per enabled module that declares a launcher.
   *
   * Reads `moduleStores` so `active` tracks the module's own state — the notes tab highlights while
   * its panel is open. A module with no `activeWhen` (a call, which starts rather than toggles) is
   * simply never highlighted.
   */
  /** Read a boolean off a module's own store, unwrapping the accessor a module store exposes. */
  const read = (moduleId: string, key: string | undefined, fallback: boolean): boolean => {
    if (!key) return fallback;
    const value = (moduleStores[moduleId] as Record<string, unknown> | undefined)?.[key];
    return typeof value === 'function' ? Boolean((value as () => unknown)()) : Boolean(value);
  };

  // Personal per-space choices live in the root dataset, so they load with it rather than with any
  // space — and stay readable for every space at once, which the settings list needs.
  createEffect(() => {
    const root = datasetStore.rootDataset();
    if (!root) {
      setSpacePreferences([]);
      return;
    }
    void SpacePreference.findAll(root.handle)
      .then(setSpacePreferences)
      .catch(() => setSpacePreferences([]));
  });

  /** Turn a module on or off for this agent everywhere. See `AgentSettings.installedModules`. */
  async function setModuleInstalled(moduleId: string, installed: boolean): Promise<void> {
    const next = new Set(installedModules());
    if (installed) next.add(moduleId);
    else next.delete(moduleId);
    // Writes the resolved list, so the first toggle pins whatever was on by fallback — the same
    // reason `setModuleEnabled` does, and the same consequence: a module added to the seed later
    // will not silently appear for an agent who has already decided.
    await datasetStore.updateAgentSettings({ installedModules: JSON.stringify([...next]) });
  }

  /**
   * Write one agent-private choice about one space, creating the record if it is the first.
   *
   * Always the root dataset, never the space — these are mine, and putting them in the shared
   * perspective would tell every other member which modules I muted and which theme I use.
   */
  async function updateSpacePreference(uuid: string, updates: Partial<SpacePreference>): Promise<void> {
    const root = datasetStore.rootDataset();
    if (!root) return;
    try {
      const existing = preferenceFor(uuid);
      if (existing) await SpacePreference.update(root.handle, existing.id, updates);
      else await SpacePreference.create(root.handle, { spaceUuid: uuid, ...updates });
      setSpacePreferences(await SpacePreference.findAll(root.handle));
    } catch (error) {
      console.error('SpaceStore: could not persist space preference', error);
    }
  }

  /** Mute or unmute a module for this agent in one space. */
  async function setModuleMuted(moduleId: string, muted: boolean, spaceUuid?: string): Promise<void> {
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!uuid) return;
    const next = new Set(mutedModulesFor(uuid));
    if (muted) next.add(moduleId);
    else next.delete(moduleId);
    await updateSpacePreference(uuid, { mutedModules: JSON.stringify([...next]) } as Partial<SpacePreference>);
  }

  /**
   * Turn a stored override into the id that actually applies.
   *
   * `''` defers to the community's choice; {@link AGENT_DEFAULT} defers to this agent's global one,
   * read live so it tracks a later change rather than freezing today's answer.
   */
  const resolveTemplateFor = (uuid: string): string => {
    const override = templateOverrideFor(uuid);
    if (override === AGENT_DEFAULT) return templateStore.defaultTemplateId();
    if (override === FOLLOW_SPACE) return spaceForUuid(uuid)?.defaultTemplateId || '';
    return override;
  };

  const resolveThemeFor = (uuid: string): string => {
    const override = themeOverrideFor(uuid);
    if (override === AGENT_DEFAULT) return themeStore.defaultThemeId();
    if (override === FOLLOW_SPACE) return spaceForUuid(uuid)?.defaultThemeId || '';
    return override;
  };

  /**
   * Override the template this agent sees in one space. {@link FOLLOW_SPACE} returns to its default.
   *
   * Applied immediately when the space is the one on screen, so the choice is visible where it was
   * made; otherwise it takes effect next time that space is opened.
   */
  async function setSpaceTemplateOverride(templateId: string, spaceUuid?: string): Promise<void> {
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!uuid) return;
    await updateSpacePreference(uuid, { templateId } as Partial<SpacePreference>);
    if (datasetStore.currentDataset()?.id !== uuid) return;
    const template = templateStore.allTemplates().find((t) => t.id === resolveTemplateFor(uuid));
    if (template) templateStore.replaceTemplate(template);
  }

  /** Override the theme this agent sees in one space. {@link FOLLOW_SPACE} returns to its default. */
  async function setSpaceThemeOverride(themeId: string, spaceUuid?: string): Promise<void> {
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!uuid) return;
    await updateSpacePreference(uuid, { themeId } as Partial<SpacePreference>);
    if (datasetStore.currentDataset()?.id !== uuid) return;
    const effective = resolveThemeFor(uuid);
    if (effective) themeStore.replaceTheme(effective);
    else themeStore.clearSpaceTheme();
  }

  const moduleLaunchers = createMemo(() => {
    const on = new Set(activeModules());
    return moduleRegistry
      .all()
      .filter(({ definition }) => definition.launcher && on.has(definition.id))
      .filter(({ definition }) => read(definition.id, definition.launcher!.availableWhen, true))
      .map(({ definition }) => {
        const launcher = definition.launcher!;
        return {
          id: definition.id,
          icon: launcher.icon,
          label: launcher.label,
          active: read(definition.id, launcher.activeWhen, false),
        };
      });
  });

  /**
   * Invoke a module's launcher.
   *
   * Here rather than in the schema because `$action` resolves a *literal* path, so a rail iterating
   * over modules cannot build `modules.<id>.<method>` per entry. The rail passes the id instead and
   * this dereferences it.
   */
  function launchModule(moduleId: string) {
    const definition = moduleRegistry.get(moduleId)?.definition;
    const action = definition?.launcher?.action;
    if (!action) return;
    const store = moduleStores[moduleId] as Record<string, unknown> | undefined;
    const fn = store?.[action];
    if (typeof fn === 'function') (fn as () => void)();
    else console.warn(`module "${moduleId}" declares launcher action "${action}" but its store has no such method`);
  }

  async function setModuleEnabled(moduleId: string, enabled: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    // Read the space from the cache rather than `currentSpace`, so this answers for a space being
    // configured from the spaces list as readily as for the one on screen.
    const space = ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
    if (!ds || !space) return;
    const next = new Set(resolveEnabledModules(space.enabledModules));
    if (enabled) next.add(moduleId);
    else next.delete(moduleId);
    // Writes the resolved list, not a diff — so the first toggle also pins everything that was on by
    // fallback, and a module added to the seed later doesn't silently appear in a space that had
    // already made a decision.
    const enabledModulesJson = JSON.stringify([...next]);
    try {
      await Space.update(ds.handle, space.id, { enabledModules: enabledModulesJson });
    } catch (error) {
      console.error('SpaceStore: could not persist enabledModules', error);
      return;
    }
    updateSpaceInCache(ds, { enabledModules: enabledModulesJson } as never);
    if (!isCurrent(ds)) return;
    // Republished as a *new* instance rather than the one just written through. `currentSpace` is a
    // plain signal, so Solid dedupes on `===` — handing back the same object (which is what mutating
    // it in place and re-setting it amounts to) notifies nothing, and the module rail would keep
    // rendering the previous set until something else happened to refetch the space. Same clone
    // idiom as `updateSpaceInCache`.
    setCurrentSpace((prev) =>
      prev
        ? (Object.assign(Object.create(Object.getPrototypeOf(prev)), prev, {
            enabledModules: enabledModulesJson,
          }) as Space)
        : prev,
    );
  }

  // Subscribe to current space data reactively whenever the dataset changes.
  // include: { location: true } so AboutRoute can access location without a separate query.
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    if (!ds || !datasetStore.isWeSpace()) {
      setCurrentSpace(null);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = (Space as any).query(ds.handle, { where: spaceSelfWhere(ds), include: { location: true } }) as {
      subscribe: (cb: (results: Space[]) => void) => Promise<Space[]>;
      dispose: () => void;
    };
    const handleResult = (results: Space[]) => setCurrentSpace(results[0] ?? null);
    builder
      .subscribe(handleResult)
      .then(handleResult)
      .catch(() => setCurrentSpace(null));
    onCleanup(() => builder.dispose());
  });

  const [memberDids, setMemberDids] = createSignal<string[]>([]);
  const [spaceDefaultTemplateId, setSpaceDefaultTemplateId] = createSignal<string>('');
  const [spaceDefaultThemeId, setSpaceDefaultThemeId] = createSignal<string>('');

  // Derive from currentSpace; signals remain writable for optimistic updates
  createEffect(() => setSpaceDefaultTemplateId(currentSpace()?.defaultTemplateId ?? ''));
  createEffect(() => setSpaceDefaultThemeId(currentSpace()?.defaultThemeId ?? ''));

  // Apply the space's default theme when entering a space, restore personal theme when leaving.
  // Only restore when there's genuinely no current dataset — not during the transient null
  // window while switching between spaces (currentSpace loads async after the dataset changes).
  createEffect(() => {
    // This agent's own choice for this space wins over the community's default — that is what an
    // override is for. `''` means they have not overridden it, so the space's default stands.
    const current = datasetStore.currentDataset()?.id;
    const themeId = current ? resolveThemeFor(current) : spaceDefaultThemeId();
    // Explicitly track space identity: navigating to a different space must always
    // re-apply that space's default theme, even when the new space's default happens
    // to equal the previous one. Without this, spaceDefaultThemeId wouldn't change
    // value across the navigation, and Solid would skip re-running this effect —
    // leaving a theme manually switched to in the old space stuck active.
    void currentSpace()?.uuid;
    if (themeId) {
      themeStore.replaceTheme(themeId);
    } else if (!datasetStore.currentDataset()) {
      themeStore.restorePersonalTheme();
    } else {
      // In a space with no default theme — clear any previously scoped space theme.
      themeStore.clearSpaceTheme();
    }
  });

  async function setSpaceDefaultTemplate(templateId: string, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    // Switching what is on screen is only right when the space being configured is the one on
    // screen. Setting another space's default from the spaces list must not repaint the app.
    if (isCurrent(ds)) {
      setSpaceDefaultTemplateId(templateId);
      const template = templateStore.allTemplates().find((t) => t.id === templateId);
      if (template) templateStore.replaceTemplate(template);
    }
    // Keep mySpaces cache in sync so template pre-loading uses the fresh defaultTemplateId
    updateSpaceInCache(ds, { defaultTemplateId: templateId } as never);
    const [space] = await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) });
    if (space) await Space.update(ds.handle, space.id, { defaultTemplateId: templateId });
  }

  async function setSpaceDefaultTheme(themeId: string, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    if (isCurrent(ds)) setSpaceDefaultThemeId(themeId);
    updateSpaceInCache(ds, { defaultThemeId: themeId } as never);
    const [space] = await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) });
    if (space) await Space.update(ds.handle, space.id, { defaultThemeId: themeId });
  }

  // Load neighbourhood members whenever the current dataset changes
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const lifecycle = session.lifecycle();
    const myDid = session.me()?.did;
    if (!ds || !lifecycle?.members) {
      setMemberDids(myDid ? [myDid] : []);
      return;
    }
    lifecycle
      .members(ds.id)
      .then((dids: string[]) => {
        const allDids = myDid ? [...new Set([myDid, ...dids])] : dids;
        setMemberDids(allDids);
        for (const did of allDids) {
          profileStore.fetchProfile(did);
        }
      })
      .catch(() => {
        setMemberDids(myDid ? [myDid] : []);
      });
  });

  // Map memberDids to cached AgentProfileSummary entries
  const members = createMemo<AgentProfileSummary[]>(() => {
    const cached = profileStore.profiles();
    return memberDids()
      .map((did) => cached.find((a) => a.did === did))
      .filter((a): a is AgentProfileSummary => a != null);
  });

  // Resolve the route segment to a local dataset whenever the route changes.
  // Handles deep links, page refresh, and browser back/forward navigation.
  // For intentional navigation via navigateToSpace, this becomes a no-op
  // (dataset already switched; guard prevents double-call).
  createEffect(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || !segs[1]) return;
    const seg = segs[1];

    const ds = datasetStore.datasets().find((d) => d.id === seg || d.sharedId === seg);
    if (!ds) {
      // Routing policy, not backend dialect: a segment that isn't a local id is treated as a
      // shared link the agent hasn't joined — clear the current dataset so the join gate shows.
      // Local ids (UUIDs, with hyphens) may just be momentarily missing; leave the view alone.
      if (!seg.includes('-')) datasetStore.clearCurrentDataset();
      return;
    }
    const current = untrack(datasetStore.currentDataset);
    if (current?.id === ds.id) return;
    void (async () => {
      await templateStore.preloadSpaceTemplates(ds);
      await datasetStore.switchDataset(ds.id);
    })();
  });

  // Prefill data for the "Initialize as WE space" gate — detected from a foreign app's own
  // model (currently just Flux's Community) when the current dataset isn't a WE space yet.
  const [foreignSpacePrefill, setForeignSpacePrefill] = createSignal<{
    name: string;
    description: string;
    avatar: string | null;
  } | null>(null);

  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const weSpace = datasetStore.isWeSpace();
    // Force a re-run once the dataset's foreign schemas have been registered — that happens in
    // switchDataset's background pass, strictly before currentDatasetModels is set, so tracking
    // it here guarantees a second run right when model resolution is ready.
    void datasetStore.currentDatasetModels();

    if (!ds || weSpace) {
      setForeignSpacePrefill(null);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CommunityClass = getModelForPerspective('Community', ds.handle) as any;
    if (!CommunityClass) {
      setForeignSpacePrefill(null);
      return;
    }

    CommunityClass.findOne(ds.handle, {})
      .then((instance: { name?: string; description?: string; thumbnail?: string } | null) => {
        if (!instance || untrack(datasetStore.currentDataset)?.id !== ds.id) return;
        setForeignSpacePrefill({
          name: instance.name ?? '',
          description: instance.description ?? '',
          avatar: instance.thumbnail ?? null,
        });
      })
      .catch(() => setForeignSpacePrefill(null));
  });

  const store: SpaceStore = {
    // State
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    currentSpace,
    mySpaces,
    personalSpaces,
    sharedSpaces,
    spaceList,
    creatingSpace,
    orderedSidebarItems,
    enabledModules,
    installedModules,
    activeModules,
    templateOverrideOptions,
    themeOverrideOptions,
    moduleInstallSettings,
    moduleLaunchers,
    foreignSpacePrefill,

    // Actions
    createSpace,
    joinSpace,
    initializeAsWeSpace,
    removeSpace,
    createPost,
    updatePost,
    deletePost,
    updateSpaceImage,
    updateSpaceMeta,
    setSpaceDefaultTemplate,
    setSpaceDefaultTheme,
    setModuleEnabled,
    setModuleInstalled,
    setModuleMuted,
    setSpaceTemplateOverride,
    setSpaceThemeOverride,
    launchModule,
    createSignalType,
    upsertSignal,
    navigateToSpace,
    canAdministerSpace,
    getSubgroupMessages,
    removeSpaceFromGlobal,
    updateSpaceInCache,

    loadSpaces,

    test,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
