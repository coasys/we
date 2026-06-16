import type { AgentProfileSummary } from '@shared/agentHelpers';
import { registerModel } from '@shared/registries/modelRegistry';
import { SPACE_MODELS } from '@shared/sdnaModels';
import { type LocationData, removeSpaceFromParent, syncSpaceToParent } from '@shared/syncHelpers';
import { deriveSlug } from '@shared/utils';
import { useAdamStore } from '@solid/stores';
import { createBlocks, deleteBlocks, reconcileBlocks } from '@we/block-shared';
import { CollectionBlock, compressImageToFileData, LocationBlock, Signal, SignalType, Space } from '@we/models';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { useRouteStore } from './RouteStore';
import { useTemplateStore } from './TemplateStore';

export interface SpaceMetaUpdate {
  name?: string;
  description?: string;
  discovery?: 'listed' | 'hidden';
  location?: LocationData;
}

export interface SpaceStore {
  // State
  memberDids: Accessor<string[]>;
  members: Accessor<AgentProfileSummary[]>;

  // Actions
  createPost: (json: unknown) => Promise<void>;
  updatePost: (postId: string, json: unknown) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  updateSpaceImage: (field: 'avatar' | 'coverImage', imageFile: File) => Promise<void>;
  updateSpaceMeta: (updates: SpaceMetaUpdate) => Promise<void>;
  createSignalType: (config: Partial<SignalType>) => Promise<void>;
  upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
  navigateToSpace: (spaceId: string) => void;
  enterSpace: (url: string) => Promise<void>;

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

  async function updatePost(postId: string, json: unknown): Promise<void> {
    const p = adamStore.currentPerspective();
    if (!p) return;
    const existingRoot = await CollectionBlock.findOne(p, { where: { id: postId } });
    if (!existingRoot) return;
    await reconcileBlocks(p, existingRoot, json);
  }

  async function deletePost(postId: string): Promise<void> {
    const p = adamStore.currentPerspective();
    if (!p) return;
    await deleteBlocks(p, postId);
  }

  async function enterSpace(url: string): Promise<void> {
    const perspective = adamStore.allPerspectives().find((p) => p.sharedUrl === 'neighbourhood://' + url);
    if (!perspective) return;
    await adamStore.switchPerspective(perspective.uuid);
    navigateToSpace(url);
  }

  function navigateToSpace(spaceId: string): void {
    const segs = routeStore.segments();
    const currentView = segs[0] === 'space' && segs[2] ? segs[2] : 'cards';
    const targetPath = '/space/' + spaceId + '/' + currentView;
    // Close any shell overlay (landing page, profile, settings, etc.) before navigating
    templateStore.closeShellView();
    routeStore.navigate(targetPath);
    // Notify embedded app iframes (e.g. Flux) so they can navigate to the matching community
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
    const currentPerspective = adamStore.currentPerspective();
    if (!currentPerspective) return;
    const fileData = await compressImageToFileData(imageFile, field === 'avatar' ? 'space-image' : 'space-cover');
    const [spaceModel] = await Space.findAll(currentPerspective, { where: { uuid: currentPerspective.uuid } });
    if (!spaceModel) return;
    await Space.update(currentPerspective, spaceModel.id, { [field]: fileData });
    if (spaceModel.discovery === 'listed') {
      const globalP = adamStore.globalPerspective();
      if (globalP) {
        const imageOpt = field === 'avatar' ? { avatarData: fileData } : { coverImageData: fileData };
        await syncSpaceToParent(spaceModel, globalP, imageOpt).catch((err) =>
          console.error('SpaceStore: sync image to global failed', err),
        );
      }
    }
  }

  async function updateSpaceMeta(updates: SpaceMetaUpdate): Promise<void> {
    const currentPerspective = adamStore.currentPerspective();
    if (!currentPerspective) return;

    const [spaceModel] = await Space.findAll(currentPerspective, {
      where: { uuid: currentPerspective.uuid },
      include: { location: true },
    });
    if (!spaceModel) return;

    const previousDiscovery = spaceModel.discovery;

    if (updates.name !== undefined) spaceModel.name = updates.name;
    if (updates.description !== undefined) spaceModel.description = updates.description;
    if (updates.discovery !== undefined) spaceModel.discovery = updates.discovery;
    await spaceModel.save();

    if (updates.location !== undefined) {
      const loc = updates.location;
      await LocationBlock.register(currentPerspective);
      if (spaceModel.location) {
        spaceModel.location.latitude = loc.latitude;
        spaceModel.location.longitude = loc.longitude;
        if (loc.name !== undefined) spaceModel.location.name = loc.name;
        if (loc.city !== undefined) spaceModel.location.city = loc.city;
        if (loc.country !== undefined) spaceModel.location.country = loc.country;
        if (loc.countryCode !== undefined) spaceModel.location.countryCode = loc.countryCode;
        await spaceModel.location.save();
      } else {
        const newLoc = await LocationBlock.create(currentPerspective, {
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

    const globalP = adamStore.globalPerspective();
    if (!globalP) return;

    const effectiveDiscovery = updates.discovery ?? previousDiscovery;
    if (effectiveDiscovery === 'listed') {
      await syncSpaceToParent(spaceModel, globalP).catch((err) =>
        console.error('SpaceStore: sync meta to global failed', err),
      );
    } else if (previousDiscovery === 'listed') {
      await removeSpaceFromParent(spaceModel.uuid, globalP).catch((err) =>
        console.error('SpaceStore: remove from global failed', err),
      );
    }
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

  const [memberDids, setMemberDids] = createSignal<string[]>([]);

  // Load neighbourhood members whenever the current perspective changes
  createEffect(() => {
    const p = adamStore.currentPerspective();
    const client = adamStore.adamClient();
    const myDid = adamStore.me()?.did;
    if (!p || !client) {
      setMemberDids(myDid ? [myDid] : []);
      return;
    }
    client.neighbourhood
      .otherAgents(p.uuid)
      .then((dids: string[]) => {
        const allDids = myDid ? [...new Set([myDid, ...dids])] : dids;
        setMemberDids(allDids);
        for (const did of allDids) {
          adamStore.fetchAgent(did);
        }
      })
      .catch(() => {
        setMemberDids(myDid ? [myDid] : []);
      });
  });

  // Map memberDids to cached AgentProfileSummary entries
  const members = createMemo<AgentProfileSummary[]>(() => {
    const cached = adamStore.agents();
    return memberDids()
      .map((did) => cached.find((a) => a.did === did))
      .filter((a): a is AgentProfileSummary => a != null);
  });

  // Detect when entering a WE perspective with a Space model
  createEffect(() => {
    const models = adamStore.currentPerspectiveModels();
    const isWeSpace = models.some((m) => m.targetClass === 'we://Space');
    if (isWeSpace) console.log('Entering a WE space');
    else console.log('Entering a non-WE space');
  });

  const store: SpaceStore = {
    // State
    memberDids,
    members,

    // Actions
    createPost,
    updatePost,
    deletePost,
    updateSpaceImage,
    updateSpaceMeta,
    createSignalType,
    upsertSignal,
    navigateToSpace,
    enterSpace,

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
