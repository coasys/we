import { registerModel } from '@shared/registries/modelRegistry';
import { SPACE_MODELS } from '@shared/sdnaModels';
import { deriveSlug } from '@shared/utils';
import { useAdamStore } from '@solid/stores';
import { createBlocks } from '@we/block-shared';
import { AgentProfile, compressImageToFileData, LocationBlock, Signal, SignalType, Space } from '@we/models';
import { createContext, createEffect, ParentProps, useContext } from 'solid-js';

import { useRouteStore } from './RouteStore';
import { useTemplateStore } from './TemplateStore';

export type AgentProfileInput = Omit<Partial<AgentProfile>, 'avatar' | 'coverImage' | 'location'> & {
  avatar?: File | string;
  coverImage?: File | string;
  location?: Partial<LocationBlock>;
};

export interface SpaceStore {
  // Actions
  createPost: (json: unknown) => Promise<void>;
  updateSpaceImage: (field: 'avatar' | 'coverImage', imageFile: File) => Promise<void>;
  createSignalType: (config: Partial<SignalType>) => Promise<void>;
  upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
  createAgentProfile: (config: AgentProfileInput) => Promise<void>;
  navigateToSpace: (spaceId: string) => void;

  // Testing
  test: () => Promise<void>;
}

const SpaceContext = createContext<SpaceStore>();

// Register JS classes for $query model resolution (runs once at module load)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const M of SPACE_MODELS) registerModel(M.name, M as any);

export function SpaceStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();
  const routeStore = useRouteStore();
  const templateStore = useTemplateStore();

  async function test() {
    const p = adamStore.currentPerspective();
    if (!p) return;
    const spaces = await Space.findAll(p, { include: { location: true } });
    console.log('Spaces in perspective:', spaces);

    console.log('spaceId: ', p.uuid);

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
    const targetPath = '/space/' + spaceId + '/' + currentView;
    // Close any shell overlay (landing page, profile, settings, etc.) before navigating
    templateStore.closeShellView();
    routeStore.navigate(targetPath);
  }

  async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<void> {
    const currentPerspective = adamStore.currentPerspective();
    if (!currentPerspective) return;
    const fileData = await compressImageToFileData(imageFile, field === 'avatar' ? 'space-image' : 'space-cover');
    const [spaceModel] = await Space.findAll(currentPerspective, { where: { uuid: currentPerspective.uuid } });
    if (!spaceModel) return;
    await Space.update(currentPerspective, spaceModel.id, { [field]: fileData });
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
    await SignalType.create(p, normalised);
  }

  async function createAgentProfile(config: AgentProfileInput): Promise<void> {
    const p = adamStore.currentPerspective();
    if (!p) return;

    const { firstName, lastName, handle, bio, avatar, coverImage, location } = config;

    const avatarData = avatar instanceof File ? await compressImageToFileData(avatar, 'agent-avatar') : undefined;

    const coverImageData =
      coverImage instanceof File ? await compressImageToFileData(coverImage, 'agent-cover') : undefined;

    const profile = await AgentProfile.create(p, {
      firstName,
      lastName,
      handle,
      bio,
      ...(avatarData && { avatar: avatarData }),
      ...(coverImageData && { coverImage: coverImageData }),
    });

    if (location?.latitude != null && location?.longitude != null) {
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

    if (existing) await existing.delete();
    if (value === 0) return;
    await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://signal' } });
  }

  // Detect when entering a WE perspective with a Space model
  createEffect(() => {
    const models = adamStore.currentPerspectiveModels();
    const isWeSpace = models.some((m) => m.targetClass === 'we://Space');
    if (isWeSpace) console.log('Entering a WE space');
  });

  const store: SpaceStore = {
    // Actions
    createPost,
    updateSpaceImage,
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
