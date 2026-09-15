/**
 * Module Registry — installed feature modules and what they contribute.
 *
 * Fans a {@link ModuleDefinition} out to the registries that already exist — the slot registry, the
 * dock registry, the entity registry — and holds each module's store under `modules.<id>` for the
 * template bag. Runtime only: the durable half is `AgentSettings.installedModules` and
 * `Space.enabledModules`.
 *
 * ## The `modules` namespace must always exist
 *
 * Store-path resolution splits on `.`, and a **single-segment** path does `stores[storeName][prop]`
 * with no guard — so reading `modules.notes` throws if the `modules` key is absent. The namespace
 * object is always present, and an individual module's key is absent until it registers. That is
 * what makes `{ $: 'modules.notes' }` as a condition the supported way for a template to depend on
 * an optional module.
 *
 * ## Panels are plumbed here, not in the module
 *
 * A panel used to be seven string keys into a module's store, and a module with one panel wrote a
 * store whose only job was to answer them. The registry builds that plumbing now: a small store per
 * panel holding what the shell reads (`edge`, `size`, `float`, `aspect`, `min`) and the controls that
 * open and close it. Where the module owns openness it names the keys and the plumbing reads through;
 * where it does not — the ordinary case — the plumbing holds the flag itself. See `panelPlumbing`.
 */
import { type EntityManifestEntry, type SchemaPort, validateManifest } from '@we/backend-shared';
import { type BlockEntityStatic, registerBlock, unregisterBlock } from '@we/block-shared';
import { unregisterEntity } from '@we/entities';
import {
  type Activity,
  type ActivityShape,
  type BlockContribution,
  checkModuleCompatibility,
  KERNEL_NAMES,
  markAction,
  markState,
  moduleCapabilities,
  type ModuleDefinition,
  type ModuleFunction,
  type ModuleHostProfile,
  type ModuleLauncher,
  modulePredicatePrefix,
  modulePredicateViolations,
  type ModuleScope,
  type ModuleStore,
  type ModuleStoreDeps,
  type ModuleStoreSurface,
  type PanelBid,
  type PanelContribution,
  storeSurface,
} from '@we/module-shared';
import { collectComponentTypes, type SchemaNode, type TemplateSchema } from '@we/schema-shared';

import type { SettingGroup, SettingValue } from '../moduleSettings';
import { type DockEntry, dockFrame, dockRegistry } from './dockRegistry';
import { notePublisher } from './moduleHostServices';
import { slotRegistry } from './slotRegistry';

/**
 * What a module puts in front of the user — which decides *where* it can be turned off.
 *
 * | surface      | contributes           | renders                       | agent | space |
 * |--------------|-----------------------|-------------------------------|-------|-------|
 * | `chrome`     | panels, slots, rail   | inside a space                | yes   | yes   |
 * | `app`        | an embed              | in the shell                  | yes   | no    |
 * | `capability` | components only       | wherever a template mounts it | yes   | no    |
 *
 * Chrome is the only surface a community decides about, because it is the only one that appears
 * inside their space. An **app** sits in the shell's switcher and its iframe outlives navigation. A
 * **capability** is mounted by whichever template asks for it, and the honest effect of a space
 * switching it "off" would be to break the template's route — so the template decides.
 */
export type ModuleSurface = 'chrome' | 'app' | 'capability';

/** Derived rather than declared, so a module author cannot get it wrong. */
export function moduleSurface(definition: ModuleDefinition): ModuleSurface {
  const c = definition.contributes;
  if (c?.embed) return 'app';
  if (c?.panels?.length || c?.slots?.length || c?.launchers?.length) return 'chrome';
  return 'capability';
}

/**
 * The host's side of one panel: whether it is up, how to change that, and the store the shell reads
 * its geometry keys from.
 */
export interface PanelControls {
  /** `<moduleId>:<name>` — what the dock registry, a placement and `meta.panels.dock` all key on. */
  dockId: string;
  moduleId: string;
  panel: PanelContribution;
  /** Whether the host holds the open flag (the default) or reads it off the module's store. */
  hostOwned: boolean;
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** `edge` / `size` / `float` / `aspect` / `min` as accessors — what `DockEntry.store` points at. */
  store: Record<string, unknown>;
}

