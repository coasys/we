// Phase 1a — validates generatePrologFacts() as a pure function.
// Live infer() integration is stubbed (see note below) — it tests infrastructure
// that Phase 1b removes.
import { generatePrologFacts } from '@coasys/ad4m';
import type { ScenarioModule } from '../harness/types';
import { test, assert, stub } from '../harness/types';
import { TestPost } from '../models/TestPost';

export const scenario: ScenarioModule = {
  name: '07 — Prolog Bridge',
  run: async (perspective) => {
    const facts = generatePrologFacts(TestPost);

    return Promise.all([
      test('generatePrologFacts(Model) returns a non-empty string', () => {
        assert(typeof facts === 'string' && facts.length > 0, 'Expected non-empty string');
      }),

      test('generated facts include the @Flag predicate clause', () => {
        // TestPost has @Flag({ through: 'test://post_type', value: 'test://post' })
        assert(
          facts.includes("triple(X, 'test://post_type', 'test://post')"),
          `Flag clause not found in:\n${facts}`,
        );
      }),

      test('generated facts include clauses for @Property predicates', () => {
        // TestPost has title and body @Property decorators
        assert(facts.includes("'test://title'"), `title predicate not found in:\n${facts}`);
        assert(facts.includes("'test://body'"), `body predicate not found in:\n${facts}`);
      }),

      test('generated facts include clauses for @Collection predicates', () => {
        // TestPost has tags and comments @Collection decorators
        assert(facts.includes("'test://has_tag'"), `has_tag predicate not found in:\n${facts}`);
        assert(facts.includes("'test://has_comment'"), `has_comment predicate not found in:\n${facts}`);
      }),

      // Phase 2 — requires @BelongsToMany decorator (not yet implemented)
      stub('generated facts for @BelongsToMany use reverse clause form'),

      test('perspective.infer() succeeds using generated facts', async () => {
        const result = await perspective.infer(`${facts}\ntest_post(X).`);
        assert(result !== null, 'infer() returned null');
      }),

      // Phase 1b note: perspective.infer() with Prolog is being removed. Testing
      // live infer() here requires fighting executor SHACL state management and
      // validates infrastructure that's about to be deleted. The first 5 tests
      // already fully validate generatePrologFacts() as a pure function.
      stub('infer() with generated facts finds saved model instances'),
    ]);
  },
};
