import { moduleRegistry, moduleStores } from '@shared/registries/moduleRegistry';
import { getSeed } from '@shared/seedRegistry';
import { deriveSlug } from '@shared/utils';
import type { AgentProfileSummary } from '@we/backend-ad4m';
import { getModelForPerspective, registerModel } from '@we/backend-ad4m';
import { ensureModelRegistered, SPACE_MODELS } from '@we/backend-ad4m';
import { installSpaceSdna, isSpaceSelf } from '@we/backend-ad4m';
import { type FluxSubgroupMessage, getFluxSubgroupMessages } from '@we/backend-ad4m';
import { type LocationData, removeSpaceFromParent, spaceSelfWhere, syncSpaceToParent } from '@we/backend-ad4m';
import { createBlocks, deleteBlocks, reconcileBlocks } from '@we/block-shared';
import {
  CollectionBlock,
  compressImageToFileData,
  type DatasetProxy,
  dataURIToFileData,
  type FileData,
  LocationBlock,
  Signal,
  SignalType,
  Space,
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

import { useDatasetStore } from './DatasetStore';
import { useProfileStore } from './ProfileStore';
import { useRouteStore } from './RouteStore';
import { useSessionStore } from './SessionStore';
import { useShellStore } from './ShellStore';
import { useTemplateStore } from './TemplateStore';
import { useThemeStore } from './ThemeStore';

export interface SpaceMetaUpdate {
  name?: string;
  description?: string;
  discovery?: 'listed' | 'hidden';
  location?: LocationData | null;
}

export type { FluxSubgroupMessage } from '@we/backend-ad4m';

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
  /** Feature modules turned on for this space. Falls back to everything the seed activated when the
   *  space has never decided, so spaces that predate the setting keep the chrome they had. */
  enabledModules: Accessor<string[]>;
  /** Registered modules paired with whether this space has them on — the settings list. */
  moduleSettings: Accessor<{ id: string; name: string; description: string; icon: string; enabled: boolean }[]>;
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
  joinSpace: (id: string) => Promise<void>;
  initializeAsWeSpace: (name: string, description: string, avatarValue?: File | string | null) => Promise<Space>;
  /** Remove a space: clears its global-discovery listing (when authored by this agent) and
   * removes the backing dataset. */
  removeSpace: (uuid: string) => Promise<void>;
  createPost: (json: unknown) => Promise<void>;
  updatePost: (postId: string, json: unknown) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  updateSpaceImage: (field: 'avatar' | 'coverImage', imageFile: File) => Promise<void>;
  updateSpaceMeta: (updates: SpaceMetaUpdate) => Promise<void>;
  setSpaceDefaultTemplate: (templateId: string) => Promise<void>;
  setSpaceDefaultTheme: (themeId: string) => Promise<void>;
  setModuleEnabled: (moduleId: string, enabled: boolean) => Promise<void>;
  launchModule: (moduleId: string) => void;
  createSignalType: (config: Partial<SignalType>) => Promise<void>;
  upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
  navigateToSpace: (spaceId: string, view?: string) => Promise<void>;
  getSubgroupMessages: (subgroupId: string) => Promise<FluxSubgroupMessage[]>;
  removeSpaceFromGlobal: (spaceUuid: string) => Promise<void>;
  updateSpaceInCache: (dataset: DatasetProxy, updates: Partial<Space>) => void;

  // Boot wiring (used by the boot controller, not by schemas)
  loadSpaces: () => Promise<void>;

  // Testing
  test: () => Promise<void>;
}

const SpaceContext = createContext<SpaceStore>();

