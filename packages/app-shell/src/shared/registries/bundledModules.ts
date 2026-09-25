/**
 * The feature modules compiled into this build, and the boot-time registration that activates the
 * subset a deployment's seed asks for.
 *
 * Bundled rather than dynamically loaded, deliberately: a store factory is arbitrary code with the
 * host's kernels, and the capability model covers what a schema may *name*, not what code may *do*.
 * A deployment trusts the modules it bundles the way it trusts the app around them — which is also
 * how a module from outside this repository arrives: the seed names its package, the generator
 * imports it, and the deployment rebuilds.
 *
 * ## One factory shape
 *
 * Every module package exports `createModule(host)`, taking a `ModuleHost` and returning a
 * `ModuleDefinition`. Most ignore the host; the globe and the graph take a framework component from
 * it, so their packages never import Solid — see `ModuleHost`. One shape is what lets
 * `generateModuleRegistry.mjs` name a package and nothing else.
 *
 * The map itself is **generated** from `we-seed.json` — see `bundledModules.generated.ts`. A module
 * the seed does not name is never imported, so it leaves the bundle rather than merely the rail.
 */
import type { ModuleDefinition, ModuleHost, ModuleHostProfile, ModuleStoreDeps } from '@we/module-shared';

import { bundledModules } from './bundledModules.generated';

export { bundledModules };

export type BundledModuleFactory = (host: ModuleHost) => ModuleDefinition;

export interface ActivationDeps extends ModuleHost {
  /** Reactivity lent to module stores, so a module needn't import a framework. */
  storeDeps?: ModuleStoreDeps;
}

export interface ModuleActivation {
  activated: string[];
  /** Ids the seed asked for that this build doesn't contain. */
  missing: string[];
  /** Ids that were refused as incompatible, with the reason. */
  refused: { id: string; problems: string[] }[];
}

/**
 * Activate the modules a seed declares.
 *
 * Reports rather than throws. A deployment naming a module this build lacks is a configuration
 * mistake, not a reason to fail boot — and a silently missing module surfaces much later as an
 * unexplained missing component.
 */
export function activateSeedModules(
  ids: string[] | undefined,
  deps: ActivationDeps,
  host: ModuleHostProfile,
  registry: {
    register: (
      definition: ModuleDefinition,
      host: ModuleHostProfile,
      storeDeps?: ModuleStoreDeps,
    ) => { registered: boolean; problems: string[] };
    danglingAnchors?: () => string[];
  },
  factories: Record<string, BundledModuleFactory> = bundledModules,
): ModuleActivation {
  const result: ModuleActivation = { activated: [], missing: [], refused: [] };

  for (const id of ids ?? []) {
    const factory = factories[id];
    if (!factory) {
      result.missing.push(id);
      continue;
    }
    const outcome = registry.register(factory({ components: deps.components }), host, deps.storeDeps);
    if (outcome.registered) result.activated.push(id);
    else result.refused.push({ id, problems: outcome.problems });
  }

  if (result.missing.length) {
    console.warn(`seed declares modules not present in this build: ${result.missing.join(', ')}`);
  }

  // Checked once the whole seed is in, not per module: contributing to an anchor whose provider has
  // not registered yet is ordinary, since seed order is a list rather than a dependency graph.
  const dangling = registry.danglingAnchors?.() ?? [];
  if (dangling.length) {
    console.warn(`chrome contributed to anchors no module provides: ${dangling.join(', ')}`);
  }

  return result;
}