export interface RegisteredModule {
  definition: ModuleDefinition;
  /** Instantiated at registration, so a module can be declared before the host is ready. */
  store?: ModuleStore;
  /**
   * Teardown the store registered through `deps.onDispose`, run on unregister. Held beside the
   * store rather than on it: a module's store keys are template-callable, and teardown is not
   * vocabulary a rendered schema should have.
   */
  disposers?: Array<() => void>;
  /** This module's panels, by name. */
  panels: Map<string, PanelControls>;
}

const modules = new Map<string, RegisteredModule>();

/**
 * What each module's settings currently resolve to, answered by whoever can see a space.
 *
 * Injected rather than computed here: the answer lives on a `Space`, a `SpacePreference` and the
 * agent's root dataset, and this registry mounts below all three. Defaults to silence, so a host that
 * has not wired it hands every module its declared defaults. Read at *call* time, not at
 * registration: a module store is built once at boot and the space it is in changes all day.
 */
let readSettings: (group: string) => Record<string, SettingValue> = () => ({});

/**
 * Wrap a module's chrome so it only renders where the community has the module turned on.
 *
 * A schema condition rather than a filtered registry: `$if` already re-evaluates when the store
 * changes, and it composes — the module's own visibility conditions still apply underneath. Gated on
 * `activeModules` (the layers intersected, less this agent's mutes), widened by the module's `holds`
 * key so chrome about something still running — a call — survives walking into a space that never
 * enabled it. See `ModuleContributions.holds`.
 */
function gateOnSpace(moduleId: string, node: SchemaNode, holds?: string): SchemaNode {
  const enabledHere = `'${moduleId}' in spaceStore.activeModules`;
  return {
    type: '$if',
    props: {
      condition: { $: holds ? `${enabledHere} || modules.${moduleId}.${holds}` : enabledHere },
      then: node,
    },
  };
}

/**
 * The `modules.<id>.*` namespace handed to the renderer's stores bag. One stable object mutated in
 * place rather than rebuilt, so the reference in the bag stays valid as modules register.
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
    const entities = definition.contributes?.entities;
    if (!entities) return [];
    if ((entities.scope ?? 'space') !== scope) return [];
    const cached = compiledEntities.get(definition.manifest.id);
    if (cached) return cached;
    const byName = schemas.declare(entities.manifest, {
      moduleId: definition.manifest.id,
      predicates: entities.predicates,
    }) as Record<string, unknown>;
    const compiled = Object.values(byName);
    compiledEntities.set(definition.manifest.id, compiled);
    registerModuleBlocks(definition, byName);
    return compiled;
  });
}

/** The `_type` a composed block of a module entity carries. */
export function moduleBlockNodeType(block: BlockContribution): string {
  return block.nodeType ?? block.entity.toLowerCase();
}

/**
 * Register a module's content types once their entities exist as classes.
 *
 * Here rather than at registration because a block registration carries the entity's compiled class
 * — the persistence layer writes a composed block through it — and a module's entity is compiled
 * lazily, on the first dataset install. The display is not here: it is the host's, since drawing a
 * declared card is a framework component's job. See `moduleBlockDisplays` in the Solid host.
 */
function registerModuleBlocks(definition: ModuleDefinition, compiled: Record<string, unknown>): void {
  const id = definition.manifest.id;
  for (const block of definition.contributes?.blocks ?? []) {
    const model = compiled[block.entity];
    if (!model) {
      console.warn(
        `module "${id}" block "${block.entity}" names an entity its manifest does not declare; not registered`,
      );
      continue;
    }
    if (!definition.contributes?.parts?.[block.card]) {
      console.warn(`module "${id}" block "${block.entity}" names card part "${block.card}", which it does not publish`);
    }
    const input = block.input ? definition.contributes?.components?.[block.input] : undefined;
    if (block.input && !input) {
      console.warn(
        `module "${id}" block "${block.entity}" names input component "${block.input}", which it does not contribute`,
      );
    }
    registerBlock({
      nodeTypes: [moduleBlockNodeType(block)],
      model: model as BlockEntityStatic,
      entity: block.entity,
      ...(input ? { input: input as (props: unknown) => unknown } : {}),
    });
  }
}

