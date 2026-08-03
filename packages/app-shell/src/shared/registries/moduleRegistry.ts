/**
 * Module Registry — installed feature modules and what they contribute.
 *
 * The fourth registry alongside `appRegistry`, `modelRegistry`, `templateRegistry` and `themeRegistry`,
 * and deliberately the same shape: modules become the next thing that follows an existing pattern
 * rather than a new concept. Runtime only — the durable half (`AgentSettings.installedModules`,
 * `Space.enabledModules`) arrives with the marketplace, when modules become installable rather than
 * bundled.
 *
 * ## What registering does
 *
 * Fans a {@link ModuleDefinition} out to the registries that already exist — component registry, slot
 * registry — and holds the module's store under `modules.<id>` for the template bag.
 *
 * ## The `modules` namespace must always exist
 *
 * Subtle and easy to get wrong. `$store` resolution splits on `.`, and a **single-segment** path does
 * `stores[storeName][prop]` with no guard — so `{ $store: 'modules.notes' }` throws if the `modules`
 * key is absent, rather than returning undefined. Deeper paths go through `walkPath`, which does
 * degrade safely.
 *
 * So: the namespace object is always present, and an individual module's key is absent until it
 * registers. That is exactly what makes `{ $if: { condition: { $store: 'modules.notes' } } }` the
 * supported way for a template to depend on an optional module.
 */
import { getModelPredicates, type ModelClass, registerModel, unregisterModel } from '@we/models';
import {
  checkModuleCompatibility,
  type ModuleDefinition,
  modulePredicatePrefix,
  modulePredicateViolations,
  type ModuleStoreDeps,
} from '@we/module-shared';
import type { SchemaNode } from '@we/schema-shared';

import { slotRegistry } from './slotRegistry';

export interface RegisteredModule {
  definition: ModuleDefinition;
  /** Instantiated lazily on registration, so a module can be declared before the host is ready. */
  store?: Record<string, unknown>;
}

const modules = new Map<string, RegisteredModule>();

/**
 * Wrap a module's chrome so it only renders where the community has the module turned on.
 *
 * Done as a schema condition rather than by filtering the registry, for two reasons. It needs no
 * reactivity plumbing in the host — `$if` already re-evaluates when the store changes, whereas
 * `slotRegistry` is a plain `Map` that would have to become reactive. And it composes: the module's
 * own visibility conditions still apply underneath, so a module never has to know it is being gated.
 *
 * `spaceStore.enabledModules` resolves to the seed's module list when a space has not decided, which
 * is what keeps existing spaces rendering the chrome they already had. See `Space.enabledModules`.
 */
function gateOnSpace(moduleId: string, node: SchemaNode): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $in: [moduleId, { $store: 'spaceStore.enabledModules' }] },
      then: node,
    },
  };
}

/**
 * The `modules.<id>.*` namespace handed to the renderer's stores bag.
 *
 * A single stable object mutated in place rather than rebuilt, so the reference in the bag stays
 * valid as modules register.
 */
export const moduleStores: Record<string, unknown> = {};

/** A registered module's embedded application, flattened for the host that mounts the iframes. */
export interface RegisteredEmbed {
  id: string;
  name: string;
  icon: string;
  image?: string;
  url: string;
  allow: string;
}

export interface RegisterResult {
  registered: boolean;
  /** Why not, if it was refused — suitable for an install prompt or a console warning. */
  problems: string[];
}

