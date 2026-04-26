import { LinkQuery, PerspectiveProxy } from '@coasys/ad4m';
import { registerModel } from '@shared/registries/modelRegistry';
import { useAdamStore, useRouteStore } from '@solid/stores';
import { createBlocks } from '@we/block-shared';
import {
  blobToDataURL,
  CollectionBlock,
  FileData,
  ImageBlock,
  resizeImage,
  Signal,
  SignalType,
  Space,
  TextBlock,
} from '@we/models';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

export interface SpaceStore {
  // State
  spaceId: Accessor<string>;
  perspective: Accessor<PerspectiveProxy | null>;
  space: Accessor<Partial<Space | null>>;
  loading: Accessor<boolean>;

  // Layer visibility
  showUserLocations: Accessor<boolean>;
  showCountryOutlines: Accessor<boolean>;
  showH3Hexagons: Accessor<boolean>;

  // Background visibility
  showSkybox: Accessor<boolean>;
  showStars: Accessor<boolean>;
  showSolarSystem: Accessor<boolean>;

  // Setters
  setSpaceId: (id: string) => void;

  // Actions
  getSpace: () => Promise<void>;
  createPost: (json: unknown) => Promise<void>;
  toggleLayer: (layerName: string) => void;
  toggleBackground: (backgroundName: string) => void;
  updateSpaceImage: (imageFile: File) => Promise<void>;
  updateSpaceCoverImage: (imageFile: File) => Promise<void>;
  createSignalType: (config: Partial<SignalType>) => Promise<void>;
  upsertSignal: (nodeId: string, signalTypeId: string, value: number) => Promise<void>;
}

const SpaceContext = createContext<SpaceStore>();

// Register JS classes for $query model resolution
registerModel('CollectionBlock', CollectionBlock as any);
registerModel('TextBlock', TextBlock as any);
registerModel('ImageBlock', ImageBlock as any);
registerModel('Signal', Signal as any);
registerModel('SignalType', SignalType as any);

