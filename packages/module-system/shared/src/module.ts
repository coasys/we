/**
 * The feature-module contract — what a module contributes, and what a host must accept.
 *
 * A feature module is the rung above blocks: a bundle of **stateful capability** that installs into a
 * space and can be placed by a template. Templates and themes are data; elements, components and
 * widgets are stateless presentation; a feature module is the thing that holds state and talks to
 * ports. See notes/we/August-2026/feature-modules.md.
 *
 * Declared here, in the neutral package, for the same reason `dataSource.ts` is: a module must be able
 * to describe itself without importing a host, a framework, or a backend.
 *
 * ## Why framework code is optional, not assumed
 *
 * `components` is the only field that can carry framework-specific values, and it is optional. A
 * module that ships **schema fragments only** imports nothing framework-shaped — and in a fragment
 * `Column` is a registry key, not an import, so the fragment renders on any framework whose renderer
 * registers that key.
 *
 * That is not merely tidy. An externally-loaded module bundle that imports its own copy of a reactive
 * framework gets a *second runtime*, and reactivity silently stops crossing the boundary — no error,
 * just components that never update. A module with no framework imports cannot have that problem.
 * Fragments-first is what makes dynamic loading tractable later.
 */
import type { Activity, DatasetHandle, EphemeralPort, Peer } from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';

/**
 * Where persistent chrome attaches. A small fixed set on purpose: too few and modules fight for
 * position, too many and it becomes a layout system.
 */
export type SlotAnchor = 'overlay' | 'dock-left' | 'dock-right' | 'dock-bottom' | 'banner';

export interface SlotContribution {
  anchor: SlotAnchor;
  /** The chrome itself. A `SchemaNode` rather than a component so it stays inspectable and themeable,
   *  and so a deployment can white-label it. */
  node: SchemaNode;
  /**
   * Position within the anchor. Ties break deterministically on module id — without that, registration
   * order leaks into layout and chrome reshuffles for no visible reason.
   */
  order?: number;
}

/**
 * What a module asks to be allowed to do.
 *
 * **Declared, not enforced** — nothing today prevents a module calling `getUserMedia` without saying
 * so. They exist to be *displayed* at install ("this module can: use your microphone"), which is the
 * browser's model: show the request and the origin, never a computed risk score. A score derived from
 * unenforced declarations would manufacture false confidence, which is worse than no score.
 *
 * The hook that enforcement attaches to later, if a permission broker is ever built.
 */
export type ModuleCapability =
  'microphone' | 'camera' | 'screen-share' | 'notifications' | 'storage' | `network:${string}` | `slot:${SlotAnchor}`;

export interface ModuleDefinition {
  /** Stable, unique. Namespaces this module's stores (`modules.<id>.*`) and its slot ordering ties. */
  id: string;
  name: string;
  description?: string;
  icon?: string;
  version?: string;

  /** Capabilities to display at install. See {@link ModuleCapability}. */
  capabilities?: ModuleCapability[];

  /**
   * Backends this module works on. **Omit to mean backend-agnostic** — the default is the portable
   * case, so coupling is something you opt into and declare rather than something that happens
   * quietly.
   *
   * A module owning durable entities must currently declare `['ad4m']`, because there is no
   * manifest→SDNA compiler yet and its models are AD4M-decorated classes. That is the escape hatch
   * working as intended, not a defeat: it keeps entity-owning modules unblocked while making the
   * coupling visible at install.
   */
  backends?: string[];

  /**
   * Frameworks this module provides components for. **Omit to mean framework-agnostic** — true of any
   * module that ships fragments only.
   */
  frameworks?: string[];

  /**
   * Framework components to register, by the name templates and fragments reference them under.
   * Only for imperative cores that genuinely need framework code (a Cesium `Viewer`, an
   * `RTCPeerConnection`, an editor). Chrome, buttons and panels should be fragments.
   */
  components?: Record<string, unknown>;

  /** Named schema fragments a template can place, and this module's own slot nodes can reference. */
  schemas?: Record<string, SchemaNode>;

  /** Persistent chrome. Rendered by the host outside the router, so it survives navigation. */
  slots?: SlotContribution[];

  /**
   * How this module is opened, rendered by the host into one shared rail.
   *
   * Declared rather than contributed as chrome, because the first two modules to need an entry point
   * each invented their own floating button in a different corner, and a third would have made three.
   * A module knows what its launcher *means*; only the host knows where launchers go, and it is the
   * host that has to keep them from colliding.
   */
  launcher?: ModuleLauncher;

  /**
   * Durable entity types this module owns, installed by the host into the relevant dataset.
   *
   * Declarative on purpose: the *host* owns the install mechanism, so idempotency lives in one place
   * rather than being re-implemented per module. That matters here more than it sounds — WE already
   * has `cleanupSpaceSdna` as remediation for shapes that got installed twice by different agents,
   * and N modules each rolling their own install is that bug with more instances.
   *
   * Typed `unknown[]` because the shape is the backend's: on AD4M these are `@Model`-decorated
   * classes, which is why a module declaring them must also declare `backends: ['ad4m']` until a
   * manifest→SDNA compiler exists.
   */
  models?: unknown[];

