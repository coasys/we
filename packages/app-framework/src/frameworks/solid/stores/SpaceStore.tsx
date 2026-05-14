import { LinkQuery, PerspectiveProxy } from '@coasys/ad4m';
import { registerModel } from '@shared/registries/modelRegistry';
import { installSpaceSdna, SPACE_MODELS } from '@shared/spaceModels';
import { deriveSlug } from '@shared/utils';
import { useAdamStore } from '@solid/stores';
import { createBlocks } from '@we/block-shared';
import {
  AgentProfile,
  blobToDataURL,
  FileData,
  LocationBlock,
  resizeImage,
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
  useContext,
} from 'solid-js';

import { useRouteStore } from './RouteStore';

export type AgentProfileInput = Omit<Partial<AgentProfile>, 'avatar' | 'coverImage' | 'location'> & {
  avatar?: File | FileData | string;
  coverImage?: File | FileData | string;
  location?: Partial<LocationBlock>;
};

export interface SpaceStore {
  // State
  perspective: Accessor<PerspectiveProxy | null>;
  space: Accessor<Partial<Space | null>>;
  loading: Accessor<boolean>;
  signalTypes: Accessor<SignalType[]>;
  signalTypesBySlug: Accessor<Record<string, SignalType>>;
  hasJoined: Accessor<boolean>;

  // Actions
  createPost: (json: unknown) => Promise<void>;
  updateSpaceAvatar: (imageFile: File) => Promise<void>;
  updateSpaceCoverImage: (imageFile: File) => Promise<void>;
  createSignalType: (config: Partial<SignalType>) => Promise<void>;
  upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
  createAgentProfile: (config: AgentProfileInput) => Promise<void>;

  /** Navigate to a space by its spaceId (neighbourhood CID or local UUID), preserving the current sub-route view (falls back to 'globe'). */
  navigateToSpace: (spaceId: string) => void;

  test: () => Promise<void>;
}

const SpaceContext = createContext<SpaceStore>();

// Register JS classes for $query model resolution (runs once at module load)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const M of SPACE_MODELS) registerModel(M.name, M as any);

