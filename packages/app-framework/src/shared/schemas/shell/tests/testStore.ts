/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';
import { Ad4mModel, Model, Property } from '@coasys/ad4m';
import { registerModel } from '@shared/registries/modelRegistry';
import { type Accessor, createEffect, createSignal } from 'solid-js';

import { benchmarkBasePath } from './SchemaBenchmark.schema';

// ---------------------------------------------------------------------------
// Test model — lightweight AD4M model for $query testing
// ---------------------------------------------------------------------------

@Model({ name: 'TestItem' })
export class TestItem extends Ad4mModel {
  @Property({ through: 'we://test_name', required: true }) name: string = '';
  @Property({ through: 'we://test_status' }) status: string = '';
  @Property({ through: 'we://test_category' }) category: string = '';
}

// ---------------------------------------------------------------------------
// Store factory — test-oriented signals for integration test template
// ---------------------------------------------------------------------------

export function createTestStore(adamClient: Accessor<Ad4mClient | null | undefined>) {
  registerModel('TestItem', TestItem as any);

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

  // ---- Benchmark timing ----
  const [benchLastRender, setBenchLastRender] = createSignal<number | null>(null);
  const [benchResults, setBenchResults] = createSignal<Record<string, number>>({});
  let benchQueue: string[] = [];
  let benchNavigate: ((to: string) => void) | null = null;
  let benchRunning = false;

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

  // ---- Benchmark data ----
  const benchList100 = Array.from({ length: 100 }, (_, i) => ({
    name: `Item ${i + 1}`,
    category: `Category ${String.fromCharCode(65 + (i % 5))}`,
  }));

  const benchGroups = Array.from({ length: 10 }, (_, g) => ({
    name: `Group ${g + 1}`,
    items: Array.from({ length: 10 }, (_, i) => ({
      label: `Item ${g * 10 + i + 1}`,
      detail: `detail-${g}-${i}`,
    })),
  }));

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

  // ---- Benchmark actions ----
  function benchRecordRender(duration: number, routeName?: string) {
    setBenchLastRender(Math.round(duration * 10) / 10);
    if (routeName) {
      setBenchResults((prev) => ({ ...prev, [routeName]: Math.round(duration * 10) / 10 }));
    }
    // Auto-advance only during a Run All session
    if (!benchRunning) return;
    if (benchQueue.length > 0 && benchNavigate) {
      const next = benchQueue.shift()!;
      setTimeout(() => benchNavigate!(next), 50);
    } else {
      // All done — return to dashboard
      benchRunning = false;
      setTimeout(() => benchNavigate!(benchmarkBasePath), 50);
    }
  }

  function benchClearResults() {
    setBenchResults({});
    setBenchLastRender(null);
    benchQueue = [];
    benchRunning = false;
  }

  function benchSetNavigate(navigate: (to: string) => void) {
    benchNavigate = navigate;
  }

  const benchAllRoutes = [
    `${benchmarkBasePath}/static-small`,
    `${benchmarkBasePath}/static-large`,
    `${benchmarkBasePath}/tokens-light`,
    `${benchmarkBasePath}/tokens-heavy`,
    `${benchmarkBasePath}/each-flat`,
    `${benchmarkBasePath}/each-nested`,
    `${benchmarkBasePath}/web-components`,
    `${benchmarkBasePath}/solid-components`,
    `${benchmarkBasePath}/deep-nesting`,
    `${benchmarkBasePath}/mixed-realistic`,
  ];

  function benchRunAll() {
    if (!benchNavigate) return;
    setBenchResults({});
    setBenchLastRender(null);
    benchRunning = true;
    benchQueue = benchAllRoutes.slice(1);
    benchNavigate(benchAllRoutes[0]);
  }

  async function createTestItem() {
    const p = perspective();
    if (!p) return;
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

  // ---- AD4M perspective (lazy init for $query testing) ----
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);
  let perspectiveInitStarted = false;

  const seedItems = [
    { name: 'Alpha', status: 'active', category: 'A' },
    { name: 'Beta', status: 'draft', category: 'B' },
    { name: 'Gamma', status: 'active', category: 'A' },
  ];

  createEffect(() => {
    const client = adamClient();
    if (!client || perspectiveInitStarted) return;
    perspectiveInitStarted = true;

    (async () => {
      try {
        const perspectives = await client.perspective.all();
        let testPerspective = perspectives.find((p: PerspectiveProxy) => p.name === 'we-test') ?? null;

        if (!testPerspective) {
          testPerspective = await client.perspective.add('we-test');
          await testPerspective.ensureSDNASubjectClass(TestItem);
          await new Promise((r) => setTimeout(r, 500));

          for (const item of seedItems) {
            await TestItem.create(testPerspective, item);
          }
        } else {
          await testPerspective.ensureSDNASubjectClass(TestItem);

          // Ensure seed data exists even if perspective was created on a previous run
          const existing = await TestItem.findAll(testPerspective);
          if (!existing || existing.length === 0) {
            await new Promise((r) => setTimeout(r, 500));
            for (const item of seedItems) {
              await TestItem.create(testPerspective, item);
            }
          }
        }

        setPerspective(testPerspective);
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
    benchList100,
    benchGroups,

    // Actions
    increment,
    setTypedText: setTypedTextFromArg,
    toggle,
    setQueryFilterMode: (mode: string) => setQueryFilterMode(mode),
    createTestItem,
    deleteTestItem,

    // Benchmark
    benchLastRender,
    benchResults,
    benchRecordRender,
    benchClearResults,
    benchSetNavigate,
    benchRunAll,

    // AD4M
    perspective,
  };
}

export type TestStore = ReturnType<typeof createTestStore>;
