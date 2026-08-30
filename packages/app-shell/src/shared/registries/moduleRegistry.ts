/**
 * Module Registry — installed feature modules and what they contribute.
 *
 * The fourth registry alongside `appRegistry`, `entityRegistry`, `templateRegistry` and `themeRegistry`,
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
 * Subtle and easy to get wrong. Store-path resolution splits on `.`, and a **single-segment** path does
 * `stores[storeName][prop]` with no guard — so reading `modules.notes` throws if the `modules`
 * key is absent, rather than returning undefined. Deeper paths go through `walkPath`, which does
 * degrade safely.
 *
 * So: the namespace object is always present, and an individual module's key is absent until it
 * registers. That is exactly what makes `{ $: 'modules.notes' }` as a condition the
 * supported way for a template to depend on an optional module.
 */
import { type EntityManifestEntry, type SchemaPort, validateManifest } from '@we/backend-shared';
import { type EntityClass, getEntityPredicates, registerEntity, unregisterEntity } from '@we/entities';
import {
  checkModuleCompatibility,
  type ModuleDefinition,
  modulePredicatePrefix,
  modulePredicateViolations,
  type ModuleScope,
  type ModuleStoreDeps,
} from '@we/module-shared';
import { collectComponentTypes, type SchemaNode } from '@we/schema-shared';

import { dockFrame, dockRegistry } from './dockRegistry';
import { slotRegistry } from './slotRegistry';

/**
 * What a module puts in front of the user — which decides *where* it can be turned off.
 *
 * The rule is that a contribution is gated at the layer where it renders:
 *
 * | surface      | contributes        | renders                        | agent | space |
 * |--------------|--------------------|--------------------------------|-------|-------|
 * | `chrome`     | launcher, slots    | inside a space                 | yes   | yes   |
 * | `app`        | an embed           | in the shell                   | yes   | no    |
 * | `capability` | components only    | wherever a template mounts it  | yes   | no    |
 *
 * Chrome is the only surface a community decides about, because it is the only one that appears
 * inside their space.
 *
 * An **app** sits in the shell's switcher beside Spaces rather than within one, and its iframe
 * deliberately outlives navigation. Gating it per space would make an entry come and go as the
 * agent moved between spaces that have nothing to do with it, and would tear down a live session as
 * a side effect of walking into a space.
 *
 * A **capability** is mounted by whichever template asks for it — the globe module supplies
 * `CesiumGlobe`, and the honest effect of a space switching that "off" would be to break the
 * template's route. Uninstalling one at the agent layer is offered, but guarded: see
 * {@link moduleRegistry.requiredBy}.
 *
 * Both cases come out the same way: **the template decides**, which is a mechanism that already
 * exists. A community that does not want the globe view or the Flux route uses a template without
 * it.
 */
export type ModuleSurface = 'chrome' | 'app' | 'capability';

/**
 * Derived rather than declared, so a module author cannot get it wrong and a new kind of module
 * needs no change here or in the settings pages — the answer follows from what it contributes.
 */
export function moduleSurface(definition: ModuleDefinition): ModuleSurface {
  if (definition.embed) return 'app';
  if (definition.launcher || definition.slots?.length || definition.docks?.length) return 'chrome';
  return 'capability';
}

