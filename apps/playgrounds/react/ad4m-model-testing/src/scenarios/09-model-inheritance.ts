// Phase 4 — validates WeakMap metadata registry and model inheritance
import type { PerspectiveProxy } from '@coasys/ad4m';

import { assert, test, wipePerspective } from '../harness/helpers';
import type { ScenarioModule } from '../harness/types';
import { TestBaseModel } from '../models/TestBaseModel';
import { TestDerivedModel } from '../models/TestDerivedModel';
import { TestPost } from '../models/TestPost';

export const scenario: ScenarioModule = {
  name: '09 — Model Inheritance',
  run: async (perspective: PerspectiveProxy) => {
    await wipePerspective(perspective);
    await TestDerivedModel.register(perspective);
    await TestPost.register(perspective);

    return [
      // ── Pure / no-perspective ───────────────────────────────────────────

      await test('getModelMetadata() on base returns only base fields', async () => {
        const meta = TestBaseModel.getModelMetadata();
        assert('content' in meta.properties, 'base should have content property');
        assert(!('question' in meta.properties), 'base should NOT have question property');
        assert(!('pollType' in meta.properties), 'base should NOT have pollType property');
      }),

      await test('getModelMetadata() on derived returns merged base+derived fields', async () => {
        const meta = TestDerivedModel.getModelMetadata();
        assert('content' in meta.properties, 'derived should inherit content from base');
        assert('question' in meta.properties, 'derived should have own question property');
        assert('pollType' in meta.properties, 'derived should have own pollType property');
      }),

      await test('derived class decorators do not corrupt base class metadata', async () => {
        // Read derived first, then verify base is still clean
        TestDerivedModel.getModelMetadata();
        const baseMeta = TestBaseModel.getModelMetadata();
        const keys = Object.keys(baseMeta.properties);
        assert(keys.length === 1, `Base should have exactly 1 property, got: ${keys.join(', ')}`);
        assert(keys[0] === 'content', `Base's only property should be 'content', got: ${keys[0]}`);
      }),

      await test('generateSHACL() for derived emits sh:node reference to base shape', async () => {
        const { shape } = TestDerivedModel.generateSHACL();
        assert((shape.parentShapes?.length ?? 0) > 0, 'Derived shape should have at least one parentShape (sh:node)');
        const parentShapeUri = shape.parentShapes![0];
        assert(
          parentShapeUri.includes('TestBaseModel'),
          `parentShape URI should reference TestBaseModel, got: ${parentShapeUri}`,
        );
      }),

      await test('generateSHACL() for derived does not duplicate base property shapes', async () => {
        const { shape } = TestDerivedModel.generateSHACL();
        // The derived shape should only carry its own properties (pollType, question),
        // not the base's `content` — that's covered by sh:node
        const propPaths = (shape.properties ?? []).map((p) => p.path);
        assert(
          !propPaths.includes('test://base_content'),
          `Derived shape should NOT duplicate base's test://base_content, found: ${propPaths.join(', ')}`,
        );
      }),

      // ── Live / executor-facing ──────────────────────────────────────────

      await test('TestDerivedModel.findAll() returns only derived instances (via @Flag)', async () => {
        // Save a TestPost (different @Flag) and a TestDerivedModel to prove discrimination.
        // TestBaseModel cannot be saved directly — it has no @Flag so no SHACL constructor.
        const noise = new TestPost(perspective);
        noise.title = 'noise post';
        noise.body = '';
        await noise.save();

        const derived = new TestDerivedModel(perspective);
        derived.content = 'derived content';
        derived.question = 'Favorite color?';
        await derived.save();

        const results = await TestDerivedModel.findAll(perspective);
        assert(results.length === 1, `Expected 1 derived, got ${results.length}`);
        assert(results[0].id === derived.id, `Expected derived id ${derived.id}, got ${results[0].id}`);
      }),

      await test('TestDerivedModel instance passes instanceof TestBaseModel check', async () => {
        const derived = new TestDerivedModel(perspective);
        assert(derived instanceof TestBaseModel, 'TestDerivedModel instance should be instanceof TestBaseModel');
      }),

      await test('TestDerivedModel.findOne() returns instance with both content and question', async () => {
        const derived = new TestDerivedModel(perspective);
        derived.content = 'shared content';
        derived.question = 'Which option?';
        await derived.save();

        const found = await TestDerivedModel.findOne(perspective, { where: { id: derived.id } });
        assert(found !== null, 'Should find the saved derived instance');
        assert(found.content === 'shared content', `Expected 'shared content', got '${found.content}'`);
        assert(found.question === 'Which option?', `Expected 'Which option?', got '${found.question}'`);
      }),

      // TestBaseModel has no @Flag, so its findAll() matches any node that has a
      // test://base_content link — which includes TestDerivedModel instances.
      await test('TestBaseModel.findAll() returns instances of both base and derived types (polymorphic)', async () => {
        const derived = new TestDerivedModel(perspective);
        derived.content = 'polymorphic test';
        derived.question = 'Any answer?';
        await derived.save();

        // TestBaseModel.findAll() uses SurrealDB — no SHACL registration needed.
        // It queries by the test://base_content predicate, which derived instances
        // also possess (inherited @Property written by saveInstance).
        const allBase = await TestBaseModel.findAll(perspective);
        assert(allBase.length >= 1, `Expected ≥1 result from TestBaseModel.findAll(), got ${allBase.length}`);
        assert(
          allBase.some((b) => b.id === derived.id),
          'TestDerivedModel instance should appear in TestBaseModel.findAll()',
        );
      }),
    ];
  },
};