export function SpaceStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();
  const routeStore = useRouteStore();

  // State
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [space, setSpace] = createSignal<Partial<Space | null>>(null);
  const [loading, setLoading] = createSignal(true);

  // Signal types
  const [signalTypes, setSignalTypes] = createSignal<SignalType[]>([]);
  const signalTypesBySlug = createMemo(() => Object.fromEntries(signalTypes().map((st) => [st.slug, st])));

  const hasJoined = createMemo(() => perspective() !== null);

  async function test() {
    const p = perspective();
    if (!p) return;
    const spaces = await Space.findAll(p, { include: { location: true } });
    console.log('Spaces in perspective:', spaces);

    console.log('spaceId: ', perspective()?.uuid);
    console.log('space: ', space());

    // const posts = await CollectionBlock.findAll(p, {
    //   where: { type: 'root' },
    //   include: {
    //     signals: true,
    //     $mySignal: {
    //       from: 'signals',
    //       where: { signalTypeId: signalTypesBySlug().like.id, author: adamStore!.me().did },
    //     },
    //     $totalSignals: { from: 'signals', where: { signalTypeId: signalTypesBySlug().like.id }, count: true },
    //   },
    // });
    // console.log('Posts in perspective:', posts);
  }

  async function createPost(json: unknown): Promise<void> {
    const p = perspective();
    if (!p) return;
    await createBlocks(p, json);
  }

  function navigateToSpace(spaceId: string): void {
    const segs = routeStore.segments();
    const currentView = segs[0] === 'space' && segs[2] ? segs[2] : 'globe';
    routeStore.navigate('/space/' + spaceId + '/' + currentView);
  }

  async function updateSpaceAvatar(imageFile: File): Promise<void> {
    const currentSpace = space();
    const currentPerspective = perspective();
    if (!currentSpace || !currentPerspective) return;
    const compressedBlob = await resizeImage(imageFile, 0.6);
    const imageBase64 = await blobToDataURL(compressedBlob);
    const [spaceModel] = await Space.findAll(currentPerspective, { where: { uuid: currentPerspective.uuid } });
    if (!spaceModel) return;
    spaceModel.avatar = { data_base64: imageBase64, name: 'space-image', file_type: 'image/png' } as FileData;
    await spaceModel.save();
    setSpace({ ...currentSpace, avatar: spaceModel.avatar });
  }

  async function updateSpaceCoverImage(imageFile: File): Promise<void> {
    const currentSpace = space();
    const currentPerspective = perspective();
    if (!currentSpace || !currentPerspective) return;
    const compressedBlob = await resizeImage(imageFile, 0.6);
    const imageBase64 = await blobToDataURL(compressedBlob);
    const [spaceModel] = await Space.findAll(currentPerspective, { where: { uuid: currentPerspective.uuid } });
    if (!spaceModel) return;
    spaceModel.coverImage = { data_base64: imageBase64, name: 'space-cover', file_type: 'image/png' } as FileData;
    await spaceModel.save();
    setSpace({ ...currentSpace, coverImage: spaceModel.coverImage });
  }

  async function createSignalType(config: Partial<SignalType>): Promise<void> {
    const p = perspective();
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
    const created = await SignalType.create(p, normalised);
    setSignalTypes((prev) => [...prev, created]);
  }

  async function createAgentProfile(config: AgentProfileInput): Promise<void> {
    const p = perspective();
    if (!p) return;

    const { firstName, lastName, handle, bio, avatar, coverImage, location } = config;

    let avatarData: FileData | undefined;
    if (avatar instanceof File) {
      const resized = await resizeImage(avatar, 0.6);
      avatarData = {
        data_base64: await blobToDataURL(resized),
        name: 'agent-avatar',
        file_type: 'image/png',
      } as FileData;
    }

    let coverImageData: FileData | undefined;
    if (coverImage instanceof File) {
      const resized = await resizeImage(coverImage, 0.6);
      coverImageData = {
        data_base64: await blobToDataURL(resized),
        name: 'agent-cover',
        file_type: 'image/png',
      } as FileData;
    }

    const profile = await AgentProfile.create(p, {
      firstName,
      lastName,
      handle,
      bio,
      ...(avatarData && { avatar: avatarData }),
      ...(coverImageData && { coverImage: coverImageData }),
    });

    if (location?.latitude != null && location?.longitude != null) {
      await LocationBlock.register(p);
      const { city, country } = location;
      const locationName = city && country ? `${city}, ${country}` : (city ?? country ?? undefined);
      const loc = await LocationBlock.create(p, { ...location, ...(locationName && { name: locationName }) });
      await profile.setLocation(loc);
    }
  }

  async function upsertSignal(nodeId: string, signalTypeId: string, value: number): Promise<void> {
    const p = perspective();
    const myDid = adamStore.me()?.did;
    if (!p || !myDid) return;

    // TODO: simplify this - no need to query links, just get signals directly and use where to filter out my entires
    const nodeLinks = await p.get(new LinkQuery({ source: nodeId, predicate: 'we://signal' }));
    const myLinks = nodeLinks.filter((l) => l.author === myDid);

    for (const link of myLinks) {
      const [existing] = await Signal.findAll(p, { where: { id: link.data.target, signalTypeId } });
      if (existing) {
        if (value === 0) {
          await p.remove(link);
          await existing.delete();
        } else {
          existing.value = value;
          await existing.save();
        }
        return;
      }
    }

    // No existing signal — create new (skip if value is 0)
    if (value === 0) return;
    await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://signal' } });
  }

  // Resolve the route segment to a local perspective whenever the route changes.
  // Two cases:
  //   CID  — neighbourhood space (no hyphens, no '://'): look up by sharedUrl
  //   UUID — local/private perspective (contains '-'): set directly by UUID
  createEffect(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || !segs[1]) return;
    const seg = segs[1];

    // CID — neighbourhood space: find an already-joined local perspective by sharedUrl
    if (!seg.includes('-')) {
      const p = adamStore.allPerspectives().find((ap) => ap.sharedUrl === 'neighbourhood://' + seg);
      if (p) {
        const current = adamStore.currentPerspective();
        if (current?.uuid !== p.uuid) void adamStore.setCurrentPerspective(p.uuid);
      }
      // If no local perspective exists: hasJoined stays false → join gate is shown
      return;
    }

    // UUID — local/private perspective: set directly
    const current = adamStore.currentPerspective();
    if (current?.uuid !== seg) void adamStore.setCurrentPerspective(seg);
  });

  // Watch adamStore.currentPerspective() and hydrate the WE space layer on top.
  // For a raw external perspective: Space.findAll returns [], setSpace(null) — space chrome hides.
  // For a mixed perspective: both layers hydrate simultaneously.
  let _lastHydratedUuid = '';
  createEffect(() => {
    const p = adamStore.currentPerspective();

    // Cancel any in-flight hydration from a previous run of this effect.
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    if (!p) {
      _lastHydratedUuid = '';
      setPerspective(null);
      setSpace(null);
      setSignalTypes([]);
      return;
    }

    // Only clear signal types when switching to a DIFFERENT perspective so that
    // the UI doesn't flash on re-hydrations of the same perspective.
    if (p.uuid !== _lastHydratedUuid) {
      setSignalTypes([]);
    }
    setLoading(true);

    void (async () => {
      try {
        const uuid = p.uuid;
        _lastHydratedUuid = uuid;

        // Skip block-model registration for system perspectives (we-root, we-test)
        const rootUuid = adamStore.rootPerspective()?.uuid;
        const systemUuids = adamStore.systemPerspectiveUuids();
        if (systemUuids.includes(uuid)) {
          if (cancelled) return;
          setPerspective(p);
          setSpace(null);
          void rootUuid;
          return;
        }

        await installSpaceSdna(p);
        await new Promise((r) => setTimeout(r, 500)); // Delay needed after SHACL registration
        if (cancelled) return;

        // Filter by uuid === perspective.uuid so we get only the root Space for this
        // perspective. Perspectives like we-global contain multiple Space entries
        // (itself + seeded children) and SPARQL order is non-deterministic.
        const [spaceModel] = await Space.findAll(p, { where: { uuid: p.uuid } });
        if (cancelled) return;

        setPerspective(p);
        setSpace(spaceModel ?? null);

        if (spaceModel) {
          const [fetchedSignalTypes] = await Promise.all([SignalType.findAll(p)]);
          if (cancelled) return;
          setSignalTypes(fetchedSignalTypes);
        }
      } catch (error) {
        if (!cancelled) console.error('SpaceStore: perspective hydration error', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
  });

  const store: SpaceStore = {
    // State
    perspective,
    space,
    loading,
    signalTypes,
    signalTypesBySlug,

    // Holarchy
    hasJoined,

    // Actions
    createPost,
    updateSpaceAvatar,
    updateSpaceCoverImage,
    createSignalType,
    upsertSignal,
    createAgentProfile,

    navigateToSpace,

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
