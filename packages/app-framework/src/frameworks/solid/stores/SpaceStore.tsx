import { LinkQuery, PerspectiveProxy } from '@coasys/ad4m';
import { registerModel } from '@shared/registries/modelRegistry';
import { useAdamStore } from '@solid/stores';
import { createBlocks } from '@we/block-shared';
import { AgentProfile, blobToDataURL, FileData, resizeImage, Signal, SignalType, Space } from '@we/models';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { useRouteStore } from './RouteStore';
import { installSpaceSdna, SPACE_MODELS } from './spaceModels';
import { buildDiscoveryData, type GlobePin } from './syncHelpers';

/** Per-signal-type aggregate for the currently selected entity's react bar. **/
export interface EntitySignalData {
  nodeId: string;
  signalType: SignalType;
  totalValue: number;
  myValue: number;
}

/**
 * A single node in the holarchic navigation path.
 * `isJoined` is true when the agent has a local perspective for this space.
 * `perspective` is null when the agent has navigated to an unjoined space (gate shown).
 */
export interface HolarchyNode {
  perspective: PerspectiveProxy | null;
  space: Space | null;
  isJoined: boolean;
}

export { type GlobePin } from './syncHelpers';

export interface SpaceStore {
  // State
  spaceId: Accessor<string>;
  perspective: Accessor<PerspectiveProxy | null>;
  space: Accessor<Partial<Space | null>>;
  loading: Accessor<boolean>;
  signalTypes: Accessor<SignalType[]>;
  signalTypesBySlug: Accessor<Record<string, SignalType>>;

  // Discovery (per-space holonic data — mirrors GlobalStore's global-root data)
  /** Child spaces found inside the current space's perspective. */
  childSpaces: Accessor<Space[]>;
  /** Agent profiles of members in the current space's perspective. */
  members: Accessor<AgentProfile[]>;
  /** Globe pins derived from child-space location blocks. */
  spaceLocationPins: Accessor<GlobePin[]>;
  /** Globe pins derived from member location blocks. */
  memberLocationPins: Accessor<GlobePin[]>;

  // Selection (which pin the user clicked on the globe)
  selectedPin: Accessor<GlobePin | null>;
  /** Space model for the selected pin (null when an agent pin is selected). */
  selectedSpace: Accessor<Space | null>;
  /** Agent model for the selected pin (null when a space pin is selected). */
  selectedAgent: Accessor<AgentProfile | null>;
  selectedEntitySignalData: Accessor<EntitySignalData[]>;
  setSelectedPin: (pin: GlobePin) => void;
  clearSelectedPin: () => void;
  upsertEntitySignal: (signalTypeId: string, value: number) => Promise<void>;

  // Layer visibility
  showUserLocations: Accessor<boolean>;
  showCountryOutlines: Accessor<boolean>;
  showH3Hexagons: Accessor<boolean>;

  // Background visibility
  showSkybox: Accessor<boolean>;
  showStars: Accessor<boolean>;
  showSolarSystem: Accessor<boolean>;

  // Holarchy
  /** Full path from the global root down to the currently-viewed node. */
  holarchyPath: Accessor<HolarchyNode[]>;
  /**
   * The node currently being viewed at `/space/:id`.
   * - `null` when at the globe route (no specific space selected).
   * - `isJoined === false` when the perspective does not exist locally (gate shows).
   */
  currentNode: Accessor<HolarchyNode | null>;

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
  /**
   * Navigate into a child space by UUID (extends holarchyPath).
   * Calls `adamStore.setCurrentPerspective` and updates the path.
   */
  navigateInto: (uuid: string) => Promise<void>;
  /** Pop one level from the holarchyPath (navigate up to parent). */
  navigateUp: () => void;
}

const SpaceContext = createContext<SpaceStore>();

// Register JS classes for $query model resolution (runs once at module load)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const M of SPACE_MODELS) registerModel(M.name, M as any);

