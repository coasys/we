/**
 * Every module this build ships, judged by the contract's own lint.
 *
 * The registry already lints at registration and refuses what it must, but a refusal at boot is a
 * console line in an app that then quietly does less — which is the failure mode this codebase keeps
 * meeting, and the worst possible place to learn that a module is malformed. Here it is a red test.
 *
 * It exists here rather than in `@we/module-testing` because this is the only package that depends on
 * every bundled module; a testing package that imported them all would invert the dependency
 * direction the contract packages exist to keep straight.
 */
import { lintModule } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { bundledModules } from './bundledModules.generated';

/**
 * No framework components, which is what makes this runnable under plain vitest.
 *
 * A module that takes one from the host — the globe, the graph — gets `undefined` for it. That is
 * exactly what `lintModule` should tolerate: it judges the *declaration*, and a component's value is
 * the host's business. A module that needed a real component to describe itself would be doing
 * something at definition time that belongs in its store.
 */
const host = { components: {} };

describe('bundled modules', () => {
  for (const [id, factory] of Object.entries(bundledModules)) {
    it(`${id} satisfies the module contract`, () => {
      const lint = lintModule(factory(host));
      expect(lint.problems).toEqual([]);
      expect(lint.warnings).toEqual([]);
    });
  }

  it('names each module under the id its manifest claims', () => {
    // A seed key that disagreed with the manifest would namespace the store under one name and the
    // predicates under another, and nothing else checks it.
    for (const [id, factory] of Object.entries(bundledModules)) {
      expect(factory(host).manifest.id).toBe(id);
    }
  });
});
