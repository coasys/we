import { PerspectiveProxy } from '@coasys/ad4m';
import { useAdamStore, useRouteStore } from '@solid/stores';
import { Block, CollectionBlock, ImageBlock, Space, TextBlock } from '@we/models';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

type BlockType = ImageBlock | TextBlock | CollectionBlock;
type Post = Partial<BlockType & { children?: Post[] }>;

export interface SpaceStore {
  // State
  spaceId: Accessor<string>;
  perspective: Accessor<PerspectiveProxy | null>;
  space: Accessor<Partial<Space>>;
  posts: Accessor<Post[]>;
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
  getPosts: (perspective: PerspectiveProxy) => Promise<void>;
  toggleLayer: (layerName: string) => void;
  toggleBackground: (backgroundName: string) => void;
}

// Hardcoded user locations for development
// TODO: Load from space perspective in production
const MOCK_USER_LOCATIONS = [
  { id: '1', name: 'Alice', latitude: 40.7128, longitude: -74.006, color: '#00ffff' }, // New York
  { id: '2', name: 'Bob', latitude: 51.5074, longitude: -0.1278, color: '#ff00ff' }, // London
  { id: '3', name: 'Charlie', latitude: 35.6762, longitude: 139.6503, color: '#ffff00' }, // Tokyo
  { id: '4', name: 'Diana', latitude: -33.8688, longitude: 151.2093, color: '#00ff00' }, // Sydney
  { id: '5', name: 'Eve', latitude: 48.8566, longitude: 2.3522, color: '#ff6600' }, // Paris
  { id: '6', name: 'Frank', latitude: -23.5505, longitude: -46.6333, color: '#ff0066' }, // São Paulo
  { id: '7', name: 'Grace', latitude: 55.7558, longitude: 37.6173, color: '#6600ff' }, // Moscow
  { id: '8', name: 'Henry', latitude: 1.3521, longitude: 103.8198, color: '#66ff00' }, // Singapore
];

const defaultSpace: Partial<Space> = {
  author: '',
  timestamp: '',
  name: '',
  description: '',
  uuid: '',
  visibility: '',
  locations: [],
  userLocations: JSON.stringify(MOCK_USER_LOCATIONS),
};

const SpaceContext = createContext<SpaceStore>();

export function SpaceStoreProvider(props: ParentProps) {
  const routeStore = useRouteStore();
  const adamStore = useAdamStore();

  // State
  const [spaceId, setSpaceId] = createSignal('');
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [space, setSpace] = createSignal<Partial<Space>>(defaultSpace);
  const [posts, setPosts] = createSignal<Post[]>([]);
  const [loading, setLoading] = createSignal(true);

  // Layer visibility state
  const [showUserLocations, setShowUserLocations] = createSignal(false);
  const [showCountryOutlines, setShowCountryOutlines] = createSignal(false);
  const [showH3Hexagons, setShowH3Hexagons] = createSignal(false);

  // Background visibility state
  const [showSkybox, setShowSkybox] = createSignal(true);
  const [showStars, setShowStars] = createSignal(false);
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
      setLoading(true);
      if (!adamStore.adamClient() || !spaceId()) return;
      const spacePerspective = await adamStore.adamClient()!.perspective.byUUID(spaceId());
      const [spaceModel] = await Space.findAll(spacePerspective!);
      setPerspective(spacePerspective);
      setSpace(spaceModel);

      getPosts(spacePerspective!);
    } catch (error) {
      console.error('SpaceStore: getSpace error', error);
    } finally {
      setLoading(false);
    }
  }

  async function getPosts(perspective: PerspectiveProxy): Promise<void> {
    try {
      setLoading(true);
      // get root blocks based on source being space uuid?
      const postsArr = await Block.findAll(perspective, { where: { type: 'collection' } });
      const postsWithBlocks = await Promise.all(postsArr.map((post) => getBlockTree(post, perspective)));
      setPosts(postsWithBlocks.filter((post) => !!post));

      // console.log('SpaceStore: getPosts posts', posts());
    } catch (error) {
      console.error('SpaceStore: getPosts error', error);
    } finally {
      setLoading(false);
    }
  }

  async function getBlockNode(perspective: PerspectiveProxy, block: Block): Promise<BlockType | undefined> {
    switch (block.type) {
      case 'image': {
        const [node] = await ImageBlock.findAll(perspective, { source: block.baseExpression });
        return node;
      }
      case 'text': {
        const [node] = await TextBlock.findAll(perspective, { source: block.baseExpression });
        return node;
      }
      case 'collection': {
        const [node] = await CollectionBlock.findAll(perspective, { source: block.baseExpression });
        return node;
      }
      default:
        console.warn(`No model found for block type: ${block.type}`);
        return undefined;
    }
  }

  // Temp fix for adam returning empty arrays instead of undefined
  function cleanBlockData(block: Record<string, unknown>): Record<string, unknown> {
    const stringProps = [
      'display',
      'direction',
      'format',
      'tag',
      'textStyle',
      'text',
      // Add any other props that should be strings
    ];
    for (const prop of stringProps) {
      if (Array.isArray(block[prop])) block[prop] = '';
    }
    // Recursively clean children if present
    if (Array.isArray(block.children)) {
      block.children = block.children.map(cleanBlockData);
    }
    return block;
  }

  // Recursive helper
  async function getBlockTree(parent: Block, perspective: PerspectiveProxy): Promise<Post | undefined> {
    try {
      const block = await getBlockNode(perspective, parent);

      const children = await Block.findAll(perspective, { source: parent.baseExpression });
      const childrenWithBlocks = await Promise.all(children.map((child) => getBlockTree(child, perspective)));
      return cleanBlockData({ ...block, children: childrenWithBlocks.filter((child) => !!child) });
    } catch (error) {
      console.error('SpaceStore: getBlockTree error', error);
    }
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
    posts,
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
    getPosts,
    toggleLayer,
    toggleBackground,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
