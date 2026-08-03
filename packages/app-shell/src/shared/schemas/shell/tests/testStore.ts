/* eslint-disable @typescript-eslint/no-explicit-any */
import { queryIRFlag } from '@shared/queryIRFlag';
import type { ModelManifest, SchemaPort } from '@we/backend-shared';
import type { DatasetProxy } from '@we/models';
import { type Accessor, createEffect, createSignal } from 'solid-js';

// ---------------------------------------------------------------------------
// Test models — declared as a manifest and compiled, not hand-decorated.
//
// This is the manifest compiler exercised inside the real app: the same entities the schema-tests
// page always used, now *declared* (with predicate overrides pinning the original predicates, so
// previously created test data keeps resolving). The child model exists so the query page can test
// the relation patterns (count / single projection / include) — the trickiest IR mappings.
// ---------------------------------------------------------------------------

const TEST_MANIFEST: ModelManifest = {
  version: '1',
  entities: {
    TestChild: {
      properties: { label: { type: 'string' }, owner: { type: 'string' } },
      relations: {},
    },
    TestItem: {
      properties: {
        name: { type: 'string', required: true },
        status: { type: 'string' },
        category: { type: 'string' },
      },
      relations: { children: { target: 'TestChild', cardinality: 'many' } },
    },
  },
};

const TEST_PREDICATES = {
  'TestChild.label': 'we://test_child_label',
  'TestChild.owner': 'we://test_child_owner',
  'TestItem.name': 'we://test_name',
  'TestItem.status': 'we://test_status',
  'TestItem.category': 'we://test_category',
  'TestItem.children': 'we://test_child',
};

// ---------------------------------------------------------------------------
// Store factory — test-oriented signals for integration test template
// ---------------------------------------------------------------------------

