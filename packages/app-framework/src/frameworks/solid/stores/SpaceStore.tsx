import { LinkQuery, PerspectiveProxy } from '@coasys/ad4m';
import { registerModel } from '@shared/registries/modelRegistry';
import { useAdamStore, useRouteStore } from '@solid/stores';
import { createBlocks, loadBlocks } from '@we/block-shared';
import { blobToDataURL, CollectionBlock, FileData, ImageBlock, resizeImage, Space, TextBlock } from '@we/models';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

type BlockType = ImageBlock | TextBlock | CollectionBlock;
type Post = Partial<BlockType>;

export interface SpaceStore {
  // State
  spaceId: Accessor<string>;
  perspective: Accessor<PerspectiveProxy | null>;
  space: Accessor<Partial<Space | null>>;
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
  getPosts: () => Promise<void>;
  createPost: (json: unknown) => Promise<void>;
  toggleLayer: (layerName: string) => void;
  toggleBackground: (backgroundName: string) => void;
  updateSpaceImage: (imageFile: File) => Promise<void>;
  updateSpaceCoverImage: (imageFile: File) => Promise<void>;
}

// // Hardcoded user locations for development
// // TODO: Load from space perspective in production
// const MOCK_USER_LOCATIONS = [
//   { id: '1', name: 'Alice', latitude: 40.7128, longitude: -74.006, color: '#00ffff' }, // New York
//   { id: '2', name: 'Bob', latitude: 51.5074, longitude: -0.1278, color: '#ff00ff' }, // London
//   { id: '3', name: 'Charlie', latitude: 35.6762, longitude: 139.6503, color: '#ffff00' }, // Tokyo
//   { id: '4', name: 'Diana', latitude: -33.8688, longitude: 151.2093, color: '#00ff00' }, // Sydney
//   { id: '5', name: 'Eve', latitude: 48.8566, longitude: 2.3522, color: '#ff6600' }, // Paris
//   { id: '6', name: 'Frank', latitude: -23.5505, longitude: -46.6333, color: '#ff0066' }, // São Paulo
//   { id: '7', name: 'Grace', latitude: 55.7558, longitude: 37.6173, color: '#6600ff' }, // Moscow
//   { id: '8', name: 'Henry', latitude: 1.3521, longitude: 103.8198, color: '#66ff00' }, // Singapore
// ];

// const defaultSpace: Partial<Space> = {
//   author: '',
//   timestamp: '',
//   name: '',
//   description: '',
//   uuid: '',
//   visibility: '',
//   locations: [],
//   // userLocations: JSON.stringify(MOCK_USER_LOCATIONS),
// };

const SpaceContext = createContext<SpaceStore>();

// Register JS classes for $query model resolution
registerModel('CollectionBlock', CollectionBlock as any);
registerModel('TextBlock', TextBlock as any);
registerModel('ImageBlock', ImageBlock as any);