  /**
   * Reactive state, exposed to templates at `modules.<id>.<key>`.
   *
   * A factory rather than a value so the host controls lifetime, and so a module can be registered
   * before the host is ready to instantiate it.
   *
   * Reactivity primitives are **injected**, not imported — the same port trick that keeps
   * `@we/schema-shared` framework-neutral (`resolveProp` taking a `memo`). A module store written
   * against `deps.signal` never imports Solid, so it cannot introduce the second-runtime hazard that
   * silently breaks reactivity across a dynamically-loaded boundary.
   */
  createStore?: (deps: ModuleStoreDeps) => Record<string, unknown>;
}

/**
 * What a host lends a module's store, so the module needn't import a framework *or* a backend.
 *
 * Every field is a neutral port already declared in this package — never a host object. That is the
 * line that keeps the bag from becoming a back door: a module receiving `EphemeralPort` can signal on
 * any backend that implements one, whereas a module receiving `adamStore` would be an AD4M module
 * wearing a neutral type.
 *
 * Everything past `signal` is optional, and a module must degrade rather than throw when a port is
 * absent — a host may legitimately have no transport (a personal space has no neighbourhood) or no
 * presence.
 */
export interface ModuleStoreDeps {
  /** Returns a `[read, write]` pair — Solid's `createSignal` shape, which every framework can supply. */
  signal: <T>(initial: T) => [() => T, (next: T) => void];

  /**
   * Re-run `fn` when anything it reads changes — `createEffect` in Solid, `watchEffect` in Vue.
   *
   * The other half of the minimal reactive kit. `signal` alone is enough for a module that only
   * *holds* state (a panel's open flag); a module that must **reconcile** against something the host
   * owns needs to observe it. The call mesh has to notice a peer joining the roster; polling for that
   * would be both laggy and a busy loop.
   */
  effect?: (fn: () => void) => void;

  /**
   * The dataset the module is currently scoped to, read reactively. `null` outside a space.
   *
   * A function rather than a value because the host re-scopes on navigation, and a module that
   * captured the dataset once would keep signalling into the space the user left.
   */
  dataset?: () => DatasetHandle | null;

  /**
   * The current dataset's **global** uri — the same value presence puts in `Focus.datasetUri`.
   *
   * Supplied separately because {@link DatasetHandle} is deliberately opaque, so a module cannot
   * derive it without peeking at backend internals. It is needed whenever a module must name the
   * dataset in something peers will compare: a call id built from a *local* handle id would differ on
   * every agent, so each would join a call only they can see.
   */
  datasetUri?: () => string | null;

  /** This agent's id in the host's identity scheme (a DID on AD4M). `null` before login. */
  selfId?: () => string | null;

  /**
   * Peer-to-peer transport for modules that coordinate between agents rather than store data.
   *
   * The same port instance the host uses for presence, so scope refcounting works and a module joins
   * the existing per-dataset subscription instead of opening a second one.
   */
  ephemeral?: EphemeralPort;

  /**
   * Presence, for modules that publish what this agent is doing or read who else is doing it.
   *
   * Narrowed to activities on purpose. A module has a legitimate need to say "I am in this call" and
   * to read the roster; it has no business setting another agent's availability or driving the
   * heartbeat, so those stay with the host.
   */
  presence?: ModulePresenceAccess;
}

/** A module's entry point in the host's module rail. */
export interface ModuleLauncher {
  /** Icon name, resolved by the host's icon set. */
  icon: string;
  /** Shown on hover, and read by assistive tech — the rail itself is icon-only. */
  label: string;
  /**
   * The method on this module's own store to call, named without the `modules.<id>.` prefix.
   *
   * A bare method name rather than a full `$action` path because the host invokes it: `$action` takes
   * a literal string, so a rail iterating over modules could not build one per entry.
   */
  action: string;
  /**
   * A store key the host reads to show the launcher as active. Optional — a module whose launcher
   * starts something (a call) rather than toggling something (a panel) has no such state.
   */
  activeWhen?: string;

  /**
   * A store key the host reads to decide whether to offer the launcher at all. Omit to always offer.
   *
   * For the case where a module is correctly enabled but cannot work *here*: calls need a
   * neighbourhood, so in a personal space there is nobody to call. Offering the button and explaining
   * the failure afterwards is worse than not offering it, because the answer never changes — it is a
   * property of the space, not a failure.
   */
  availableWhen?: string;
}

/** The slice of presence a feature module may touch. */
export interface ModulePresenceAccess {
  /** Peers in the current dataset, liveness-derived. */
  peers: () => Peer[];
  /** Publish an activity of this agent's own. */
  setActivity: (activity: Activity) => void;
  clearActivity: (type: string, id?: string) => void;
}

/** Identity function that exists for inference and for a greppable declaration site. */
export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}

export interface ModuleCompatibility {
  compatible: boolean;
  /** Human-readable reasons this module cannot run here, for the install prompt. */
  problems: string[];
}

/**
 * Check a module against what this host actually is. Mirrors `planQuery` / `planEphemeral`: refuse
 * loudly at registration rather than half-mounting something that cannot work.
 */
export function checkModuleCompatibility(
  definition: ModuleDefinition,
  host: { backend: string; framework: string },
): ModuleCompatibility {
  const problems: string[] = [];

  // Omitted means agnostic — the portable case is the default.
  if (definition.backends?.length && !definition.backends.includes(host.backend)) {
    problems.push(`needs backend ${definition.backends.join(' or ')}, but this host runs ${host.backend}`);
  }
  if (definition.frameworks?.length && !definition.frameworks.includes(host.framework)) {
    problems.push(`needs framework ${definition.frameworks.join(' or ')}, but this host runs ${host.framework}`);
  }

  return { compatible: problems.length === 0, problems };
}
