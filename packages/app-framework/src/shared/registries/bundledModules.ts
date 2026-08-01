/**
 * The feature modules compiled into this build, and the boot-time registration that activates the
 * subset a deployment's seed asks for.
 *
 * Bundled rather than dynamically loaded, deliberately: the registry only needs static registration
 * until the marketplace exists, and `import()` brings a whole separate problem (a dynamically-loaded
 * bundle carrying its own reactive runtime gets a *second* one, and reactivity silently stops crossing
 * the boundary). Solving that is worth doing against a real module, not speculatively.
 *
 * Adding a module here plus an id in `we-seed.json` is the whole install story for now.
 */
import { createGlobeModule } from '@we/module-globe';
import type { ModuleDefinition } from '@we/schema-shared';

/**
 * Factories rather than definitions, because a module may need something from the host to describe
 * itself — the globe takes the `CesiumGlobe` component so its own package never imports Solid or
 * `@we/widgets`, keeping those single instances shared with the host.
 */
export type BundledModuleFactory = (deps: BundledModuleDeps) => ModuleDefinition;

export interface BundledModuleDeps {
  /** Framework components the host already holds, passed in rather than imported by the module. */
  components: Record<string, unknown>;
}

export const bundledModules: Record<string, BundledModuleFactory> = {
  globe: ({ components }) => createGlobeModule(components.CesiumGlobe),
};

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
 * unexplained missing component, which is precisely the confusion the renderer's placeholder now
 * names.
 */
export function activateSeedModules(
  ids: string[] | undefined,
  deps: BundledModuleDeps,
  host: { backend: string; framework: string },
  registry: {
    register: (
      definition: ModuleDefinition,
      host: { backend: string; framework: string },
    ) => { registered: boolean; problems: string[] };
  },
): ModuleActivation {
  const result: ModuleActivation = { activated: [], missing: [], refused: [] };

  for (const id of ids ?? []) {
    const factory = bundledModules[id];
    if (!factory) {
      result.missing.push(id);
      continue;
    }
    const outcome = registry.register(factory(deps), host);
    if (outcome.registered) result.activated.push(id);
    else result.refused.push({ id, problems: outcome.problems });
  }

  if (result.missing.length) {
    console.warn(`seed declares modules not present in this build: ${result.missing.join(', ')}`);
  }

  return result;
}