/**
 * The interface's own composition of this module's panel, or the module's default.
 *
 * A module's presentation is a *default*, not a monopoly. Resolved at render rather than at
 * registration, because a template is chosen and re-chosen while the module stays installed. Keyed
 * by **dock id**, not by module: keyed by module, one supplied body would replace the contents of
 * every panel a module contributes.
 */
function suppliedOrOwn(moduleId: string, dockId: string, dock: string, own: SchemaNode): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: `shellStore.panelSupplied['${dockId}']` },
      then: { type: 'TemplatePanelBody', props: { moduleId, dock } },
      else: own,
    },
  };
}

/** A signal for a host that lent none — tests, and a module registered before any framework exists. */
function plainSignal<T>(initial: T): [() => T, (next: T) => void] {
  let value = initial;
  return [() => value, (next: T) => void (value = next)];
}

const call = (store: ModuleStore | undefined, key: string | undefined): unknown => {
  if (!key) return undefined;
  const member = store?.[key];
  return typeof member === 'function' ? (member as () => unknown)() : member;
};

const invoke = (store: ModuleStore | undefined, key: string | undefined, what: string): void => {
  if (!key) return;
  const member = store?.[key];
  if (typeof member === 'function') (member as () => void)();
  else console.warn(`module panel: ${what} names "${key}", which its store does not have`);
};

const DEFAULT_BID: PanelBid = { edge: 'right', size: 'md' };

/**
 * Build the host's half of one panel.
 *
 * Two sources for the bid: the static object on the contribution, and — when the module named a
 * store key instead — whatever that key answers, read live. Two owners for openness: the module,
 * when it named `open`, or a flag held here. Either way what comes out is one store of accessors the
 * shell reads through `DockEntry.store`, exactly as it reads a module's own.
 */
function panelPlumbing(
  moduleId: string,
  panel: PanelContribution,
  store: ModuleStore | undefined,
  signal: ModuleStoreDeps['signal'],
): PanelControls {
  const dockId = `${moduleId}:${panel.name}`;
  const staticBid: PanelBid = typeof panel.bid === 'object' ? panel.bid : {};
  const bidKey = typeof panel.bid === 'string' ? panel.bid : undefined;
  const bid = (): PanelBid => ({
    ...DEFAULT_BID,
    ...staticBid,
    ...((call(store, bidKey) as PanelBid | undefined) ?? {}),
  });

  let isOpen: () => boolean;
  let open: () => void;
  let close: () => void;
  const hostOwned = !panel.open;
  if (panel.open) {
    const key = panel.open;
    isOpen = () => Boolean(call(store, key));
    open = () => invoke(store, panel.show, `${dockId}.show`);
    close = () => invoke(store, panel.close, `${dockId}.close`);
  } else {
    const [flag, setFlag] = signal(false);
    isOpen = flag;
    open = () => setFlag(true);
    close = () => setFlag(false);
  }

  return {
    dockId,
    moduleId,
    panel,
    hostOwned,
    isOpen,
    open,
    close,
    toggle: () => (isOpen() ? close() : open()),
    store: {
      // `null` while closed: a panel's visibility and its placement are one question, and the shell
      // reads this one key for both.
      edge: () => (isOpen() ? (bid().edge ?? 'right') : null),
      size: () => bid().size ?? 'md',
      float: () => Boolean(bid().float),
      aspect: () => bid().aspect,
      min: () => bid().min,
    },
  };
}

/** Every activity type declared by any registered module, with who declared it. */
function declaredActivities(): Map<string, { moduleId: string; shape: ActivityShape }> {
  const out = new Map<string, { moduleId: string; shape: ActivityShape }>();
  for (const { definition } of modules.values()) {
    for (const [type, shape] of Object.entries(definition.contributes?.activities ?? {})) {
      out.set(type, { moduleId: definition.manifest.id, shape });
    }
  }
  return out;
}