export function createTestStore(testPerspective: Accessor<DatasetProxy | null>, schemas: () => SchemaPort | null) {
  // Declared lazily: the schemas port only exists once the backend connects, and every action
  // here runs post-boot. `declare` compiles the manifest and registers the models queryable.
  let TestItem: any;
  let TestChild: any;
  function ensureModels(): boolean {
    if (TestItem) return true;
    const port = schemas();
    if (!port) return false;
    const classes = port.declare(TEST_MANIFEST, { moduleId: 'test', predicates: TEST_PREDICATES });
    TestItem = classes.TestItem;
    TestChild = classes.TestChild;
    return true;
  }

  // The "current agent" stand-in for the single-projection (`$myChild`) test's `where: { owner }`.
  const queryOwner = 'owner:me';

  // ---- Known values (for $store / assertion tests) ----
  const stringValue = 'hello';
  const numberValue = 42;
  const boolTrue = true;
  const boolFalse = false;

  // ---- Interactive signals ----
  const [counter, setCounter] = createSignal(0);
  const [typedText, setTypedText] = createSignal('');
  const [toggleValue, setToggleValue] = createSignal(false);
  const [queryFilterMode, setQueryFilterMode] = createSignal('all');

  // ---- List data (for $each) ----
  const fruits = [
    { name: 'Apple', color: 'red', emoji: '🍎' },
    { name: 'Banana', color: 'yellow', emoji: '🍌' },
    { name: 'Cherry', color: 'red', emoji: '🍒' },
    { name: 'Grape', color: 'purple', emoji: '🍇' },
  ];
  const fruitCount = fruits.length;

  // Nested groups (for nested $each)
  const groups = [
    { name: 'Fruits', items: [{ label: 'Apple' }, { label: 'Banana' }] },
    { name: 'Veggies', items: [{ label: 'Carrot' }, { label: 'Broccoli' }] },
  ];

  // Key-value pairs (for $map)
  const properties = [
    { key: 'Language', value: 'TypeScript' },
    { key: 'Framework', value: 'SolidJS' },
    { key: 'Version', value: '2.0' },
  ];

  // Object with extra fields (for $pick)
  const fullObject = {
    name: 'Test Item',
    status: 'active',
    category: 'Frontend',
    secret: 'hidden-value',
  };

  // Empty list (for $each empty-array edge case)
  const emptyList: any[] = [];

  // Deep nested object (for $store 3+ depth traversal)
  const nested = { level1: { level2: { value: 'deep-value' } } };

  // Single config object (for $map on single object path)
  const singleConfig = { title: 'My App', version: '2.0', debug: false };

  // ---- Actions ----
  function increment() {
    setCounter((c) => c + 1);
  }
  function setTypedTextFromArg(text: string) {
    setTypedText(text);
  }
  function toggle() {
    setToggleValue((v) => !v);
  }

  // Track how many items we've created for unique naming
  let createdCount = 0;

  async function createTestItem() {
    const p = perspective();
    if (!p || !ensureModels()) return;
    createdCount++;
    try {
      await TestItem.create(p, {
        name: `Item-${createdCount}`,
        status: createdCount % 2 === 0 ? 'draft' : 'active',
        category: 'dynamic',
      });
    } catch (err) {
      console.error('TestStore: failed to create TestItem', err);
    }
  }

  async function deleteTestItem(id: string) {
    const p = perspective();
    if (!p || !id) return;
    try {
      await TestItem.delete(p, id);
    } catch (err) {
      console.error('TestStore: failed to delete TestItem', err);
    }
  }

  // Force a known, deterministic dataset for the query test page:
  //   Alpha (2 children, 1 mine) · Beta (0 children) · Gamma (1 child, mine)
  async function seedQueryData() {
    const p = perspective();
    if (!p || !ensureModels()) return;
    try {
      for (const c of await TestChild.findAll(p)) await TestChild.delete(p, c.id);
      for (const it of await TestItem.findAll(p)) await TestItem.delete(p, it.id);

      const alpha = await TestItem.create(p, { name: 'Alpha', status: 'active', category: 'A' });
      await TestItem.create(p, { name: 'Beta', status: 'draft', category: 'B' });
      const gamma = await TestItem.create(p, { name: 'Gamma', status: 'active', category: 'A' });

      const addChild = (parentId: string, label: string, owner: string) =>
        TestChild.create(p, { label, owner }, { parent: { id: parentId, predicate: 'we://test_child' } });
      await addChild(alpha.id, 'a-mine', queryOwner);
      await addChild(alpha.id, 'a-other', 'owner:other');
      await addChild(gamma.id, 'g-mine', queryOwner);
    } catch (err) {
      console.error('TestStore: failed to seed query data', err);
    }
  }

  // ---- AD4M perspective (lazy init for $query testing) ----
  const [perspective, setPerspective] = createSignal<DatasetProxy | null>(null);

  const seedItems = [
    { name: 'Alpha', status: 'active', category: 'A' },
    { name: 'Beta', status: 'draft', category: 'B' },
    { name: 'Gamma', status: 'active', category: 'A' },
  ];

  createEffect(() => {
    const p = testPerspective();
    if (!p || !ensureModels()) return;

    (async () => {
      try {
        await p.ensureSDNASubjectClass(TestItem);
        await p.ensureSDNASubjectClass(TestChild);

        // Ensure seed data exists
        const existing = await TestItem.findAll(p);
        if (!existing || existing.length === 0) {
          await new Promise((r) => setTimeout(r, 500));
          for (const item of seedItems) {
            await TestItem.create(p, item);
          }
        }

        setPerspective(p);
      } catch (err) {
        console.error('TestStore: failed to init perspective', err);
      }
    })();
  });

  // ---- Public API ----
  return {
    // Known values
    stringValue,
    numberValue,
    boolTrue,
    boolFalse,

    // Interactive
    counter,
    typedText,
    toggleValue,
    queryFilterMode,

    // Lists
    fruits,
    fruitCount,
    groups,
    properties,
    fullObject,
    emptyList,
    nested,
    singleConfig,

    // Actions
    increment,
    setTypedText: setTypedTextFromArg,
    toggle,
    setQueryFilterMode: (mode: string) => setQueryFilterMode(mode),
    createTestItem,
    deleteTestItem,
    seedQueryData,
    queryOwner,
    queryIRenabled: queryIRFlag.enabled,
    toggleQueryIR: queryIRFlag.toggle,

    // AD4M
    perspective,
  };
}

export type TestStore = ReturnType<typeof createTestStore>;