export interface RegisteredModule {
  definition: ModuleDefinition;
  /** Instantiated lazily on registration, so a module can be declared before the host is ready. */
  store?: Record<string, unknown>;
  /**
   * Teardown the store registered through `deps.onDispose`, run on unregister.
   *
   * Held beside the store rather than on it: a module's store keys are template-callable at
   * `modules.<id>.<key>`, and teardown is not vocabulary a rendered schema should have.
   */
  disposers?: Array<() => void>;
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
 * Gated on `activeModules` — the three layers intersected, less this agent's mutes — rather than on
 * the space's decision alone. The space saying yes is necessary but not sufficient: a module the
 * agent has not installed, or has muted here, must not render either. Each layer falls back to the
 * registered set when undecided, which is what keeps existing spaces and existing agents rendering
 * the chrome they already had. See `Space.enabledModules` and `AgentSettings.installedModules`.
 *
 * ## Chrome that is about something still running
 *
 * All of the above is about chrome that belongs to a *space*, which is nearly all of it. A module
 * declaring `holdsWhen` is saying it sometimes has live state instead, and that state does not stop
 * mattering because the user walked into a different space: a call outlives navigating away from
 * where it started, and gating its bar on the destination space took away the controls — hang-up
 * included — while the call carried on regardless. So the gate widens to "enabled here, or holding
 * something". See `ModuleDefinition.holdsWhen`.
 *
 * ## Chrome that is not about a space at all
 *
 * A module declaring `scope: 'agent'` needs no separate gate here, because `activeModules` already
 * answers for it: its subject is the person rather than a community, so the community layer is
 * skipped there and being installed is the whole test. One gate, one store member, and no way for
 * the two to disagree. See `ModuleDefinition.scope` and `spaceStore.activeModules`.
 */
function gateOnSpace(moduleId: string, node: SchemaNode, holdsWhen?: string): SchemaNode {
  const enabledHere = `'${moduleId}' in spaceStore.activeModules`;
  return {
    type: '$if',
    props: {
      condition: { $: holdsWhen ? `${enabledHere} || ${holdsWhen}` : enabledHere },
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

const compiledEntities = new Map<string, unknown[]>();

/**
 * Compile every module-declared entity of one scope, once.
 *
 * Memoised per module because install runs on every dataset switch and compiling produces fresh
 * classes each time, which would churn the model registry underneath live queries.
 */
function declaredEntities(schemas: SchemaPort, scope: ModuleScope): unknown[] {
  return moduleRegistry.all().flatMap(({ definition }) => {
    if (!definition.entities) return [];
    if ((definition.entities.scope ?? 'space') !== scope) return [];
    const cached = compiledEntities.get(definition.id);
    if (cached) return cached;
    const compiled = Object.values(
      schemas.declare(definition.entities.manifest, {
        moduleId: definition.id,
        predicates: definition.entities.predicates,
      }),
    );
    compiledEntities.set(definition.id, compiled);
    return compiled;
  });
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
    const badPredicates = [
      ...(definition.models ?? []).flatMap((model) =>
        modulePredicateViolations(
          definition.id,
          getEntityPredicates(model as Parameters<typeof getEntityPredicates>[0]),
        ),
      ),
      // Declared entities mint under the module's subtree by construction, so the only way a bad
      // predicate enters is an explicit override — which exists precisely to name something the
      // minting rule wouldn't, and therefore needs the same adjudication.
      ...modulePredicateViolations(definition.id, Object.values(definition.entities?.predicates ?? {})),
    ];
    if (badPredicates.length) {
      const problems = [
        `declares predicates outside ${modulePredicatePrefix(definition.id)}: ${badPredicates.join(', ')}`,
      ];
      console.warn(`module "${definition.id}" not registered: ${problems[0]}`);
      return { registered: false, problems };
    }

    // A declared manifest is validated here, not when it is eventually compiled: `declare` runs on
    // the first dataset switch, so a malformed manifest would otherwise register fine and fail far
    // from the module that shipped it — and once user-authored manifests share this compile path,
    // an unvalidated one is data corruption waiting on a typo.
    if (definition.entities) {
      const result = validateManifest(definition.entities.manifest);
      if (!result.valid) {
        const problems = result.errors.map((e) => `invalid entities manifest at ${e.path}: ${e.message}`);
        console.warn(`module "${definition.id}" not registered: ${problems.join('; ')}`);
        return { registered: false, problems };
      }
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

    // Reactivity is lent by the host, so a module store never imports a framework. `onDispose` is
    // added per module rather than living on the shared deps object, because the shared one cannot
    // say *which* module registered a disposer — and running the wrong module's teardown is worse
    // than running none.
    const disposers: Array<() => void> = [];
    const store = storeDeps
      ? definition.createStore?.({ ...storeDeps, onDispose: (fn) => disposers.push(fn) })
      : undefined;
    modules.set(definition.id, { definition, store, disposers });
    if (store) moduleStores[definition.id] = store;

    // Two registrations are needed for a module-owned entity, and missing either fails at a
    // different moment: SDNA install (in `installSpaceSdna`) puts the *shape* in the perspective,
    // while this puts the *class* where `record.create` / `$query` can resolve it by name. Without
    // this one the panel renders and only writing a note fails.
    for (const model of (definition.models ?? []) as EntityClass[]) {
      registerEntity((model as unknown as { className: string }).className, model);
    }

    for (const [index, slot] of (definition.slots ?? []).entries()) {
      slotRegistry.register({
        ...slot,
        node: gateOnSpace(definition.id, slot.node, definition.holdsWhen),
        // Namespaced, and indexed so one module can contribute more than one piece of chrome.
        id: `${definition.id}:${index}`,
      });
    }

    // Docks are registered twice on purpose, to two registries that answer different questions.
    // `dockRegistry` holds the contribution so the shell can resolve its geometry and subtract it
    // from the content viewport; `slotRegistry` renders the resulting frame, because once the host
    // has wrapped it in a positioned box it is ordinary shell chrome and needs no second render
    // path. The `dock:` id prefix keeps the two namespaces from colliding.
    for (const [index, dock] of (definition.docks ?? []).entries()) {
      const id = `${definition.id}:${index}`;
      dockRegistry.register({ ...dock, id, moduleId: definition.id });
      slotRegistry.register({
        anchor: 'dock-right',
        order: dock.order,
        id: `dock:${id}`,
        node: gateOnSpace(
          definition.id,
          dockFrame({ ...dock, id, moduleId: definition.id }, dock.node),
          definition.holdsWhen,
        ),
      });
    }

    return { registered: true, problems: [] };
  },

  /**
   * Anchors contributed to that no registered module provides.
   *
   * Reported rather than thrown, and checked after the whole seed has registered rather than per
   * module, because contributing to an anchor before its provider registers is ordinary — seed order
   * is alphabetical, not a dependency graph.
   *
   * It exists because the failure is otherwise invisible: chrome aimed at a missing anchor renders
   * nowhere, which looks exactly like a module that is simply switched off. The same reason
   * `activateSeedModules` reports ids this build does not contain.
   */
  danglingAnchors(): string[] {
    const provided = new Set([...modules.values()].flatMap(({ definition }) => definition.anchors ?? []));
    return slotRegistry.contributedAnchors().filter((anchor) => !provided.has(anchor));
  },

  unregister(id: string): void {
    const entry = modules.get(id);
    if (!entry) return;
    for (const index of (entry.definition.slots ?? []).keys()) slotRegistry.remove(`${id}:${index}`);
    for (const index of (entry.definition.docks ?? []).keys()) {
      dockRegistry.remove(`${id}:${index}`);
      slotRegistry.remove(`dock:${id}:${index}`);
    }
    for (const model of (entry.definition.models ?? []) as EntityClass[]) {
      unregisterEntity((model as unknown as { className: string }).className);
    }
    // Declared entities are compiled lazily and cached, so withdrawing a module has to drop both
    // the resolvable classes and the cache — otherwise re-registering it would reuse classes
    // compiled against the previous declaration.
    for (const entityName of Object.keys(entry.definition.entities?.manifest.entities ?? {})) {
      unregisterEntity(entityName);
    }
    compiledEntities.delete(id);
    delete moduleStores[id];
    modules.delete(id);

    // Teardown last, and after the entry is gone: a disposer that throws must not leave a
    // half-unregistered module in the map, and a disposer that re-enters `unregister` (a call
    // module closing a session that fires a handler that unregisters) finds nothing to do rather
    // than recursing.
    //
    // Reverse order because later teardown generally depends on earlier setup, and each is guarded
    // because these close real devices: one throwing disposer must not be able to leave the camera
    // on for the rest of them.
    for (const dispose of [...(entry.disposers ?? [])].reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error(`module "${id}": teardown failed`, error);
      }
    }
  },

  get(id: string): RegisteredModule | undefined {
    return modules.get(id);
  },

  has(id: string): boolean {
    return modules.has(id);
  },

  /**
   * Which module supplies each contributed component, by component name.
   *
   * The lookup behind {@link moduleRegistry.requiredBy}: a template names components, not modules,
   * so the only way to know a template depends on the globe module is to know that module is where
   * `CesiumGlobe` comes from.
   */
  componentProviders(): Map<string, string> {
    const providers = new Map<string, string>();
    for (const { definition } of modules.values()) {
      for (const name of Object.keys(definition.components ?? {})) providers.set(name, definition.id);
    }
    return providers;
  },

  /**
   * The modules a schema needs in order to render — derived from the components it actually mounts.
   *
   * This is what makes a capability module safe to switch off: without it, uninstalling the globe
   * takes `CesiumGlobe` out from under whatever template mounts it and the route simply stops
   * rendering, with nothing to say why. With it, the choice can be refused and the reason named.
   */
  requiredBy(schema: SchemaNode): string[] {
    const providers = this.componentProviders();
    const required = new Set<string>();
    for (const name of collectComponentTypes(schema)) {
      const moduleId = providers.get(name);
      if (moduleId) required.add(moduleId);
    }
    return [...required];
  },

  all(): RegisteredModule[] {
    return [...modules.values()];
  },

  /**
   * Store members each module keeps for host chrome, keyed by module id.
   *
   * Read by `buildTemplateBag` when it assembles the space-tier `modules` namespace — see
   * `ModuleStoreSurface` for why a module rather than the host declares this. Rebuilt on each call
   * rather than memoised: modules register and unregister at runtime, and this is consulted once per
   * bag construction, not per read.
   */
  chromeOnlyStoreMembers(): Record<string, readonly string[]> {
    const out: Record<string, readonly string[]> = {};
    for (const { definition } of moduleRegistry.all()) {
      if (definition.chromeOnlyStoreMembers?.length) out[definition.id] = definition.chromeOnlyStoreMembers;
    }
    return out;
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

  /**
   * Every module-owned entity type in the form the backend installs — the union of modules that
   * ship backend-written classes (`models`) and modules that *declare* theirs (`entities`).
   *
   * Declared entities are compiled through the backend's own schema port, so a module that
   * declares rather than writes needs no knowledge of which backend is running. Results are
   * memoised per module: install runs on every dataset switch, and compiling produces fresh
   * classes each time, which would otherwise churn the model registry underneath live queries.
   */
  moduleSchemas(schemas: SchemaPort): unknown[] {
    return [...moduleRegistry.models(), ...declaredEntities(schemas, 'space')];
  },

  /**
   * The same, for entities a module declared `scope: 'agent'` — installed into the **root dataset**
   * rather than into every space.
   *
   * Separate from `moduleSchemas` rather than filtered by the caller, because the two go to
   * different datasets and mixing them is the failure this split exists to prevent: an agent-scoped
   * entity installed into a shared space would sync one person's private records to a whole
   * community, and a space-scoped one installed into the root would be queryable nowhere useful.
   *
   * `models` are deliberately not offered here. They are backend-written classes, which predate
   * the manifest path; a module wanting private per-agent storage declares its entities.
   */
  agentSchemas(schemas: SchemaPort): unknown[] {
    return declaredEntities(schemas, 'agent');
  },

  /**
   * Every module-declared entity as a neutral manifest entry, whatever scope it installs into.
   *
   * What a `scope` drill-down is resolved against: an adapter looks the anchor up by name and reads
   * the `via` relation's predicate. Module entities were in neither list the host merged — not
   * foreign schemas, not core vocabulary — so a module declaring a relation and then drilling into
   * it failed with "no such relation in the current perspective's model manifest", which is a true
   * statement about a list it was never added to. The Pocket is the first module to have its own
   * relation to drill through; every one before it anchored on core vocabulary and resolved by luck.
   *
   * Both scopes, deliberately. Which dataset an entity is *installed* into says nothing about where
   * a query naming it runs from — the Pocket's panel reads the root dataset while a space is open,
   * so filtering this list by scope would put its relations out of reach exactly when they are used.
   */
  entityEntries(schemas: SchemaPort): EntityManifestEntry[] {
    return moduleRegistry.all().flatMap(({ definition }) =>
      definition.entities
        ? schemas.entries(definition.entities.manifest, {
            moduleId: definition.id,
            predicates: definition.entities.predicates,
          })
        : [],
    );
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
