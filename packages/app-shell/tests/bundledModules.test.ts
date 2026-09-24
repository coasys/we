/**
 * Every module this build ships: well formed, and able to run *on this host*.
 *
 * Two different questions, and only the first was asked. `lintModule` judges a definition on its own —
 * a definition can be perfect and still be refused at registration, because refusal is about what the
 * host implements. That gap is not theoretical: the live module named the `view` kernel, which the bag
 * implements and `HOST_KERNELS` did not list, so it was refused at boot and had no store, no launcher,
 * no slot and no panel. The feature was absent, and a refusal reads as a console line in an app that
 * otherwise works — so the obvious conclusion is that the module is switched off somewhere.
 *
 * The registry already checks both at boot. Here they are red tests instead of console lines, which is
 * the whole point: "a module quietly does less" is the failure mode this codebase keeps meeting.
 *
 * It lives here rather than in `@we/module-testing` because this is the only package that depends on
 * every bundled module; a testing package importing them all would invert the dependency direction the
 * contract packages exist to keep straight.
 */
import { bundledModules } from '@shared/registries/bundledModules.generated';
import { createModuleStoreDeps, HOST_KERNELS } from '@shared/registries/moduleHostServices';
import { checkModuleCompatibility, KERNEL_NAMES, lintModule } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

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

  /**
   * The check that was missing, and the one that matters most: can it run *here*.
   *
   * A definition can be flawless and still be refused, because refusal is about the host. Registration
   * reports its reasons to the console and carries on, which is the right thing for a deployment naming
   * a module it does not ship and the wrong thing to find out from.
   */
  for (const [id, factory] of Object.entries(bundledModules)) {
    it(`${id} can run on this host`, () => {
      const outcome = checkModuleCompatibility(factory(host), {
        backend: 'ad4m',
        framework: 'solid',
        kernels: HOST_KERNELS,
      });
      expect(outcome.problems).toEqual([]);
      expect(outcome.compatible).toBe(true);
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

describe('what this host says it implements', () => {
  /**
   * `HOST_KERNELS` against the keys the deps bag actually builds, in both directions.
   *
   * Two hand-maintained copies of one fact, and each way round fails differently. A kernel implemented
   * and not declared means every module naming it is refused, silently — which is the bug this test was
   * written for. A kernel declared and not implemented is worse: the module registers, asks for it, and
   * gets `undefined` from a bag that promised it.
   */
  /**
   * The one kernel the generic bag does not carry.
   *
   * `secrets` reads a module's own secret-typed settings, so it cannot be built without knowing which
   * module is asking — the registry adds it per module. Named here rather than allowed by a loose
   * assertion, so the exception stays one exception.
   */
  const PER_MODULE = ['secrets'];

  it('declares exactly the kernels it hands a module', () => {
    const built = createModuleStoreDeps({
      signal: (initial) => [() => initial, () => {}],
      effect: (fn) => fn(),
    });
    const handed = [...Object.keys(built.kernels), ...PER_MODULE].sort();
    expect([...HOST_KERNELS].sort()).toEqual(handed);
  });

  it('names only kernels the contract knows', () => {
    // A typo here is the same silent refusal as an omission, from the other direction.
    for (const name of HOST_KERNELS) expect(KERNEL_NAMES).toContain(name);
  });
});
