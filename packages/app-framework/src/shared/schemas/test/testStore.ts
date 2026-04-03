/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel, Model, Property } from '@coasys/ad4m';
import { registerModel } from '@shared/registries/modelRegistry';
import { type Accessor, createEffect, createMemo, createSignal } from 'solid-js';

// ---------------------------------------------------------------------------
// Test model — lightweight AD4M model for $query testing
// ---------------------------------------------------------------------------

@Model({ name: 'TestItem' })
export class TestItem extends Ad4mModel {
  @Property({ through: 'we://test_name' }) name: string = '';
  @Property({ through: 'we://test_status' }) status: string = '';
  @Property({ through: 'we://test_category' }) category: string = '';
  @Property({ through: 'we://test_description' }) description: string = '';
  @Property({ through: 'we://test_priority' }) priority: number = 0;
}

// ---------------------------------------------------------------------------
// Seed data — populates signals immediately and seeds perspective on init
// ---------------------------------------------------------------------------

export interface TestItemData {
  id: string;
  name: string;
  status: 'active' | 'archived' | 'draft';
  category: string;
  description: string;
  priority: number;
}

const SEED_DATA: TestItemData[] = [
  {
    id: '1',
    name: 'Design System',
    status: 'active',
    category: 'Frontend',
    description: 'Core component library and design tokens',
    priority: 5,
  },
  {
    id: '2',
    name: 'API Gateway',
    status: 'active',
    category: 'Backend',
    description: 'Request routing and authentication layer',
    priority: 4,
  },
  {
    id: '3',
    name: 'User Dashboard',
    status: 'active',
    category: 'Frontend',
    description: 'Main user interface for data visualization',
    priority: 3,
  },
  {
    id: '4',
    name: 'Payment Service',
    status: 'draft',
    category: 'Backend',
    description: 'Stripe integration for subscription billing',
    priority: 4,
  },
  {
    id: '5',
    name: 'Search Engine',
    status: 'archived',
    category: 'Backend',
    description: 'Full-text search with Elasticsearch',
    priority: 2,
  },
  {
    id: '6',
    name: 'Mobile App',
    status: 'draft',
    category: 'Frontend',
    description: 'React Native mobile client',
    priority: 3,
  },
  {
    id: '7',
    name: 'CI/CD Pipeline',
    status: 'active',
    category: 'DevOps',
    description: 'Automated testing and deployment',
    priority: 5,
  },
  {
    id: '8',
    name: 'Monitoring',
    status: 'active',
    category: 'DevOps',
    description: 'System health and alerting',
    priority: 4,
  },
  {
    id: '9',
    name: 'Documentation',
    status: 'draft',
    category: 'Frontend',
    description: 'API docs and developer guides',
    priority: 2,
  },
  {
    id: '10',
    name: 'Auth Service',
    status: 'archived',
    category: 'Backend',
    description: 'OAuth2 and session management',
    priority: 3,
  },
  {
    id: '11',
    name: 'Data Pipeline',
    status: 'active',
    category: 'DevOps',
    description: 'ETL workflows and data processing',
    priority: 3,
  },
  {
    id: '12',
    name: 'Admin Panel',
    status: 'draft',
    category: 'Frontend',
    description: 'Internal admin tools',
    priority: 1,
  },
];

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createTestStore(adamClient: Accessor<Ad4mClient | null | undefined>) {
  // Register model immediately so $query can resolve it
  registerModel('TestItem', TestItem as any);

  // ---- State signals (seeded immediately with mock data) ----
  const [items, setItems] = createSignal<TestItemData[]>(SEED_DATA);
  const [selectedItemId, setSelectedItemId] = createSignal<string | null>(null);
  const [activeFilter, setActiveFilter] = createSignal<string>('all');
  const [searchQuery, setSearchQuery] = createSignal<string>('');
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);

  // ---- Computed ----
  const filteredItems = createMemo(() => {
    let result = items();
    const filter = activeFilter();
    if (filter !== 'all') result = result.filter((i) => i.status === filter);
    const query = searchQuery().toLowerCase();
    if (query)
      result = result.filter(
        (i) => i.name.toLowerCase().includes(query) || i.description.toLowerCase().includes(query),
      );
    return result;
  });

  const selectedItem = createMemo(() => items().find((i) => i.id === selectedItemId()) ?? null);
  const itemCount = createMemo(() => items().length);
  const filteredItemCount = createMemo(() => filteredItems().length);
  const hasFilteredItems = createMemo(() => filteredItems().length > 0);

  // Group items by category — for nested $each
  const categories = createMemo(() => {
    const groups: Record<string, TestItemData[]> = {};
    for (const item of items()) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return Object.entries(groups).map(([name, categoryItems]) => ({
      name,
      items: categoryItems,
      count: categoryItems.length,
    }));
  });

  // Properties of selected item as key-value pairs — for $map display
  const selectedItemProperties = createMemo(() => {
    const item = selectedItem();
    if (!item) return [];
    return [
      { key: 'Status', value: item.status },
      { key: 'Category', value: item.category },
      { key: 'Priority', value: String(item.priority) },
      { key: 'ID', value: item.id },
    ];
  });

  // ---- Actions (callable via $action in schema) ----
  function selectItem(id: string) {
    setSelectedItemId(id);
  }

  function setFilter(filter: string) {
    setActiveFilter(filter);
  }

  function setSearch(query: string) {
    setSearchQuery(query);
  }

  function addItem() {
    const id = String(Date.now());
    setItems((prev) => [
      ...prev,
      {
        id,
        name: `New Item ${prev.length + 1}`,
        status: 'draft' as const,
        category: 'Uncategorized',
        description: 'Newly created test item',
        priority: 1,
      },
    ]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedItemId() === id) setSelectedItemId(null);
  }

  function removeSelectedItem() {
    const id = selectedItemId();
    if (id) removeItem(id);
  }

  // ---- Lazy AD4M perspective init ----
  // Creates a __we_test__ perspective and seeds it with TestItem models
  // so $query can subscribe to real reactive data.
  let perspectiveInitStarted = false;

  createEffect(() => {
    const client = adamClient();
    if (!client || perspectiveInitStarted) return;
    perspectiveInitStarted = true;

    (async () => {
      try {
        const perspectives = await client.perspective.all();
        let testPerspective = perspectives.find((p: PerspectiveProxy) => p.name === '__we_test__') ?? null;

        if (!testPerspective) {
          testPerspective = await client.perspective.add('__we_test__');
          await testPerspective.ensureSDNASubjectClass(TestItem);
          // AD4M SDNA registration timing workaround
          await new Promise((r) => setTimeout(r, 500));

          // Seed perspective with test data
          for (const item of SEED_DATA) {
            await TestItem.create(testPerspective, {
              name: item.name,
              status: item.status,
              category: item.category,
              description: item.description,
              priority: item.priority,
            });
          }
        } else {
          await testPerspective.ensureSDNASubjectClass(TestItem);
        }

        setPerspective(testPerspective);
      } catch (err) {
        console.error('TestStore: failed to init perspective', err);
      }
    })();
  });

  // ---- Public API ----
  return {
    // State (accessed via $store in schema)
    items,
    filteredItems,
    selectedItem,
    selectedItemId,
    selectedItemProperties,
    activeFilter,
    searchQuery,
    itemCount,
    filteredItemCount,
    hasFilteredItems,
    categories,
    perspective,

    // Actions (called via $action in schema)
    selectItem,
    setFilter,
    setSearch,
    addItem,
    removeItem,
    removeSelectedItem,
  };
}

export type TestStore = ReturnType<typeof createTestStore>;