export const moduleRegistry = {
  /**
   * Register a module against this host.
   *
   * Refuses loudly rather than half-mounting, mirroring `planQuery` / `planEphemeral`: a module whose
   * declared backend or framework doesn't match would otherwise register components that fail at
   * render time, far from the cause.
   */
  register(
    definition: ModuleDefinition,
    host: { backend: string; framework: string },
    storeDeps?: ModuleStoreDeps,
  ): RegisterResult {
    // Predicates are how existing data is found, so minting one outside the module's own subtree is
    // not a bug to fix later — by the time it is noticed, data has been written under a name nobody
    // can adjudicate. Refused at registration for the same reason an incompatible backend is.
    const badPredicates = [...(definition.models ?? []), ...(definition.agentModels ?? [])].flatMap((model) =>
      modulePredicateViolations(definition.id, getModelPredicates(model as Parameters<typeof getModelPredicates>[0])),
    );
    if (badPredicates.length) {
      const problems = [
        `declares predicates outside ${modulePredicatePrefix(definition.id)}: ${badPredicates.join(', ')}`,
      ];
      console.warn(`module "${definition.id}" not registered: ${problems[0]}`);
      return { registered: false, problems };
    }

    const compatibility = checkModuleCompatibility(definition, host);
    if (!compatibility.compatible) {
      console.warn(`module "${definition.id}" not registered: ${compatibility.problems.join('; ')}`);
      return { registered: false, problems: compatibility.problems };
    }

    if (modules.has(definition.id)) {
      // Idempotent: re-registering the same id replaces rather than duplicating, so a hot reload or a
      // double-init doesn't produce two of everything.
      moduleRegistry.unregister(definition.id);
    }

    // Reactivity is lent by the host, so a module store never imports a framework.
    const store = storeDeps ? definition.createStore?.(storeDeps) : undefined;
    modules.set(definition.id, { definition, store });
    if (store) moduleStores[definition.id] = store;

    // Two registrations are needed for a module-owned entity, and missing either fails at a
    // different moment: SDNA install (in `installSpaceSdna`) puts the *shape* in the perspective,
    // while this puts the *class* where `model.create` / `$query` can resolve it by name. Without
    // this one the panel renders and only writing a note fails.
    // Space-scoped and agent-scoped models both register as resolvable classes; the same entity may
    // appear in both lists (installed into both kinds of dataset), so dedupe by class.
    const allModels = [...new Set([...(definition.models ?? []), ...(definition.agentModels ?? [])])];
    for (const model of allModels as ModelClass[]) {
      registerModel((model as unknown as { className: string }).className, model);
    }

    for (const [index, slot] of (definition.slots ?? []).entries()) {
      slotRegistry.register({
        ...slot,
        node: gateOnSpace(definition.id, slot.node),
        // Namespaced, and indexed so one module can contribute more than one piece of chrome.
        id: `${definition.id}:${index}`,
      });
    }

    return { registered: true, problems: [] };
  },

  unregister(id: string): void {
    const entry = modules.get(id);
    if (!entry) return;
    for (const index of (entry.definition.slots ?? []).keys()) slotRegistry.remove(`${id}:${index}`);
    const allModels = [...new Set([...(entry.definition.models ?? []), ...(entry.definition.agentModels ?? [])])];
    for (const model of allModels as ModelClass[]) {
      unregisterModel((model as unknown as { className: string }).className);
    }
    delete moduleStores[id];
    modules.delete(id);
  },

  get(id: string): RegisteredModule | undefined {
    return modules.get(id);
  },

  has(id: string): boolean {
    return modules.has(id);
  },

  all(): RegisteredModule[] {
    return [...modules.values()];
  },

  /**
   * Components every registered module contributes, for the host's component registry.
   *
   * Most modules should contribute none: in a schema fragment `Column` is a registry key rather than
   * an import, so fragments are framework-agnostic. Framework components are for imperative cores
   * only.
   */
  components(): Record<string, unknown> {
    return Object.assign({}, ...moduleRegistry.all().map((m) => m.definition.components ?? {}));
  },

  /**
   * Entity types every registered module owns, for the host to install into a dataset.
   *
   * Collected here rather than installed per-module so idempotency lives in **one** place — WE
   * already carries `cleanupSpaceSdna` as remediation for shapes installed twice by different
   * agents, and N modules each rolling their own install is that bug with more instances.
   */
  models(): unknown[] {
    return moduleRegistry.all().flatMap((m) => m.definition.models ?? []);
  },

  /** Entity types modules install into the agent's root dataset — see `ModuleDefinition.agentModels`. */
  agentModels(): unknown[] {
    return moduleRegistry.all().flatMap((m) => m.definition.agentModels ?? []);
  },

  /**
   * Every registered module that contributes an embedded application, in registration order.
   *
   * What used to be `appRegistry`. Embedded apps are modules whose contribution happens to be an
   * iframe, so they arrive through the same registration, gating and refusal path as every other
   * module rather than a parallel one.
   */
  embeds(): RegisteredEmbed[] {
    return moduleRegistry
      .all()
      .filter((m) => m.definition.embed)
      .map(({ definition }) => ({
        id: definition.id,
        name: definition.name,
        icon: definition.icon ?? '',
        image: definition.embed!.image,
        url: definition.embed!.url,
        allow: definition.embed!.allow,
      }));
  },

  /** Named schema fragments, keyed `<moduleId>.<fragment>` so two modules can't collide. */
  schemas(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const { definition } of moduleRegistry.all()) {
      for (const [name, node] of Object.entries(definition.schemas ?? {})) {
        out[`${definition.id}.${name}`] = node;
      }
    }
    return out;
  },
};