export function SpaceStoreProvider(props: ParentProps) {
  const routeStore = useRouteStore();
  const adamStore = useAdamStore();

  // State
  const [spaceId, setSpaceId] = createSignal('');
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);
  const [space, setSpace] = createSignal<Partial<Space | null>>(null);
  const [posts, setPosts] = createSignal<Post[]>([]);
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
      ]);
      await new Promise((r) => setTimeout(r, 500)); // Delay needed after SHACL registration

      const [spaceModel] = await Space.findAll(spacePerspective);
      setPerspective(spacePerspective);
      console.log('[SpaceStore] getSpace loaded space:', spaceModel);
      setSpace(spaceModel);

      await getPosts();
    } catch (error) {
      console.error('SpaceStore: getSpace error', error);
    } finally {
      setLoading(false);
    }
  }

  // Lexical paragraph/heading/quote types that contain inline text runs
  const TEXT_CONTAINER_TYPES = new Set(['paragraph', 'heading', 'quote', 'listitem']);
  // Properties added by AD4M that aren't part of Lexical's JSON format
  const AD4M_ONLY_PROPS = new Set([
    'id',
    'children',
    'author',
    'createdAt',
    'updatedAt',
    'display',
    'columns',
    'gap',
    'textStyle',
  ]);

  // Convert a loaded block tree (from loadBlocks) to Lexical-compatible JSON
  function blockToLexical(block: Record<string, unknown>): Record<string, unknown> {
    const node: Record<string, unknown> = {};
    // Copy properties, skipping AD4M internals and AD4M-only fields
    for (const key of Object.keys(block)) {
      if (key.startsWith('_') || AD4M_ONLY_PROPS.has(key)) continue;
      const val = block[key];
      if (Array.isArray(val) && val.length === 0) continue;
      if (val !== undefined && val !== null) node[key] = val;
    }

    // For text-container types (paragraph, heading, etc.), reconstruct
    // inline text children from the merged `text` property
    const blockType = node.type as string;
    const blockText = block.text as string | undefined;
    if (TEXT_CONTAINER_TYPES.has(blockType) && blockText) {
      node.children = [
        {
          type: 'text',
          text: blockText,
          detail: 0,
          format: (block.textFormat as number) || 0,
          mode: 'normal',
          style: (block.textStyle as string) || '',
          version: 1,
        },
      ];
      // Remove text/textFormat from the paragraph node (not valid Lexical paragraph props)
      delete node.text;
      delete node.textFormat;
      // For listitems, strip list-wrapper props (they go on the list node)
      if (blockType === 'listitem') {
        delete node.listType;
        delete node.tag;
        delete node.start;
        // Lexical listitems need a value prop
        node.value = (block.start as number) || 1;
      }
    } else {
      // Recursively convert block-level children
      const loadedChildren = (block as Record<string, unknown>)._loadedChildren;
      if (Array.isArray(loadedChildren) && loadedChildren.length) {
        const converted = loadedChildren.map(blockToLexical);
        // Group consecutive listitem children into list wrapper nodes
        node.children = groupListItems(converted);
      } else if (!node.children) {
        node.children = [];
      }
    }

    return node;
  }

  /**
   * Group consecutive listitem nodes into Lexical list wrapper nodes.
   * e.g. [paragraph, listitem, listitem, paragraph] →
   *      [paragraph, list{children:[listitem, listitem]}, paragraph]
   */
  function groupListItems(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    let currentList: Record<string, unknown> | null = null;

    for (const node of nodes) {
      if (node.type === 'listitem') {
        if (!currentList) {
          currentList = {
            type: 'list',
            listType: (node as Record<string, unknown>).listType || 'bullet',
            tag: (node as Record<string, unknown>).tag || 'ul',
            start: 1,
            direction: (node as Record<string, unknown>).direction || 'ltr',
            format: '',
            indent: 0,
            version: 1,
            children: [],
          };
          result.push(currentList);
        }
        (currentList.children as Record<string, unknown>[]).push(node);
      } else {
        currentList = null;
        result.push(node);
      }
    }

    return result;
  }

  async function getPosts(): Promise<void> {
    const p = perspective();
    if (!p) {
      console.warn('[SpaceStore] getPosts: no perspective available');
      return;
    }
    try {
      setLoading(true);
      console.log('[SpaceStore] getPosts: querying CollectionBlocks...');
      let roots = await CollectionBlock.findAll(p, { where: { type: 'root' } });
      console.log('[SpaceStore] getPosts: found', roots.length, 'root blocks with type=root');
      // Diagnostic: check we://type links for first root
      if (roots.length > 0) {
        const typeLinks = await p.get(new LinkQuery({ source: roots[0].id, predicate: 'we://type' }));
        console.log(
          '[SpaceStore] we://type links for first root:',
          typeLinks.map((l) => l.data.target),
        );
      }
      if (roots.length === 0) {
        console.log('[SpaceStore] getPosts: no typed roots found, trying without filter...');
        const allBlocks = await CollectionBlock.findAll(p);
        console.log('[SpaceStore] getPosts: found', allBlocks.length, 'total CollectionBlocks');
        // Use all CollectionBlocks as fallback
        roots = allBlocks;
      }
      const loaded = await Promise.all(roots.map((root) => loadBlocks(p, root.id)));
      console.log('[SpaceStore] getPosts: loaded', loaded.filter(Boolean).length, 'block trees');
      const lexicalPosts = loaded
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => blockToLexical(b as unknown as Record<string, unknown>));
      console.log('[SpaceStore] getPosts: converted to lexical:', JSON.stringify(lexicalPosts, null, 2));
      setPosts(lexicalPosts);
    } catch (error) {
      console.error('SpaceStore: getPosts error', error);
    } finally {
      setLoading(false);
    }
  }

  async function createPost(json: unknown): Promise<void> {
    const p = perspective();
    if (!p) return;
    await createBlocks(p, json);
    await getPosts();
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
    createPost,
    toggleLayer,
    toggleBackground,
    updateSpaceImage,
    updateSpaceCoverImage,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
