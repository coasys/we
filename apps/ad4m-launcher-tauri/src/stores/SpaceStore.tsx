import { PerspectiveProxy } from '@coasys/ad4m';
import { Block, CollectionBlock, ImageBlock, Space, TextBlock } from '@we/models';
import { Accessor, createContext, createEffect, createSignal, ParentProps, useContext } from 'solid-js';

import { useAdamStore, useRouteStore } from '@/stores';

type BlockType = ImageBlock | TextBlock | CollectionBlock;
type Post = Partial<BlockType & { children?: Post[] }>;

export interface SpaceStore {
  // State
  spaceId: Accessor<string>;
  perspective: Accessor<PerspectiveProxy | null>;
  space: Accessor<Partial<Space>>;
  posts: Accessor<Post[]>;
  loading: Accessor<boolean>;

  // Setters
  setSpaceId: (id: string) => void;

  // Actions
  getSpace: () => Promise<void>;
  getPosts: (perspective: PerspectiveProxy) => Promise<void>;
}

const defaultSpace: Partial<Space> = {
  author: '',
  timestamp: '',
  name: '',
  description: '',
  uuid: '',
  visibility: '',
  locations: [],
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
  function cleanBlockData(block: any): any {
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

    // Setters
    setSpaceId,

    // Actions
    getSpace,
    getPosts,
  };

  return <SpaceContext.Provider value={store}>{props.children}</SpaceContext.Provider>;
}

export function useSpaceStore(): SpaceStore {
  const context = useContext(SpaceContext);
  if (!context) throw new Error('useSpaceStore must be used within a SpaceProvider');
  return context;
}

export default SpaceStoreProvider;