export function SpaceStoreProvider(props: ParentProps) {
  const routeStore = useRouteStore();
  const adamStore = useAdamStore();

  // State
  const [spaceId, setSpaceId] = createSignal('');
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [space, setSpace] = createSignal<Partial<Space | null>>(null);
  const [loading, setLoading] = createSignal(true);

  // Layer visibility state
  const [showUserLocations, setShowUserLocations] = createSignal(true);
  const [showCountryOutlines, setShowCountryOutlines] = createSignal(true);
  const [showH3Hexagons, setShowH3Hexagons] = createSignal(false);

  // Background visibility state
  const [showSkybox, setShowSkybox] = createSignal(true);
  const [showStars, setShowStars] = createSignal(true);
  const [showSolarSystem, setShowSolarSystem] = createSignal(false);

  // Toggle layer visibility
  function toggleLayer(layerName: string) {
    switch (layerName) {
      case 'userLocations':
        setShowUserLocations(!showUserLocations());
        break;
      case 'countryOutlines':
        setShowCountryOutlines(!showCountryOutlines());
        break;
      case 'h3Hexagons':
        setShowH3Hexagons(!showH3Hexagons());
        break;
    }
  }

  // Toggle background visibility
  function toggleBackground(backgroundName: string) {
    console.log('[SpaceStore] toggleBackground called:', backgroundName);
    switch (backgroundName) {
      case 'skybox':
        const newSkyboxValue = !showSkybox();
        setShowSkybox(newSkyboxValue);
        console.log('[SpaceStore] showSkybox toggled to:', newSkyboxValue);
        break;
      case 'stars':
        const newStarsValue = !showStars();
        setShowStars(newStarsValue);
        console.log('[SpaceStore] showStars toggled to:', newStarsValue);
        break;
      case 'solarSystem':
        const newSolarSystemValue = !showSolarSystem();
        setShowSolarSystem(newSolarSystemValue);
        console.log('[SpaceStore] showSolarSystem toggled to:', newSolarSystemValue);
        break;
    }
  }

  // Actions
  async function getSpace(): Promise<void> {
    try {
      console.log('[SpaceStore] getSpace called with spaceId:', spaceId());
      setLoading(true);
      if (!adamStore.adamClient() || !spaceId()) return;
      const spacePerspective = await adamStore.adamClient()!.perspective.byUUID(spaceId());
      if (!spacePerspective) return;

      // Register SHACL schemas on perspective so block models can be queried
      await Promise.all([
        CollectionBlock.register(spacePerspective),
        TextBlock.register(spacePerspective),
        ImageBlock.register(spacePerspective),
        Signal.register(spacePerspective),
        SignalType.register(spacePerspective),
      ]);
      await new Promise((r) => setTimeout(r, 500)); // Delay needed after SHACL registration

      const [spaceModel] = await Space.findAll(spacePerspective);
      setPerspective(spacePerspective);
      console.log('[SpaceStore] getSpace loaded space:', spaceModel);
      setSpace(spaceModel);

      // log out signals
      const signals = await SignalType.findAll(spacePerspective);
      console.log('[SpaceStore] getSpace loaded signals:', signals);
    } catch (error) {
      console.error('SpaceStore: getSpace error', error);
    } finally {
      setLoading(false);
    }
  }

  async function createPost(json: unknown): Promise<void> {
    const p = perspective();
    if (!p) return;
    await createBlocks(p, json);
  }

  async function updateSpaceImage(imageFile: File): Promise<void> {
    const currentSpace = space();
    const currentPerspective = perspective();
    if (!currentSpace || !currentPerspective) return;
    const compressedBlob = await resizeImage(imageFile, 0.6);
    const imageBase64 = await blobToDataURL(compressedBlob);
    const [spaceModel] = await Space.findAll(currentPerspective);
    if (!spaceModel) return;
    spaceModel.image = { data_base64: imageBase64, name: 'space-image', file_type: 'image/png' } as FileData;
    await spaceModel.save();
    setSpace({ ...currentSpace, image: spaceModel.image });
  }

  async function updateSpaceCoverImage(imageFile: File): Promise<void> {
    const currentSpace = space();
    const currentPerspective = perspective();
    if (!currentSpace || !currentPerspective) return;
    const compressedBlob = await resizeImage(imageFile, 0.6);
    const imageBase64 = await blobToDataURL(compressedBlob);
    const [spaceModel] = await Space.findAll(currentPerspective);
    if (!spaceModel) return;
    spaceModel.thumbnail = { data_base64: imageBase64, name: 'space-cover', file_type: 'image/png' } as FileData;
    await spaceModel.save();
    setSpace({ ...currentSpace, thumbnail: spaceModel.thumbnail });
  }

  async function createSignalType(config: Partial<SignalType>): Promise<void> {
    const p = perspective();
    if (!p) return;
    // Fixed ranges for modes where the user doesn't configure them
    const rangeOverrides: Record<string, { rangeMin: number; rangeMax: number }> = {
      toggle: { rangeMin: 0, rangeMax: 1 },
      vote: { rangeMin: -1, rangeMax: 1 },
    };
    const normalised =
      config.mode && rangeOverrides[config.mode] ? { ...config, ...rangeOverrides[config.mode] } : config;
    await SignalType.create(p, normalised);
  }

  async function upsertSignal(nodeId: string, signalTypeId: string, value: number): Promise<void> {
    const p = perspective();
    const myDid = adamStore.me()?.did;
    if (!p || !myDid) return;

    const nodeLinks = await p.get(new LinkQuery({ source: nodeId, predicate: 'we://has_signals' }));
    const myLinks = nodeLinks.filter((l) => l.author === myDid);

    for (const link of myLinks) {
      const [existing] = await Signal.findAll(p, { where: { id: link.data.target, signalTypeId } });
      if (existing) {
        if (value === 0) {
          // Toggle off — delete the signal node and its links
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
    await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://has_signals' } });
  }

  // Listen for route changes and get space data when spaceId changes
  createEffect(() => {
    const [page, pageId] = routeStore.currentPath().split('/').filter(Boolean);
    if (page === 'space' && pageId && pageId !== spaceId()) {
      setSpaceId(pageId);
      getSpace();
    }
  });

  const store: SpaceStore = {
    // State
    spaceId,
    perspective,
    space,
    loading,

    // Layer visibility
    showUserLocations,
    showCountryOutlines,
    showH3Hexagons,

    // Background visibility
    showSkybox,
    showStars,
    showSolarSystem,

    // Setters
    setSpaceId,

    // Actions
    getSpace,
    createPost,
    toggleLayer,
    toggleBackground,
    updateSpaceImage,
    updateSpaceCoverImage,
    createSignalType,
    upsertSignal,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
