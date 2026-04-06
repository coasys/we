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
}

// ---------------------------------------------------------------------------
// Store factory — test-oriented signals for integration test template
// ---------------------------------------------------------------------------

export function createTestStore(adamClient: Accessor<Ad4mClient | null | undefined>) {
  registerModel('TestItem', TestItem as any);

  // ---- Known values (for $store / assertion tests) ----
  const stringValue = createMemo(() => 'hello');
  const numberValue = createMemo(() => 42);
  const boolTrue = createMemo(() => true);
  const boolFalse = createMemo(() => false);

  // ---- Interactive signals ----
  const [counter, setCounter] = createSignal(0);
  const [typedText, setTypedText] = createSignal('');
  const [toggleValue, setToggleValue] = createSignal(false);

  // ---- List data (for $each) ----
  const fruits = createMemo(() => [
    { name: 'Apple', color: 'red', emoji: '🍎' },
    { name: 'Banana', color: 'yellow', emoji: '🍌' },
    { name: 'Cherry', color: 'red', emoji: '🍒' },
    { name: 'Grape', color: 'purple', emoji: '🍇' },
  ]);
  const fruitCount = createMemo(() => fruits().length);

  // Nested groups (for nested $each)
  const groups = createMemo(() => [
    { name: 'Fruits', items: [{ label: 'Apple' }, { label: 'Banana' }] },
    { name: 'Veggies', items: [{ label: 'Carrot' }, { label: 'Broccoli' }] },
  ]);

  // Key-value pairs (for $map)
  const properties = createMemo(() => [
    { key: 'Language', value: 'TypeScript' },
    { key: 'Framework', value: 'SolidJS' },
    { key: 'Version', value: '2.0' },
  ]);

  // Object with extra fields (for $pick)
  const fullObject = createMemo(() => ({
    name: 'Test Item',
    status: 'active',
    category: 'Frontend',
    secret: 'hidden-value',
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

  // ---- AD4M perspective (lazy init for $query testing) ----
  const [perspective, setPerspective] = createSignal<PerspectiveProxy | null>(null);
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
          await new Promise((r) => setTimeout(r, 500));

          for (const item of [
            { name: 'Alpha', status: 'active', category: 'A' },
            { name: 'Beta', status: 'draft', category: 'B' },
            { name: 'Gamma', status: 'active', category: 'A' },
          ]) {
            await TestItem.create(testPerspective, item);
          }
        } else {
          await testPerspective.ensureSDNASubjectClass(TestItem);

          // Ensure seed data exists even if perspective was created on a previous run
          const existing = await TestItem.findAll(testPerspective);
          if (!existing || existing.length === 0) {
            await new Promise((r) => setTimeout(r, 500));
            for (const item of [
              { name: 'Alpha', status: 'active', category: 'A' },
              { name: 'Beta', status: 'draft', category: 'B' },
              { name: 'Gamma', status: 'active', category: 'A' },
            ]) {
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

    // Lists
    fruits,
    fruitCount,
    groups,
    properties,
    fullObject,

    // Actions
    increment,
    setTypedText: setTypedTextFromArg,
    toggle,

    // AD4M
    perspective,
  };
}

export type TestStore = ReturnType<typeof createTestStore>;