const isDev = (): boolean => {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
};

const activityWarned = new Set<string>();

/**
 * Check a published activity against the shape its module declared. Development only, and warns
 * once per type: the point is to catch the second module copying the first one's guesses, not to
 * refuse a heartbeat.
 */
function checkActivity(moduleId: string, activity: Activity): void {
  if (!isDev()) return;
  const declared = declaredActivities().get(activity.type);
  const warn = (message: string) => {
    const key = `${moduleId}:${activity.type}:${message}`;
    if (activityWarned.has(key)) return;
    activityWarned.add(key);
    console.warn(`module "${moduleId}" presence: ${message}`);
  };
  if (!declared) {
    warn(`publishes activity type "${activity.type}" it never declared in contributes.activities`);
    return;
  }
  for (const [field, value] of Object.entries(activity)) {
    if (field === 'type' || value === undefined) continue;
    const expected = declared.shape[field];
    if (!expected) {
      warn(`activity "${activity.type}" carries "${field}", which its declared shape does not`);
      continue;
    }
    const actual = Array.isArray(value) ? 'object' : typeof value;
    if (actual !== expected) warn(`activity "${activity.type}".${field} is a ${actual}, declared as ${expected}`);
  }
}

/**
 * The deps a module's store is built with: the host's bag, plus what only this registration knows.
 *
 * `onDispose` and `settings` are per module because the shared bag cannot say *which* module
 * registered a disposer or asked for its group. The kernels are the ones the manifest named and no
 * others — a module reaching for one it did not declare gets `undefined`, which is the cheapest
 * possible way to be told to declare it.
 */
function depsFor(
  definition: ModuleDefinition,
  storeDeps: ModuleStoreDeps,
  disposers: Array<() => void>,
): ModuleStoreDeps {
  const id = definition.manifest.id;
  const secretKeys = new Set(
    (definition.contributes?.settings ?? []).filter((s) => s.type === 'secret').map((s) => s.key),
  );
  const wanted = new Set(definition.manifest.requires?.kernels ?? []);
  const kernels: ModuleStoreDeps['kernels'] = {};
  for (const name of KERNEL_NAMES) {
    if (!wanted.has(name)) continue;
    const kernel = storeDeps.kernels[name];
    if (kernel === undefined) continue;
    (kernels as Record<string, unknown>)[name] = kernel;
  }
  // Presence publishes are checked against the declared shapes on the way through.
  if (kernels.presence) {
    const base = kernels.presence;
    kernels.presence = {
      peers: base.peers,
      clearActivity: base.clearActivity,
      setActivity: (activity) => {
        checkActivity(id, activity);
        base.setActivity(activity);
      },
    };
  }
  // One publisher at a time, and the registry is what knows who is publishing.
  if (kernels.media) {
    const base = kernels.media;
    kernels.media = {
      ...base,
      publish: (stream) => {
        notePublisher(id, stream);
        base.publish(stream);
      },
    };
  }
  // A secret is this module's own agent-level value, reached here and only here.
  if (wanted.has('secrets')) {
    kernels.secrets = {
      get: (key) => {
        if (!secretKeys.has(key)) return undefined;
        const value = readSettings(id)[key];
        return typeof value === 'string' && value ? value : undefined;
      },
    };
  }

  return {
    ...storeDeps,
    onDispose: (fn) => disposers.push(fn),
    state: markState,
    action: markAction,
    // Its own group, never the whole map — and never the secrets, which reach templates through the
    // module's own chrome if they are here.
    settings: () =>
      Object.fromEntries(Object.entries(readSettings(id)).filter(([key]) => !secretKeys.has(key))) as Record<
        string,
        boolean | string | number
      >,
    kernels,
  };
}

