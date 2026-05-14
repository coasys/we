import { PerspectiveProxy } from '@coasys/ad4m';
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
  space: Accessor<Partial<Space | null>>;
  loading: Accessor<boolean>;
  signalTypes: Accessor<SignalType[]>;
  signalTypesBySlug: Accessor<Record<string, SignalType>>;

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
  const [space, setSpace] = createSignal<Partial<Space | null>>(null);
  const [loading, setLoading] = createSignal(true);

  // Signal types
  const [signalTypes, setSignalTypes] = createSignal<SignalType[]>([]);
  const signalTypesBySlug = createMemo(() => Object.fromEntries(signalTypes().map((st) => [st.slug, st])));

  async function test() {
    const p = adamStore.currentPerspective();
    if (!p) return;
    const spaces = await Space.findAll(p, { include: { location: true } });
    console.log('Spaces in perspective:', spaces);

    console.log('spaceId: ', p.uuid);
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
    const p = adamStore.currentPerspective();
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
    const currentPerspective = adamStore.currentPerspective();
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
    const currentPerspective = adamStore.currentPerspective();
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
    const p = adamStore.currentPerspective();
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
    const p = adamStore.currentPerspective();
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
    const p = adamStore.currentPerspective();
    const myDid = adamStore.me()?.did;
    if (!p || !myDid) return;

    const existing = await Signal.findOne(p, {
      parent: { id: nodeId, predicate: 'we://signal' },
      where: { signalTypeId, author: myDid },
    });

    if (existing) {
      // Remove if value is 0 (deselected)
      if (value === 0) await existing.delete();
      // Otherwise update with the new value
      else {
        existing.value = value;
        await existing.save();
      }
      return;
    }

    // No existing signal — create new (skip if value is 0)
    if (value === 0) return;
    await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://signal' } });
  }

  async function hydratePerspective(p: PerspectiveProxy, isCancelled: () => boolean): Promise<void> {
    // Ensure the Space SDNA is installed
    await installSpaceSdna(p);
    if (isCancelled()) return;

    // Get the Space model for the current perspective
    const spaceModel = await Space.findOne(p, { where: { uuid: p.uuid } });
    if (isCancelled()) return;
    setSpace(spaceModel ?? null);

    // Get the SignalType models for the current perspective
    if (spaceModel) {
      const fetchedSignalTypes = await SignalType.findAll(p);
      if (!isCancelled()) setSignalTypes(fetchedSignalTypes);
    }
  }

  // Watch currentPerspective() + currentPerspectiveModels() in the adamStore to trigger hydration of the WE space layer
  createEffect(() => {
    const perspective = adamStore.currentPerspective();
    const models = adamStore.currentPerspectiveModels();
    const isWeSpace = models.some((m) => m.targetClass === 'we://Space');

    // Track cancellation to avoid setting stale state after a perspective switch
    let cancelled = false;
    onCleanup(() => (cancelled = true));

    // No perspective or not a WE space: reset to initial state
    if (!perspective || !isWeSpace) {
      setSpace(null);
      setSignalTypes([]);
      return;
    }

    // Valid WE space perspective detected: hydrate it
    setLoading(true);
    hydratePerspective(perspective, () => cancelled)
      .catch((err) => {
        if (!cancelled) console.error('SpaceStore hydration error', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
  });

  const store: SpaceStore = {
    // State
    space,
    loading,
    signalTypes,
    signalTypesBySlug,

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
