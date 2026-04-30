import { LinkQuery, PerspectiveProxy } from '@coasys/ad4m';
import { registerModel } from '@shared/registries/modelRegistry';
import { useAdamStore } from '@solid/stores';
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
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

export interface SpaceStore {
  // State
  spaceId: Accessor<string>;
  perspective: Accessor<PerspectiveProxy | null>;
  space: Accessor<Partial<Space | null>>;
  loading: Accessor<boolean>;
  signalTypes: Accessor<SignalType[]>;
  signalTypesBySlug: Accessor<Record<string, SignalType>>;

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
  deriveSlug: (name: string) => string;
}

const SpaceContext = createContext<SpaceStore>();

// Register JS classes for $query model resolution
registerModel('CollectionBlock', CollectionBlock as any);
registerModel('TextBlock', TextBlock as any);
registerModel('ImageBlock', ImageBlock as any);
registerModel('Signal', Signal as any);
registerModel('SignalType', SignalType as any);

export function SpaceStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();

  // State
  const [spaceId, setSpaceId] = createSignal('');
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [space, setSpace] = createSignal<Partial<Space | null>>(null);
  const [loading, setLoading] = createSignal(true);

  // Signal types
  const [signalTypes, setSignalTypes] = createSignal<SignalType[]>([]);
  const signalTypesBySlug = createMemo(() => Object.fromEntries(signalTypes().map((st) => [st.slug, st])));

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
  /**
   * @deprecated SpaceStore now self-hydrates reactively when `adamStore.currentPerspective`
   * changes. Call `adamStore.setCurrentPerspective(uuid)` to trigger hydration.
   * This shim is kept for backwards compatibility with any direct callers.
   */
  async function getSpace(): Promise<void> {
    console.warn('[SpaceStore] getSpace() is deprecated — call adamStore.setCurrentPerspective(uuid) instead');
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
    const slugFromName = config.name ? deriveSlug(config.name) : '';
    const effectiveSlug = config.slug ? config.slug : slugFromName;
    const withSlug = { ...config, slug: effectiveSlug };
    const normalised =
      withSlug.mode && rangeOverrides[withSlug.mode] ? { ...withSlug, ...rangeOverrides[withSlug.mode] } : withSlug;
    const created = await SignalType.create(p, normalised);
    setSignalTypes((prev) => [...prev, created]);
  }

  function deriveSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
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
          // Remove the has_signals link FIRST (triggers subscription re-run so UI
          // de-highlights immediately), then delete the orphaned Signal node.
          // Pass the full LinkExpression (not link.data) so p.remove() can match it.
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
    await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://has_signals' } });
  }

  // Watch adamStore.currentPerspective() and hydrate the WE space layer on top.
  // For a WE space: Space.findAll returns a result, space chrome renders normally.
  // For a raw external perspective: Space.findAll returns [], setSpace(null) — space chrome hides.
  // For a mixed perspective: both layers hydrate simultaneously.
  createEffect(() => {
    const p = adamStore.currentPerspective();
    if (!p) {
      setPerspective(null);
      setSpace(null);
      setSignalTypes([]);
      return;
    }
    void (async () => {
      try {
        setLoading(true);
        const uuid = p.uuid;
        setSpaceId(uuid);

        // Skip block-model registration for we-root — it is never a WE space and
        // writing SHACL shapes to it permanently contaminates the model manifest.
        const rootUuid = adamStore.rootPerspective()?.uuid;
        if (uuid === rootUuid) {
          setPerspective(p);
          setSpace(null);
          setSignalTypes([]);
          console.log('[SpaceStore] skipped block registration for we-root');
          return;
        }

        // Confirm this perspective is actually a WE space before registering
        // block-model SHACL shapes. Registering them writes links to the
        // perspective permanently, so we must not do it for external perspectives.
        const [spaceModel] = await Space.findAll(p);
        if (spaceModel) {
          await Promise.all([
            CollectionBlock.register(p),
            TextBlock.register(p),
            ImageBlock.register(p),
            Signal.register(p),
            SignalType.register(p),
          ]);
          await new Promise((r) => setTimeout(r, 500)); // Delay needed after SHACL registration
        }

        setPerspective(p);
        setSpace(spaceModel ?? null);

        const signalTypeModels = spaceModel ? await SignalType.findAll(p) : [];
        setSignalTypes(signalTypeModels);
        console.log('[SpaceStore] hydrated perspective', uuid, 'space:', spaceModel ?? null);
      } catch (error) {
        console.error('SpaceStore: perspective hydration error', error);
      } finally {
        setLoading(false);
      }
    })();
  });

  const store: SpaceStore = {
    // State
    spaceId,
    perspective,
    space,
    loading,
    signalTypes,
    signalTypesBySlug,

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
    deriveSlug,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