// Register JS classes for $query model resolution (runs once at module load)
// Use .className (set by @Model decorator) rather than .name — bundlers mangle
// the native .name property in production builds, breaking registry lookups.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const M of SPACE_MODELS) registerModel((M as any).className, M as any);

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

  // Derived: personal and shared spaces
  const personalSpaces = createMemo(() => mySpaces().filter((s) => s.access === 'personal'));
  const sharedSpaces = createMemo(() => mySpaces().filter((s) => s.access === 'shared'));

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
      datasetStore.orderedDatasets().map((p) => {
        const cid = p.sharedUrl?.replace('neighbourhood://', '');
        const s = (cid ? spaceByUrl.get(cid) : undefined) ?? spaceByUuid.get(p.uuid);
        return {
          uuid: p.uuid,
          name: s?.name ?? p.name,
          avatar: typeof s?.avatar === 'string' ? s.avatar : undefined,
          spaceId: p.sharedUrl ? p.sharedUrl.replace('neighbourhood://', '') : p.uuid,
        };
      });

    const seedUrl = getSeed().globalSpaceUrl;
    const globalId = seedUrl ? seedUrl.replace('neighbourhood://', '') : null;
    const alreadyJoined = globalId ? items.some((item) => item.spaceId === globalId) : true;
    if (globalId && !alreadyJoined) {
      items.unshift({ uuid: 'global-pre-join', name: 'WE Discovery', spaceId: globalId, isGlobalPreJoin: true });
    }

    const mktUrl = getSeed().marketplaceUrl;
    const mktId = mktUrl ? mktUrl.replace('neighbourhood://', '') : null;

    return mktId ? items.filter((item) => item.spaceId !== mktId) : items;
  });

  /** Load the Space model from every candidate dataset. Runs after DatasetStore.loadDatasets. */
  async function loadSpaces(): Promise<void> {
    try {
      // we-root and we-test are system datasets that never have Space SDNA installed —
      // calling Space.findOne on them produces an RPC 500 "No SHACL shape" error.
      const SYSTEM_PERSPECTIVES = ['we-root', 'we-test'];
      const candidates = datasetStore.datasets().filter((p) => !SYSTEM_PERSPECTIVES.includes(p.name));
      // Any other joined dataset without Space SDNA installed (e.g. a Flux
      // neighbourhood) would throw the same "No SHACL shape" error. Since these run in a
      // Promise.all, one rejection would otherwise abort the whole batch and hide every
      // real space's data (including avatars) until each is visited individually. Catch
      // per-dataset so one bad dataset can't poison the rest.
      const spaces = await Promise.all(
        candidates.map(
          async (perspective) =>
            await Space.findOne(perspective, { where: spaceSelfWhere(perspective) }).catch(() => null),
        ),
      );
      const filteredSpaces = spaces
        .filter((s): s is Space => !!s)
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
      setMySpaces(filteredSpaces);
    } catch (error) {
      console.error('SpaceStore: loadSpaces error', error);
    }
  }

  async function addSpaceToPerspective(
    perspective: DatasetProxy,
    space: SpaceInput,
    location?: Partial<LocationBlock>,
  ): Promise<Space> {
    const spaceModel = await Space.create(perspective, space as Partial<Space>);
    if (location) {
      const locationModel = await LocationBlock.create(perspective, location);
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
      const spacePerspective = spaceRef.handle as DatasetProxy;

      // Register SDNA models (full set, same as switchDataset uses)
      await installSpaceSdna(spacePerspective, moduleRegistry.models());

      // HACK: Model.register resolves before the SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // If shared, publish — capture the returned URL so it can be stored on the Space model
      // (the dataset handle's own sharedUrl is not updated in-place).
      let neighbourhoodUrl: string | undefined;
      if (access === 'shared') {
        if (!lifecycle.publish) throw new Error('This backend cannot publish shared datasets.');
        neighbourhoodUrl = await lifecycle.publish(spaceRef.id);
      }

      // Process avatar image if provided
      const avatarData = avatarFile ? await compressImageToFileData(avatarFile, 'space-avatar') : undefined;

      // Process cover image if provided
      const coverImageData = coverImageFile ? await compressImageToFileData(coverImageFile, 'space-cover') : undefined;

      // Assemble Space + optional location data — used for both own and parent datasets
      const spaceData = {
        uuid: spacePerspective.uuid,
        url: neighbourhoodUrl?.replace('neighbourhood://', ''),
        name,
        description,
        access,
        discovery,
        defaultTemplateId: 'default',
        defaultThemeId: 'dark',
        ...(avatarData && { avatar: avatarData }),
        ...(coverImageData && { coverImage: coverImageData }),
      };
      const locationData = location ?? undefined;

      // Write to own dataset
      const spaceModel = await addSpaceToPerspective(spacePerspective, spaceData, locationData);
      console.log('SpaceStore: created space model for new dataset', spaceModel);

      // Sync to global discovery space when the user opted in.
      // Space.create returns relations unhydrated, so we pass avatarData, coverImageData,
      // and locationData directly rather than reading them back from spaceModel.
      if (discovery === 'listed') {
        const globalP = datasetStore.globalDataset();
        if (globalP) {
          await syncSpaceToParent(spaceModel, globalP, {
            locationData,
            avatarData,
            coverImageData,
          }).catch((err) => console.error('SpaceStore: sync space to global failed', err));
        }
      }

      // Update sidebar. Eagerly add for web (where the perspective-added listener may not
      // fire); addDataset guards so we don't double-add on desktop when the subscription has
      // already resolved its byUUID fetch and added the dataset first.
      await datasetStore.addDataset(spacePerspective);
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
    const perspective = datasetStore.currentDataset();
    if (!perspective) throw new Error('SpaceStore: initializeAsWeSpace called with no active dataset');

    // Additive/idempotent — does not remove or touch the dataset's existing foreign SDNA.
    await installSpaceSdna(perspective, moduleRegistry.models());
    // HACK: Model.register resolves before SDNA is actually ready — same pattern used
    // in switchDataset/createSpace/joinSpace.
    await new Promise((resolve) => setTimeout(resolve, 500));

    let avatarData: FileData | undefined;
    if (avatarValue instanceof File) {
      avatarData = await compressImageToFileData(avatarValue, 'space-avatar');
    } else if (typeof avatarValue === 'string' && avatarValue) {
      // Untouched prefill from the foreign app's own resolved (data-URI) image value —
      // round-tripped back through FILE_STORAGE_LANGUAGE rather than re-compressed.
      avatarData = dataURIToFileData(avatarValue, 'space-avatar');
    }

    const spaceData: SpaceInput = {
      uuid: perspective.uuid,
      url: perspective.sharedUrl?.replace('neighbourhood://', ''),
      name,
      description,
      access: 'shared',
      discovery: 'hidden',
      defaultTemplateId: 'default',
      defaultThemeId: 'dark',
      ...(avatarData && { avatar: avatarData }),
    };

    const spaceModel = await addSpaceToPerspective(perspective, spaceData);

    if (!mySpaces().some((s) => s.uuid === spaceModel.uuid)) {
      setMySpaces((prev) => [...prev, spaceModel]);
    }

    // Re-run switchDataset on the same uuid rather than hand-duplicating its
    // classes/registerDynamicModels/manifest refresh: this atomically flips isWeSpace,
    // refreshes the dynamic model registry, and hands this store a new dataset handle
    // so its currentSpace effect re-fires now that a Space instance exists.
    await datasetStore.switchDataset(perspective.uuid);

    return spaceModel;
  }

  async function joinSpace(id: string): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle?.join) return;
    if (!id || typeof id !== 'string') {
      console.warn('SpaceStore: joinSpace called with invalid id', id);
      return;
    }

    // Normalise the identifier to a full neighbourhood URL when appropriate:
    //   - Full URL passed directly → use as-is
    //   - CID (no hyphens, no '://') → prepend 'neighbourhood://'
    //   - UUID (contains '-') → no neighbourhood URL; only local lookup
    const neighbourhoodUrl = id.includes('://') ? id : !id.includes('-') ? 'neighbourhood://' + id : null;

    // If already joined locally, just focus the dataset.
    const existing = datasetStore
      .datasets()
      .find((p) => p.uuid === id || (neighbourhoodUrl && p.sharedUrl === neighbourhoodUrl));
    if (existing) {
      await datasetStore.switchDataset(existing.uuid);
      return;
    }

    if (!neighbourhoodUrl) {
      console.warn('SpaceStore: joinSpace — cannot determine neighbourhood URL for', id);
      return;
    }

    console.log('SpaceStore: joining neighbourhood', neighbourhoodUrl);
    try {
      const joinedRef = await lifecycle.join(neighbourhoodUrl);
      const joinedP = joinedRef.handle as DatasetProxy;

      // Install WE SDNA so Space, SignalType, CollectionBlock etc. are queryable
      // immediately. installSpaceSdna diffs against the dataset's actual state
      // before writing, so this is safe to call unconditionally even when the space's
      // creator or an earlier joiner already installed it — it won't write a duplicate copy.
      await installSpaceSdna(joinedP, moduleRegistry.models());
      // Give the SDNA write time to settle before reactive queries fire.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Adopt as global/marketplace dataset when the seed says so, and eagerly add to the
      // dataset list so derived state (e.g. marketplaceJoined) updates immediately.
      datasetStore.adoptJoinedDataset(joinedP);

      // Load the Space model and push into mySpaces so the sidebar shows the correct
      // name immediately, without requiring a reboot.
      const cid = neighbourhoodUrl.replace('neighbourhood://', '');
      const joinedSpaceModel = await Space.findOne(joinedP, { where: { url: cid } }).catch(() => null);
      if (joinedSpaceModel && !mySpaces().some((s) => s.url === joinedSpaceModel.url)) {
        setMySpaces((prev) => [...prev, joinedSpaceModel]);
      }

      await datasetStore.switchDataset(joinedP.uuid);
      console.log('SpaceStore: joined space', joinedP.uuid);
    } catch (error) {
      console.error('SpaceStore: joinSpace error', error);
    }
  }

  async function removeSpaceFromGlobal(spaceUuid: string): Promise<void> {
    const globalP = datasetStore.globalDataset();
    if (!globalP) return;
    return removeSpaceFromParent(spaceUuid, globalP);
  }

  async function removeSpace(uuid: string): Promise<void> {
    try {
      const globalP = datasetStore.globalDataset();
      const myDid = session.me()?.did;
      if (globalP && myDid) {
        // Only remove from global discovery if the current user is the author of that
        // space entry — a peer who joined and later deletes their local copy should not
        // affect the global listing.
        const spaceInGlobal = await Space.findOne(globalP, { where: { uuid } }).catch(() => null);
        if (spaceInGlobal && spaceInGlobal.author === myDid) {
          await removeSpaceFromParent(uuid, globalP).catch((err) =>
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

  function updateSpaceInCache(dataset: DatasetProxy, updates: Partial<Space>): void {
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
    const p = datasetStore.currentDataset();
    if (!p?.sharedUrl) return;
    const sharedCid = p.sharedUrl.replace('neighbourhood://', '');
    if (untrack(mySpaces).some((s) => s.url === sharedCid)) return;
    void (async () => {
      const spaceModel = await Space.findOne(p, { where: { url: sharedCid } }).catch(() => null);
      if (spaceModel && !untrack(mySpaces).some((s) => s.url === spaceModel.url)) {
        setMySpaces((prev) => [...prev, spaceModel]);
      }
    })();
  });

  async function test() {
    const p = datasetStore.currentDataset();
    if (!p) return;
    const spaces = await Space.findAll(p, { include: { location: true } });
    console.log('Spaces in dataset:', spaces);
    console.log('spaceId: ', p.uuid);
  }

  async function createPost(json: unknown): Promise<void> {
    const p = datasetStore.currentDataset();
    if (!p) return;
    await createBlocks(p, json);
  }

  async function updatePost(postId: string, json: unknown): Promise<void> {
    const p = datasetStore.currentDataset();
    if (!p) return;
    const existingRoot = await CollectionBlock.findOne(p, { where: { id: postId } });
    if (!existingRoot) return;
    await reconcileBlocks(p, existingRoot, json);
  }

  async function deletePost(postId: string): Promise<void> {
    const p = datasetStore.currentDataset();
    if (!p) return;
    await deleteBlocks(p, postId);
  }

  async function navigateToSpace(spaceId: string, view?: string): Promise<void> {
    // Resolve dataset from spaceId (CID has no hyphens, UUID does)
    const perspective = spaceId.includes('-')
      ? datasetStore.datasets().find((p) => p.uuid === spaceId)
      : datasetStore.datasets().find((p) => p.sharedUrl === 'neighbourhood://' + spaceId);

    if (perspective) {
      // Pre-load space templates before switching so the template and data arrive together
      await templateStore.preloadSpaceTemplates(perspective);
      await datasetStore.switchDataset(perspective.uuid);
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

  async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<void> {
    const currentDataset = datasetStore.currentDataset();
    if (!currentDataset) return;
    const fileData = await compressImageToFileData(imageFile, field === 'avatar' ? 'space-image' : 'space-cover');
    const [spaceModel] = await Space.findAll(currentDataset, { where: spaceSelfWhere(currentDataset) });
    if (!spaceModel) return;
    await Space.update(currentDataset, spaceModel.id, { [field]: fileData });
    if (spaceModel.discovery === 'listed') {
      const globalP = datasetStore.globalDataset();
      if (globalP) {
        const imageOpt = field === 'avatar' ? { avatarData: fileData } : { coverImageData: fileData };
        await syncSpaceToParent(spaceModel, globalP, imageOpt).catch((err) =>
          console.error('SpaceStore: sync image to global failed', err),
        );
      }
    }
  }

  async function updateSpaceMeta(updates: SpaceMetaUpdate): Promise<void> {
    const currentDataset = datasetStore.currentDataset();
    if (!currentDataset) return;

    const [spaceModel] = await Space.findAll(currentDataset, {
      where: spaceSelfWhere(currentDataset),
      include: { location: true },
    });
    if (!spaceModel) return;

    const previousDiscovery = spaceModel.discovery;

    if (updates.name !== undefined) spaceModel.name = updates.name;
    if (updates.description !== undefined) spaceModel.description = updates.description;
    if (updates.discovery !== undefined) spaceModel.discovery = updates.discovery;
    await spaceModel.save();

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
        await ensureModelRegistered(currentDataset, LocationBlock);
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

    const globalP = datasetStore.globalDataset();
    if (!globalP) return;

    const effectiveDiscovery = updates.discovery ?? previousDiscovery;
    if (effectiveDiscovery === 'listed') {
      // Pass locationData explicitly when location changed — the included spaceModel.location
      // snapshot is stale after our delete+recreate. null signals explicit removal to syncSpaceToParent.
      const syncOpts = updates.location !== undefined ? { locationData: updates.location } : {};
      await syncSpaceToParent(spaceModel, globalP, syncOpts).catch((err) =>
        console.error('SpaceStore: sync meta to global failed', err),
      );
    } else if (previousDiscovery === 'listed') {
      await removeSpaceFromParent(spaceModel.uuid, globalP).catch((err) =>
        console.error('SpaceStore: remove from global failed', err),
      );
    }
  }

  async function createSignalType(config: Partial<SignalType>): Promise<void> {
    const p = datasetStore.currentDataset();
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
    const p = datasetStore.currentDataset();
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

  // Raw backend dialect lives in the adapter — see getFluxSubgroupMessages' doc comment there.
  async function getSubgroupMessages(subgroupId: string): Promise<FluxSubgroupMessage[]> {
    const p = datasetStore.currentDataset();
    if (!p) return [];
    try {
      return await getFluxSubgroupMessages(p, subgroupId);
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
  const enabledModules = createMemo<string[]>(() => {
    const raw = currentSpace()?.enabledModules;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
      } catch {
        // A malformed value is a corrupt setting, not a decision to disable everything.
        console.warn('space.enabledModules is not valid JSON; falling back to the registered set');
      }
    }
    return moduleRegistry.all().map((entry) => entry.definition.id);
  });

  const moduleSettings = createMemo(() => {
    const on = new Set(enabledModules());
    return moduleRegistry.all().map(({ definition }) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description ?? '',
      icon: definition.icon ?? 'puzzle-piece',
      enabled: on.has(definition.id),
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

  const moduleLaunchers = createMemo(() => {
    const on = new Set(enabledModules());
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

  async function setModuleEnabled(moduleId: string, enabled: boolean) {
    const space = currentSpace();
    if (!space) return;
    const next = new Set(enabledModules());
    if (enabled) next.add(moduleId);
    else next.delete(moduleId);
    // Writes the resolved list, not a diff — so the first toggle also pins everything that was on by
    // fallback, and a module added to the seed later doesn't silently appear in a space that had
    // already made a decision.
    space.enabledModules = JSON.stringify([...next]);
    try {
      await space.save();
      setCurrentSpace(space);
    } catch (error) {
      // A space created before this field existed has the old SHACL shape stored in its dataset,
      // and `we://enabled_modules` is not in it. Shapes are only installed when a class is absent
      // entirely (`hasSubjectClassLink`), so adding a property to an existing model does not
      // re-register — there is no shape-migration path yet.
      //
      // Reported rather than swallowed, and harmless either way: `enabledModules` falls back to the
      // registered set, so such a space keeps exactly the chrome it has today.
      console.warn(
        `could not persist enabledModules for this space — it predates the field and its stored ` +
          `SHACL shape has no "we://enabled_modules" property`,
        error,
      );
    }
  }

  // Subscribe to current space data reactively whenever the dataset changes.
  // include: { location: true } so AboutRoute can access location without a separate query.
  createEffect(() => {
    const p = datasetStore.currentDataset();
    if (!p || !datasetStore.isWeSpace()) {
      setCurrentSpace(null);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = (Space as any).query(p, { where: spaceSelfWhere(p), include: { location: true } }) as {
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
    const themeId = spaceDefaultThemeId();
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

  async function setSpaceDefaultTemplate(templateId: string): Promise<void> {
    setSpaceDefaultTemplateId(templateId);
    const template = templateStore.allTemplates().find((t) => t.id === templateId);
    if (template) templateStore.replaceTemplate(template);
    const p = datasetStore.currentDataset();
    if (!p) return;
    // Keep mySpaces cache in sync so template pre-loading uses the fresh defaultTemplateId
    updateSpaceInCache(p, { defaultTemplateId: templateId } as never);
    const [space] = await Space.findAll(p, { where: spaceSelfWhere(p) });
    if (space) await Space.update(p, space.id, { defaultTemplateId: templateId });
  }

  async function setSpaceDefaultTheme(themeId: string): Promise<void> {
    setSpaceDefaultThemeId(themeId);
    const p = datasetStore.currentDataset();
    if (!p) return;
    updateSpaceInCache(p, { defaultThemeId: themeId } as never);
    const [space] = await Space.findAll(p, { where: spaceSelfWhere(p) });
    if (space) await Space.update(p, space.id, { defaultThemeId: themeId });
  }

  // Load neighbourhood members whenever the current dataset changes
  createEffect(() => {
    const p = datasetStore.currentDataset();
    const lifecycle = session.lifecycle();
    const myDid = session.me()?.did;
    if (!p || !lifecycle?.members) {
      setMemberDids(myDid ? [myDid] : []);
      return;
    }
    lifecycle
      .members(p.uuid)
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

    // CID — neighbourhood space: find an already-joined local dataset by sharedUrl
    if (!seg.includes('-')) {
      const p = datasetStore.datasets().find((ap) => ap.sharedUrl === 'neighbourhood://' + seg);
      if (!p) {
        datasetStore.clearCurrentDataset();
        return;
      }
      const current = untrack(datasetStore.currentDataset);
      if (current?.uuid === p.uuid) return;
      void (async () => {
        await templateStore.preloadSpaceTemplates(p);
        await datasetStore.switchDataset(p.uuid);
      })();
      return;
    }

    // UUID — local/private dataset
    const current = untrack(datasetStore.currentDataset);
    if (current?.uuid === seg) return;
    const p = datasetStore.datasets().find((ap) => ap.uuid === seg);
    if (!p) return;
    void (async () => {
      await templateStore.preloadSpaceTemplates(p);
      await datasetStore.switchDataset(p.uuid);
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
    const p = datasetStore.currentDataset();
    const weSpace = datasetStore.isWeSpace();
    // Force a re-run once registerDynamicModels has populated the per-dataset registry —
    // that happens in switchDataset's background IIFE, strictly before currentDatasetModels
    // is set, so tracking it here guarantees a second run right when getModelForPerspective is ready.
    void datasetStore.currentDatasetModels();

    if (!p || weSpace) {
      setForeignSpacePrefill(null);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CommunityClass = getModelForPerspective('Community', p.uuid) as any;
    if (!CommunityClass) {
      setForeignSpacePrefill(null);
      return;
    }

    CommunityClass.findOne(p, {})
      .then((instance: { name?: string; description?: string; thumbnail?: string } | null) => {
        if (!instance || untrack(datasetStore.currentDataset)?.uuid !== p.uuid) return;
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
    creatingSpace,
    orderedSidebarItems,
    enabledModules,
    moduleSettings,
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
    launchModule,
    createSignalType,
    upsertSignal,
    navigateToSpace,
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
