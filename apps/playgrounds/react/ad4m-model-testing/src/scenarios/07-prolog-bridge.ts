// Phase 1a — validates generatePrologFacts() as a pure function.
// Live infer() integration is stubbed (see note below) — it tests infrastructure
// that Phase 1b removes.
import { generatePrologFacts } from '@coasys/ad4m';

import { assert, test } from '../harness/helpers';
import type { ScenarioModule } from '../harness/types';
import { TestPost } from '../models/TestPost';
import { TestTag } from '../models/TestTag';

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
        assert(facts.includes("triple(X, 'test://post_type', 'test://post')"), `Flag clause not found in:\n${facts}`);
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

      // @BelongsToMany reverse clause form (pure function — no perspective needed)
      test('generated facts for @BelongsToMany use reverse clause form', () => {
        // TestTag.posts is @BelongsToMany(() => TestPost, { through: 'test://has_tag' }).
        // The link direction is Post → test://has_tag → Tag, so to find all Posts for a Tag
        // the clause must swap subject/object: triple(V, 'test://has_tag', X).
        const tagFacts = generatePrologFacts(TestTag);
        assert(
          tagFacts.includes("triple(V, 'test://has_tag', X)"),
          `Expected reverse clause triple(V, 'test://has_tag', X) in:\n${tagFacts}`,
        );
        // Forward relations should still use the normal form
        assert(
          !tagFacts.includes("triple(X, 'test://has_tag', V)"),
          `Forward form should NOT appear for a reverse relation in:\n${tagFacts}`,
        );
      }),

      test('perspective.infer() succeeds using generated facts', async () => {
        const result = await perspective.infer(`${facts}\ntest_post(X).`);
        assert(result !== null, 'infer() returned null');
      }),
    ]);
  },
};