/** Refusals a definition earns before anything is registered. */
function definitionProblems(definition: ModuleDefinition): string[] {
  const problems: string[] = [];
  const { manifest, contributes } = definition;
  if (!manifest?.id) problems.push('manifest.id is required');
  if (!manifest?.name) problems.push('manifest.name is required');

  const seen = new Set<string>();
  for (const panel of contributes?.panels ?? []) {
    if (!panel.name) problems.push('every panel needs a name — the dock id and a remembered placement are keyed by it');
    else if (seen.has(panel.name)) problems.push(`two panels are named "${panel.name}"`);
    seen.add(panel.name);
  }
  if (
    contributes?.components &&
    Object.keys(contributes.components).length &&
    !manifest?.requires?.frameworks?.length
  ) {
    problems.push('contributes framework components without declaring requires.frameworks');
  }
  return problems;
}

export const moduleRegistry = {
  /**
   * Register a module against this host.
   *
   * Refuses loudly rather than half-mounting: a module whose declared backend, framework or kernel
   * does not match would otherwise register chrome that fails at render time, far from the cause.
   */
  register(definition: ModuleDefinition, host: ModuleHostProfile, storeDeps?: ModuleStoreDeps): RegisterResult {
    const refuse = (problems: string[]): RegisterResult => {
      console.warn(`module "${definition.manifest?.id ?? '?'}" not registered: ${problems.join('; ')}`);
      return { registered: false, problems };
    };

    const shape = definitionProblems(definition);
    if (shape.length) return refuse(shape);

    const { manifest, contributes } = definition;
    const id = manifest.id;

    // Predicates are how existing data is found, so minting one outside the module's own subtree is
    // not a bug to fix later — by the time it is noticed, data has been written under a name nobody
    // can adjudicate. Declared entities mint under the subtree by construction, so the only way a bad
    // predicate enters is an explicit override.
    const badPredicates = modulePredicateViolations(id, Object.values(contributes?.entities?.predicates ?? {}));
    if (badPredicates.length) {
      return refuse([`declares predicates outside ${modulePredicatePrefix(id)}: ${badPredicates.join(', ')}`]);
    }

    // Validated here, not when eventually compiled: `declare` runs on the first dataset switch, so a
    // malformed manifest would otherwise register fine and fail far from the module that shipped it.
    if (contributes?.entities) {
      const result = validateManifest(contributes.entities.manifest);
      if (!result.valid) {
        return refuse(result.errors.map((e) => `invalid entities manifest at ${e.path}: ${e.message}`));
      }
    }

    /*
      Declarations that are inert, reported rather than refused — a module is still worth having with
      one dud setting, and taking the whole thing out over a declaration mistake is the larger failure.
    */
    for (const setting of contributes?.settings ?? []) {
      if (setting.resolution === 'restrict' && setting.default === false) {
        console.warn(
          `module "${id}" setting "${setting.key}" is restrict and defaults to false, so no level can ever turn it on`,
        );
      }
      if (setting.type === 'enum' && !setting.options?.length) {
        console.warn(`module "${id}" setting "${setting.key}" is an enum with no options`);
      }
      if (setting.type === 'secret' && setting.levels.some((level) => level !== 'agent')) {
        console.warn(
          `module "${id}" setting "${setting.key}" is a secret offered above the agent level; only the agent level is honoured`,
        );
      }
    }
    for (const panel of contributes?.panels ?? []) {
      if (panel.open && !panel.close) {
        console.warn(
          `module "${id}" panel "${panel.name}" owns its open flag but names no close action, so the titlebar cannot dismiss it`,
        );
      }
    }
    for (const type of Object.keys(contributes?.activities ?? {})) {
      const other = declaredActivities().get(type);
      if (other && other.moduleId !== id) {
        console.warn(`module "${id}" declares activity "${type}", already declared by "${other.moduleId}"`);
      }
    }

    const compatibility = checkModuleCompatibility(definition, host);
    if (!compatibility.compatible) return refuse(compatibility.problems);

    if (modules.has(id)) {
      // Idempotent: re-registering the same id replaces rather than duplicating, so a hot reload or a
      // double-init doesn't produce two of everything.
      moduleRegistry.unregister(id);
    }

    const disposers: Array<() => void> = [];
    const store =
      storeDeps && definition.createStore
        ? definition.createStore(depsFor(definition, storeDeps, disposers))
        : undefined;
    const signal = storeDeps?.signal ?? plainSignal;

    const panels = new Map<string, PanelControls>();
    for (const panel of contributes?.panels ?? []) panels.set(panel.name, panelPlumbing(id, panel, store, signal));

    modules.set(id, { definition, store, disposers, panels });
    if (store) moduleStores[id] = store;

    const holds = contributes?.holds;
    for (const [index, slot] of (contributes?.slots ?? []).entries()) {
      slotRegistry.register({ ...slot, node: gateOnSpace(id, slot.node, holds), id: `${id}:${index}` });
    }

    /*
      Panels are registered twice on purpose, to two registries that answer different questions.
      `dockRegistry` holds the contribution so the shell can resolve its geometry and subtract it from
      the content viewport; `slotRegistry` renders the resulting frame, because once the host has
      wrapped it in a positioned box it is ordinary shell chrome. The `dock:` prefix keeps the two
      namespaces from colliding.
    */
    for (const controls of panels.values()) {
      const { panel, dockId } = controls;
      const staticBid: PanelBid = typeof panel.bid === 'object' ? panel.bid : {};
      const entry: DockEntry = {
        id: dockId,
        moduleId: id,
        name: panel.name,
        title: panel.title,
        node: panel.node,
        order: panel.order,
        edge: 'edge',
        size: 'size',
        float: 'float',
        min: 'min',
        // Only where there may be one: the titlebar offers "fit to content" whenever this is set.
        aspect: staticBid.aspect || typeof panel.bid === 'string' ? 'aspect' : undefined,
        store: controls.store,
        // The module's own close where it owns the flag; the host's where it does not. A panel that
        // owns its flag and names no close gets no button, as before.
        ...(controls.hostOwned
          ? { closeAction: { $action: 'shellStore.closeModulePanel', args: [dockId] } }
          : panel.close
            ? { close: panel.close }
            : {}),
      };
      dockRegistry.register(entry);
      slotRegistry.register({
        anchor: 'dock-right',
        order: panel.order,
        id: `dock:${dockId}`,
        node: gateOnSpace(id, dockFrame(entry, suppliedOrOwn(id, dockId, panel.name, panel.node)), holds),
      });
    }

    return { registered: true, problems: [] };
  },

  /**
   * Say what each module's settings resolve to. Returns a function that takes it back.
   */
  provideSettings(reader: (group: string) => Record<string, SettingValue>): () => void {
    readSettings = reader;
    return () => {
      if (readSettings === reader) readSettings = () => ({});
    };
  },

  /**
   * Every registered module that declares settings, as a group a screen can render. Built from what
   * is installed rather than from a list somebody maintains.
   */
  settingGroups(): SettingGroup[] {
    return [...modules.values()]
      .filter((entry) => entry.definition.contributes?.settings?.length)
      .map(({ definition }) => ({
        id: definition.manifest.id,
        label: definition.manifest.name,
        ...(definition.manifest.description ? { description: definition.manifest.description } : {}),
        settings: definition.contributes?.settings ?? [],
      }));
  },

  /**
   * Anchors contributed to that no registered module provides. Checked after the whole seed has
   * registered rather than per module, because seed order is a list, not a dependency graph.
   */
  danglingAnchors(): string[] {
    const provided = new Set([...modules.values()].flatMap(({ definition }) => definition.contributes?.anchors ?? []));
    return slotRegistry.contributedAnchors().filter((anchor) => !provided.has(anchor));
  },

  unregister(id: string): void {
    const entry = modules.get(id);
    if (!entry) return;
    const contributes = entry.definition.contributes;
    for (const index of (contributes?.slots ?? []).keys()) slotRegistry.remove(`${id}:${index}`);
    for (const { dockId } of entry.panels.values()) {
      dockRegistry.remove(dockId);
      slotRegistry.remove(`dock:${dockId}`);
    }
    // Declared entities are compiled lazily and cached, so withdrawing a module has to drop both the
    // resolvable classes and the cache — and the block types registered over them.
    for (const entityName of Object.keys(contributes?.entities?.manifest.entities ?? {})) unregisterEntity(entityName);
    for (const block of contributes?.blocks ?? []) unregisterBlock(moduleBlockNodeType(block));
    compiledEntities.delete(id);
    delete moduleStores[id];
    modules.delete(id);

    // Teardown last, after the entry is gone, in reverse order, each guarded: one throwing disposer
    // must not be able to leave the camera on for the rest of them.
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

  all(): RegisteredModule[] {
    return [...modules.values()];
  },

  // ── Panels ────────────────────────────────────────────────────────────────

  /** The host's controls for one panel, by dock id (`<moduleId>:<name>`). */
  panel(dockId: string): PanelControls | undefined {
    const at = dockId.lastIndexOf(':');
    if (at === -1) return undefined;
    return modules.get(dockId.slice(0, at))?.panels.get(dockId.slice(at + 1));
  },

  /** Every panel a module contributes, in declaration order. */
  panelsOf(moduleId: string): PanelControls[] {
    return [...(modules.get(moduleId)?.panels.values() ?? [])];
  },

  /**
   * A module's rail entries that are not a panel's — `contributes.launchers`, keyed the way the rail
   * addresses them: the plain module id for one that names no key, `<moduleId>:<key>` otherwise.
   */
  launchersOf(definition: ModuleDefinition): { key: string; launcher: ModuleLauncher }[] {
    return (definition.contributes?.launchers ?? []).map((launcher) => ({
      key: launcher.key ? `${definition.manifest.id}:${launcher.key}` : definition.manifest.id,
      launcher,
    }));
  },

  // ── Contributions, collected ──────────────────────────────────────────────

  /** Which module supplies each contributed component, by component name. */
  componentProviders(): Map<string, string> {
    const providers = new Map<string, string>();
    for (const { definition } of modules.values()) {
      for (const name of Object.keys(definition.contributes?.components ?? {}))
        providers.set(name, definition.manifest.id);
    }
    return providers;
  },

  /**
   * The modules a schema needs in order to render — the ones it declares in `meta.requires.modules`,
   * plus the ones providing the components it mounts.
   *
   * Both, because each misses what the other sees: a declaration catches every `modules.<id>.*`
   * expression and `$part`, which no walk of component types can; the walk catches a component a
   * template mounted without declaring anything. This is what makes a capability module safe to
   * switch off, and what lets a deployment omitting a module see the reason instead of a blank panel.
   */
  requiredBy(schema: SchemaNode | TemplateSchema): string[] {
    const providers = this.componentProviders();
    const required = new Set<string>();
    for (const name of collectComponentTypes(schema as SchemaNode)) {
      const moduleId = providers.get(name);
      if (moduleId) required.add(moduleId);
    }
    for (const id of (schema as TemplateSchema).meta?.requires?.modules ?? []) required.add(id);
    return [...required];
  },

  /** Components every registered module contributes, for the host's component registry. */
  components(): Record<string, unknown> {
    return Object.assign({}, ...moduleRegistry.all().map((m) => m.definition.contributes?.components ?? {}));
  },

  /** Views modules contribute, keyed by id — beside the built-in catalogue in `availableViews`. */
  views(): Record<string, TemplateSchema> {
    const out: Record<string, TemplateSchema> = {};
    for (const { definition } of modules.values()) {
      for (const view of definition.contributes?.views ?? []) {
        if (!view.id) {
          console.warn(`module "${definition.manifest.id}" contributes a view with no id; it cannot be enabled`);
          continue;
        }
        if (view.meta?.role !== 'view') {
          console.warn(`module "${definition.manifest.id}" view "${view.id}" is not marked meta.role: 'view'; skipped`);
          continue;
        }
        out[view.id] = view;
      }
    }
    return out;
  },

  /** Functions modules lend to expressions, with the module that lent each. */
  functions(): (ModuleFunction & { moduleId: string })[] {
    return moduleRegistry
      .all()
      .flatMap(({ definition }) =>
        (definition.contributes?.functions ?? []).map((fn) => ({ ...fn, moduleId: definition.manifest.id })),
      );
  },

  /** Content types modules contribute, with the module that owns each. */
  blocks(): (BlockContribution & { moduleId: string })[] {
    return moduleRegistry
      .all()
      .flatMap(({ definition }) =>
        (definition.contributes?.blocks ?? []).map((block) => ({ ...block, moduleId: definition.manifest.id })),
      );
  },

  /** Every declared presence activity, by type. */
  activities(): Record<string, { moduleId: string; shape: ActivityShape }> {
    return Object.fromEntries(declaredActivities());
  },

  /** What a person agrees to when they turn a module on. See `moduleCapabilities`. */
  capabilitiesOf(id: string): string[] {
    const entry = modules.get(id);
    return entry ? moduleCapabilities(entry.definition) : [];
  },

  /** A module's public store members — what a space template may reach, and what the catalogue documents. */
  storeSurface(id: string): ModuleStoreSurface {
    return storeSurface(modules.get(id)?.store);
  },

  /** The same, for every registered module. Read by `buildTemplateBag`. */
  storeSurfaces(): Record<string, ModuleStoreSurface> {
    const out: Record<string, ModuleStoreSurface> = {};
    for (const [id, entry] of modules) out[id] = storeSurface(entry.store);
    return out;
  },

  // ── Entities ──────────────────────────────────────────────────────────────

  /**
   * Every module-owned entity type in the form the backend installs into a **space**. Compiled
   * through the backend's own schema port, so a module needs no knowledge of which backend is running.
   */
  moduleSchemas(schemas: SchemaPort): unknown[] {
    return declaredEntities(schemas, 'space');
  },

  /**
   * The same, for entities a module declared `scope: 'agent'` — installed into the **root dataset**.
   * Separate rather than filtered by the caller: an agent-scoped entity installed into a shared space
   * would sync one person's private records to a whole community.
   */
  agentSchemas(schemas: SchemaPort): unknown[] {
    return declaredEntities(schemas, 'agent');
  },

  /**
   * Every module-declared entity as a neutral manifest entry, whatever scope it installs into — what a
   * `scope` drill-down is resolved against. Both scopes, because which dataset an entity is installed
   * into says nothing about where a query naming it runs from.
   */
  entityEntries(schemas: SchemaPort): EntityManifestEntry[] {
    return moduleRegistry.all().flatMap(({ definition }) => {
      const entities = definition.contributes?.entities;
      return entities
        ? schemas.entries(entities.manifest, { moduleId: definition.manifest.id, predicates: entities.predicates })
        : [];
    });
  },

  /** Every registered module that contributes an embedded application, in registration order. */
  embeds(): RegisteredEmbed[] {
    return moduleRegistry
      .all()
      .filter((m) => m.definition.contributes?.embed)
      .map(({ definition }) => ({
        id: definition.manifest.id,
        name: definition.manifest.name,
        icon: definition.manifest.icon ?? '',
        image: definition.contributes!.embed!.image,
        url: definition.contributes!.embed!.url,
        allow: definition.contributes!.embed!.allow,
      }));
  },

  /**
   * Named parts, keyed `<moduleId>.<name>` so two modules cannot collide. Normalised: a part written as
   * a bare node comes back as one with no subject, so a caller has one shape to handle.
   */
  parts(): Record<string, { node: SchemaNode; subject?: string }> {
    const out: Record<string, { node: SchemaNode; subject?: string }> = {};
    for (const { definition } of moduleRegistry.all()) {
      for (const [name, part] of Object.entries(definition.contributes?.parts ?? {})) {
        const normalised = 'node' in part ? (part as { node: SchemaNode; subject?: string }) : { node: part };
        out[`${definition.manifest.id}.${name}`] = normalised;
      }
    }
    return out;
  },
};