export function SpaceStoreProvider(props: ParentProps) {
  const adamStore = useAdamStore();
  const routeStore = useRouteStore();

  // State
  const [spaceId, setSpaceId] = createSignal('');
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [space, setSpace] = createSignal<Partial<Space | null>>(null);
  const [loading, setLoading] = createSignal(true);

  // Signal types
  const [signalTypes, setSignalTypes] = createSignal<SignalType[]>([]);
  const signalTypesBySlug = createMemo(() => Object.fromEntries(signalTypes().map((st) => [st.slug, st])));

  // Discovery data (holonic: same shape as GlobalStore but for the current space)
  const [childSpaces, setChildSpaces] = createSignal<Space[]>([]);
  const [members, setMembers] = createSignal<AgentProfile[]>([]);
  type WithSignalCount = { $signalCount?: number };

  const spaceLocationPins = createMemo<GlobePin[]>(() =>
    childSpaces().flatMap((s) =>
      (s.locations ?? [])
        .filter((loc) => loc.latitude != null && loc.longitude != null)
        .map((loc) => ({
          id: s.id,
          kind: 'space' as const,
          name: s.name,
          latitude: loc.latitude,
          longitude: loc.longitude,
          signalEnergy: (s as unknown as WithSignalCount).$signalCount ?? 0,
        })),
    ),
  );

  const memberLocationPins = createMemo<GlobePin[]>(() =>
    members().flatMap((a) => {
      const loc = a.location;
      if (!loc || loc.latitude == null || loc.longitude == null) return [];
      return [
        {
          id: a.id,
          kind: 'agent' as const,
          name: [a.firstName, a.lastName].filter(Boolean).join(' ') || a.handle,
          latitude: loc.latitude,
          longitude: loc.longitude,
          signalEnergy: (a as unknown as WithSignalCount).$signalCount ?? 0,
        },
      ];
    }),
  );

  // Selection state
  const [selectedPin, setSelectedPin] = createSignal<GlobePin | null>(null);
  const [selectedEntitySignalData, setSelectedEntitySignalData] = createSignal<EntitySignalData[]>([]);
  const [selectedEntitySignals, setSelectedEntitySignals] = createSignal<Signal[]>([]);

  const selectedSpace = createMemo<Space | null>(() =>
    selectedPin()?.kind === 'space' ? (childSpaces().find((s) => s.id === selectedPin()!.id) ?? null) : null,
  );
  const selectedAgent = createMemo<AgentProfile | null>(() =>
    selectedPin()?.kind === 'agent' ? (members().find((a) => a.id === selectedPin()!.id) ?? null) : null,
  );

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
    switch (backgroundName) {
      case 'skybox':
        setShowSkybox(!showSkybox());
        break;
      case 'stars':
        setShowStars(!showStars());
        break;
      case 'solarSystem':
        setShowSolarSystem(!showSolarSystem());
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

  // --- Selection actions ---

  async function loadEntitySignalData(pin: GlobePin | null, stypes: SignalType[], myDid?: string): Promise<void> {
    const p = perspective();
    if (!pin || !p || !stypes.length) {
      setSelectedEntitySignalData([]);
      setSelectedEntitySignals([]);
      return;
    }
    const nodeId = pin.id;
    const results =
      pin.kind === 'space'
        ? await Space.findAll(p, { where: { id: nodeId }, include: { signals: true } })
        : await AgentProfile.findAll(p, { where: { id: nodeId }, include: { signals: true } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sigs: Signal[] = (results[0] as any)?.signals ?? [];
    setSelectedEntitySignals(sigs);
    const signalsByType: Record<string, { count: number; sum: number; myValue: number }> = {};
    for (const sig of sigs) {
      const entry = signalsByType[sig.signalTypeId] ?? { count: 0, sum: 0, myValue: 0 };
      entry.count++;
      entry.sum += sig.value;
      if (sig.author === myDid) entry.myValue = sig.value;
      signalsByType[sig.signalTypeId] = entry;
    }
    const rows: EntitySignalData[] = stypes.map((st) => {
      const entry = signalsByType[st.id] ?? { count: 0, sum: 0, myValue: 0 };
      let totalValue = 0;
      if (st.aggregate === 'count') totalValue = entry.count;
      else if (st.aggregate === 'sum') totalValue = entry.sum;
      else if (st.aggregate === 'mean') totalValue = entry.count ? entry.sum / entry.count : 0;
      return { nodeId, signalType: st, totalValue, myValue: entry.myValue };
    });
    setSelectedEntitySignalData(rows);
  }

  function clearSelectedPin(): void {
    setSelectedPin(null);
    setSelectedEntitySignals([]);
  }

  async function upsertEntitySignal(signalTypeId: string, value: number): Promise<void> {
    const p = perspective();
    const myDid = adamStore.me()?.did;
    const nodeId = selectedPin()?.id;
    if (!p || !myDid || !nodeId) return;
    const existing = selectedEntitySignals().find((s) => s.signalTypeId === signalTypeId && s.author === myDid);
    if (existing) {
      if (value === 0) {
        await existing.delete();
      } else {
        existing.value = value;
        await existing.save();
      }
    } else if (value !== 0) {
      await Signal.create(p, { signalTypeId, value }, { parent: { id: nodeId, predicate: 'we://signal' } });
    }
    void loadEntitySignalData(selectedPin(), signalTypes(), myDid);
  }

  // Reload signal data when selected pin or signal types change
  createEffect(() => {
    const pin = selectedPin();
    const stypes = signalTypes();
    const myDid = adamStore.me()?.did;
    void loadEntitySignalData(pin, stypes, myDid);
  });

  // Also clear selection when perspective changes
  createEffect(() => {
    adamStore.currentPerspective();
    setSelectedPin(null);
  });

  /**
   * The node currently shown at `/space/:id`.
   * Returns null when not on a `/space/...` route.
   * `/space/global` is the well-known sentinel for the root global space — resolves
   * directly from `adamStore.globalPerspective()` without the normal loading cycle.
   * Returns `{ isJoined: false }` when the route points at an unjoined perspective.
   */
  const currentNode = createMemo<HolarchyNode | null>(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space') return null;

    // /space/global is the sentinel for the root global space
    if (segs[1] === 'global') {
      const globalP = adamStore.globalPerspective();
      if (!globalP) return { perspective: null, space: null, isJoined: false };
      return { perspective: globalP, space: null, isJoined: true };
    }

    if (!segs[1]) return null;
    // Suppress gate flicker while async hydration is in progress
    if (loading()) return null;

    const p = perspective();
    const s = space();
    if (p) return { perspective: p, space: s as Space | null, isJoined: true };
    // Perspective not found locally — not yet joined
    return { perspective: null, space: null, isJoined: false };
  });

  // When navigating to /space/global with the global perspective already joined,
  // ensure setCurrentPerspective is called so SpaceStore hydrates correctly.
  createEffect(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || segs[1] !== 'global') return;
    const globalP = adamStore.globalPerspective();
    if (!globalP) return;
    const current = adamStore.currentPerspective();
    if (current?.uuid !== globalP.uuid) {
      void adamStore.setCurrentPerspective(globalP.uuid);
    }
  });

  /**
   * Full path from the global root to the current node.
   * `holarchyPath()[0]` is always the global root perspective (when joined).
   * Used by GlobalStore to read the discovery perspective.
   */
  const holarchyPath = createMemo<HolarchyNode[]>(() => {
    const nodes: HolarchyNode[] = [];

    const globalP = adamStore.globalPerspective();
    if (globalP) {
      nodes.push({ perspective: globalP, space: null, isJoined: true });
    }

    const node = currentNode();
    if (node && node.perspective && node.perspective.uuid !== globalP?.uuid) {
      nodes.push(node);
    }

    return nodes;
  });

  // --- Holarchy navigation actions ---

  async function navigateInto(uuid: string): Promise<void> {
    await adamStore.setCurrentPerspective(uuid);
  }

  function navigateUp(): void {
    // TODO: navigate to parent perspective when deeper holarchies are supported
  }

  // Watch adamStore.currentPerspective() and hydrate the WE space layer on top.
  // For a raw external perspective: Space.findAll returns [], setSpace(null) — space chrome hides.
  // For a mixed perspective: both layers hydrate simultaneously.
  createEffect(() => {
    const p = adamStore.currentPerspective();
    if (!p) {
      setPerspective(null);
      setSpace(null);
      setSignalTypes([]);
      setChildSpaces([]);
      setMembers([]);
      setSelectedPin(null);
      setSelectedEntitySignalData([]);
      setSelectedEntitySignals([]);
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
        const systemUuids = adamStore.systemPerspectiveUuids();
        if (systemUuids.includes(uuid)) {
          setPerspective(p);
          setSpace(null);
          setSignalTypes([]);
          setChildSpaces([]);
          setMembers([]);
          setSelectedPin(null);
          setSelectedEntitySignalData([]);
          setSelectedEntitySignals([]);
          console.log('[SpaceStore] skipped block registration for system perspective', uuid);
          // we-root guard kept for clarity but covered above
          void rootUuid;
          return;
        }

        // Confirm this perspective is actually a WE space before registering
        // block-model SHACL shapes. Registering them writes links to the
        // perspective permanently, so we must not do it for external perspectives.
        //
        // For a fresh global perspective (Space.findAll returns []) installSpaceSdna
        // must still run first so models are ready before Space.create is called.
        // register() is idempotent — safe to call unconditionally.
        await installSpaceSdna(p);
        await new Promise((r) => setTimeout(r, 500)); // Delay needed after SHACL registration
        const [spaceModel] = await Space.findAll(p);

        setPerspective(p);
        setSpace(spaceModel ?? null);

        if (spaceModel) {
          const discovery = await buildDiscoveryData(p);
          setChildSpaces(discovery.spaces);
          setMembers(discovery.agents);
          setSignalTypes(discovery.signalTypes);
        } else {
          setChildSpaces([]);
          setMembers([]);
          setSignalTypes([]);
        }
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

    // Discovery
    childSpaces,
    members,
    spaceLocationPins,
    memberLocationPins,

    // Selection
    selectedPin,
    selectedSpace,
    selectedAgent,
    selectedEntitySignalData,
    setSelectedPin,
    clearSelectedPin,
    upsertEntitySignal,

    // Holarchy
    holarchyPath,
    currentNode,

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
    navigateInto,
    navigateUp,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
