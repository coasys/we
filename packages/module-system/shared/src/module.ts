/**
 * The feature-module contract — what a module is, what it contributes, and what a host lends it.
 *
 * A feature module is the rung above blocks: a bundle of **stateful capability** that installs into a
 * space and can be placed by a template. Templates and themes are data; elements and components are
 * stateless presentation; a module is the thing that holds state and talks to the host's kernels.
 *
 * ## Three things, named as three
 *
 * A module definition is a {@link ModuleManifest} (who it is, what it needs — data, shown at install
 * and compared at registration), a set of {@link ModuleContributions} (what it puts in front of a
 * person — data the host fans out to its registries), and an optional `createStore` (the one piece
 * that is code). They have different lifetimes, different readers and different trust levels, and the
 * distribution ladder in `docs/internal/plans/module-marketplace.md` already draws exactly this line:
 * the first two are data, the third is code. The contract used to hold all three in one flat
 * interface grown a field per bug, and the shape here is what that interface was trying to be.
 *
 * ## Why framework code is optional, not assumed
 *
 * `contributes.components` is the only field that can carry framework-specific values, and it is
 * optional. A module that ships fragments only imports nothing framework-shaped — in a fragment
 * `Column` is a registry key, not an import, so the fragment renders on any framework whose renderer
 * registers that key. An externally-loaded bundle that imports its own copy of a reactive framework
 * gets a *second runtime*, and reactivity silently stops crossing the boundary; a module with no
 * framework imports cannot have that problem. Fragments-first is what makes loading tractable later.
 *
 * ## The host owns everything a module cannot see
 *
 * Where a panel lands, whether it is open, what the viewport is, which space is on screen, who a
 * peer is. A module *bids* and *declares*; the host resolves. That is not tidiness — every one of
 * those was once a number a module hardcoded and nothing kept in step.
 *
 * Declared in the neutral package so a module can describe itself without importing a host, a
 * framework or a backend.
 */
import type { DatasetHandle, EntityManifest } from '@we/backend-shared';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

import type { KernelName, ModuleKernels } from './kernels';
import type { ModuleStore } from './store';

// ── Where chrome attaches ───────────────────────────────────────────────────

/**
 * Where the *host* lets chrome attach. A small fixed set on purpose: too few and modules fight for
 * position, too many and it becomes a layout system.
 */
export type CoreSlotAnchor = 'overlay' | 'dock-left' | 'dock-right' | 'dock-bottom' | 'banner';

/**
 * Whose decision a module is, and therefore where its data lives and where its chrome appears.
 *
 * One word rather than two flags, because a module whose data is the agent's and whose chrome is the
 * space's is a contradiction nobody should be able to spell. See {@link ModuleManifest.scope}.
 */
export type ModuleScope = 'space' | 'agent';

/**
 * Where chrome attaches — a host anchor, or one a module opened up with `contributes.anchors`.
 *
 * The open half exists because the fixed set answers "where on screen" and some chrome needs to
 * answer "inside what". A transcribe toggle belongs in the call's control bar, beside mute and camera.
 * With an anchor neither module knows the other, and a third joins the same bar without either
 * changing. `(string & {})` rather than `string` so editors still complete the core names.
 */
export type SlotAnchor = CoreSlotAnchor | (string & {});

/** Chrome that **overlays**: it positions itself and whatever is beneath carries on underneath. */
export interface SlotContribution {
  anchor: SlotAnchor;
  /** A `SchemaNode` rather than a component so it stays inspectable and themeable, and a deployment can white-label it. */
  node: SchemaNode;
  /** Position within the anchor. Ties break on module id, so registration order cannot leak into layout. */
  order?: number;
}

// ── Panels ──────────────────────────────────────────────────────────────────

/** Which edge a panel occupies, or `null` for "not docked right now". */
export type DockEdge = 'left' | 'right' | 'top' | 'bottom' | null;

/**
 * How much room a panel asks for, named rather than measured. A module knows how much of the screen
 * its panel *deserves*; only the host knows how much there is.
 */
export type DockSize = 'sm' | 'md' | 'lg' | 'full';

/**
 * The shape a panel's content wants, for the host to solve a height from — the ratio of the pictures
 * and the fixed pixels around them. The host solves `(width - insetX) / ratio + insetY`.
 */
export interface DockAspect {
  ratio: number;
  insetX?: number;
  insetY?: number;
}

/** The smallest box a panel's content is usable in, in pixels. A floor, never a size. */
export interface DockMin {
  width?: number;
  height?: number;
}

/**
 * What a panel asks for when it opens.
 *
 * An opening bid, not a position. The user drags a panel where they want it and the host remembers —
 * so this decides where it appears the first time and nothing after that. `'full'` is the one
 * exception: a live state rather than a starting size, and a panel bidding it covers the content for
 * as long as it does.
 */
export interface PanelBid {
  edge?: Exclude<DockEdge, null>;
  size?: DockSize;
  /** Overlay rather than take room. The host forces this on when the window is too narrow to give anything up. */
  float?: boolean;
  aspect?: DockAspect;
  min?: DockMin;
}

/**
 * A panel — a surface the host places, frames, moves and remembers.
 *
 * ## One object, not seven keys
 *
 * A dock used to be seven string keys into the module's store (`edge`, `size`, `float`, `aspect`,
 * `min`, `open`, `close`) beside a separate `launcher` with five more, and the notes module's whole
 * store existed to answer them. A panel is one object: what it is called, what it shows, how it would
 * like to open, and — only where the module genuinely owns it — which store key says whether it is up.
 *
 * ## The host owns openness by default
 *
 * Whether a panel is open is the host's unless the module says otherwise. The rail toggles it, a
 * template's `meta.panels` opens it, the titlebar closes it, and the module never sees the flag.
 * That is the right owner for nearly every panel: a notes panel being open is a fact about the screen,
 * not about notes. A module for which it *is* a fact about itself — the call's stage, up while there
 * is a call to watch — names an {@link PanelContribution.open} key, and then owns closing it too.
 *
 * ## A distinction that stays
 *
 * A panel **insets**: the host shrinks the content viewport by its size, so nothing is hidden and the
 * two can be used at once. A {@link SlotContribution} **overlays**. Which one a piece of chrome wants
 * is a property of the moment — a call's control bar overlays, its video stage is a panel.
 */
export interface PanelContribution {
  /**
   * Stable, and required. The dock id is `<moduleId>:<name>`, a placement is remembered against it,
   * and a template's `meta.panels` entry names it to place or supply this panel rather than another.
   * Required rather than defaulting to an index, because an index renumbers when a panel is added
   * before it and throws away wherever anybody had dragged the rest.
   */
  name: string;
  /** What the titlebar and the rail call it. */
  title: string;
  /** The panel itself. A `SchemaNode`, so a deployment can restyle or white-label it. */
  node: SchemaNode;
  /**
   * The rail button that opens it. Omit `icon` for a panel opened some other way — from another
   * panel, from a template — and no button is drawn.
   */
  icon?: string;
  /** The rail's tooltip. Defaults to `title`. */
  label?: string;
  /** What the tooltip says while the panel is open, where "Notes" would be wrong half the time. */
  activeLabel?: string;
  /** A store key: the module is working in the background — a pass running — so the rail shows it. */
  busyWhen?: string;
  /** A store key: whether to offer the button here at all. Calls need a neighbourhood. */
  availableWhen?: string;
  /**
   * How it would like to open. A static bid, or a store key returning a {@link PanelBid} when the
   * bid is state — a stage that wants `'full'` while somebody is sharing a screen. Omit for
   * `{ edge: 'right', size: 'md' }`.
   */
  bid?: PanelBid | string;
  /**
   * A store key returning `boolean`: whether the panel is up, **when that is the module's own
   * state**. Omit and the host holds it. Declaring it means declaring `close` too, or the titlebar
   * has no way to dismiss the panel.
   */
  open?: string;
  /** A store key naming the action that opens the panel. Only with `open`. */
  show?: string;
  /** A store key naming the action that closes it. Only with `open`. */
  close?: string;
  /** Ties break on module id, exactly as {@link SlotContribution.order} does. */
  order?: number;
}

// ── What a module may ask for ───────────────────────────────────────────────

/**
 * A browser or network capability a module reaches past the kernels.
 *
 * **Declared, not enforced** — nothing prevents a module calling `getUserMedia` without saying so.
 * They exist to be shown at install and in Settings → Modules, which is the browser's model: show the
 * request and the origin, never a computed risk score. `data:*` is what an embedded application
 * declares about the slice of the agent's data layer it reaches directly.
 */
export type ModulePermission =
  'microphone' | 'camera' | 'screen-share' | 'notifications' | `network:${string}` | `data:${string}`;

/**
 * Map a seed entry's capability list onto {@link ModulePermission}. Anything unrecognised passes
 * through as `data:<name>` rather than being dropped — silently discarding a declared capability
 * would understate what the user is agreeing to.
 */
export function seedCapabilityToModule(capability: string): ModulePermission {
  if (capability === 'filesystem') return 'data:filesystem';
  if (capability === 'network') return 'network:*';
  return `data:${capability}`;
}

/** What a module needs from the host it runs on. Every list omitted means "anything". */
export interface ModuleRequirements {
  /**
   * Backends this module works on. Omit for backend-agnostic, which is the portable case and the
   * default — coupling is opted into and declared rather than happening quietly.
   */
  backends?: string[];
  /** Frameworks its `components` are written for. Omit for a module that ships fragments only. */
  frameworks?: string[];
  /**
   * Kernels it reaches through `deps.kernels`. Refused at registration, with a sentence, on a host
   * that implements none of a named kernel; the kernels that depend on the backend still answer
   * `available()` at runtime. A kernel not named here is absent from the bag.
   */
  kernels?: KernelName[];
  /** Browser and network capabilities, for the install screen. */
  permissions?: ModulePermission[];
}

/**
 * Who a module is. Data: shown at install, listed in settings, compared at registration.
 */
export interface ModuleManifest {
  /** Stable, unique. Namespaces this module's store (`modules.<id>.*`), its parts and its predicates. */
  id: string;
  name: string;
  description?: string;
  icon?: string;
  version?: string;
  /**
   * Whose module this is: a **space**'s, or the **agent**'s. Omit for `'space'`.
   *
   * A space module's chrome is gated on the community having it on; an agent module's on the person
   * having it installed, wherever they are, including outside a space entirely. Pair `'agent'` with
   * `entities: { scope: 'agent' }` — a module whose data is the agent's almost always renders that way.
   */
  scope?: ModuleScope;
  requires?: ModuleRequirements;
}

// ── What a module contributes ───────────────────────────────────────────────

/**
 * A named fragment that is *about* something, and can be pointed at something else.
 *
 * The subject is named as the expression the module itself uses, so the part stays valid on its own,
 * and a placer that wants it over a different record says so and the host substitutes.
 */
export interface ModulePart {
  node: SchemaNode;
  /** The expression this part is about, e.g. `modules.transcribe.collectionId`. */
  subject?: string;
}

/**
 * A launcher that is not a panel's — an entry in the rail whose press does something other than open
 * one panel. The call's is the case: "start a call" before there is one, "go to the call" after.
 *
 * A panel's own rail button is derived from the panel, so most modules declare none of these.
 */
export interface ModuleLauncher {
  /** Which launcher this is, for a module with more than one. The rail addresses `<moduleId>:<key>`. */
  key?: string;
  icon: string;
  label: string;
  /** What the launcher says while `activeWhen` is true. */
  activeLabel?: string;
  /**
   * The store action to call, named without the `modules.<id>.` prefix. One action for every state:
   * only the store can ask "which state am I in" at the moment of the click.
   */
  action: string;
  /** A store key the host reads to show the launcher as active. */
  activeWhen?: string;
  /** A store key: the module is working in the background. */
  busyWhen?: string;
  /** A store key: whether to offer the launcher at all here. */
  availableWhen?: string;
}

/** Where a settings value may be decided, least to most specific — the order they resolve in. */
export type SettingLevel = 'deployment' | 'agent' | 'space' | 'agent-in-space';

/**
 * How several levels combine. `override`: the most specific wins. `restrict`: an AND across every
 * level that has spoken — for the ones a lower level must not be able to undo, like recording.
 */
export type SettingResolution = 'override' | 'restrict';

/**
 * One thing a capability lets a space or an agent decide.
 *
 * A module declares the question and reads the answer through `deps.settings()`; who is allowed to
 * answer it, and how the control looks, are the host's. **Not availability** — whether a module runs
 * here is four booleans that intersect; a setting is a *value*, and values resolve by specificity.
 */
export interface ModuleSetting {
  /** Stable, and namespaced by its group — `recordCalls`, not `transcribe.recordCalls`. */
  key: string;
  label: string;
  description?: string;
  /**
   * `secret` is a string a template must never see: offered at the `agent` level only, rendered as a
   * password field, read through the `secrets` kernel rather than `deps.settings()`.
   */
  type: 'boolean' | 'string' | 'number' | 'enum' | 'secret';
  /** Required for `enum`, ignored otherwise. */
  options?: readonly { label: string; value: string }[];
  /** What it is when nothing has an opinion. */
  default: boolean | string | number;
  /** Which levels may decide it, and so which screens offer a control. */
  levels: readonly SettingLevel[];
  /** Defaults to `override`. */
  resolution?: SettingResolution;
}

/**
 * Fixed chrome a module has on screen right now, for the host to route panels around — published on
 * the store under the key `contributes.reserve` names. Report the height when **collapsed**.
 */
export interface ChromeReserve {
  top?: number;
  bottom?: number;
  /** How wide at its widest. Estimate generously: over-reporting moves chrome slightly early, under-reporting overlaps it. */
  width?: number;
}

/**
 * The fields a presence activity of one type carries, by name and coarse type.
 *
 * Presence activities were typed by convention — the call published `record` and `continued` on a
 * `'call'` activity, transcribe read them, and the only type that admitted either was the escape
 * hatch. The second module to cooperate with the call would have copied its guesses. A declaration is
 * what the presence kernel checks published activities against in development, and what the
 * catalogue lists for the next author.
 */
export type ActivityShape = Record<string, 'string' | 'number' | 'boolean' | 'object'>;

/**
 * A content type this module adds to the composer and the renderer.
 *
 * The entity is one the module declares in `entities`; `card` names a part that draws one record of
 * it, written against `block.<field>`; `input` optionally names a framework component the composer
 * edits it with. Without an input the block renders everywhere and is inserted through the record
 * form rather than edited in place — the honest limit of a declaration.
 */
export interface BlockContribution {
  entity: string;
  /** The `_type` a composed block of this kind carries. Defaults to the entity name in lower case. */
  nodeType?: string;
  /** The part that draws it, by name. Reads the record as `block`. */
  card: string;
  /** A component from `contributes.components` that edits it. */
  input?: string;
}

/**
 * A function a module lends to expressions, catalogued beside the host's own — the same shape as a
 * host source. Pure and total: wrong-typed input answers with the empty value of its kind.
 */
export interface ModuleFunction {
  /** The name a template calls. */
  name: string;
  /** Parameter names, in the library's notation — `?` for optional. */
  params: readonly string[];
  /** One sentence for the generated context. */
  doc: string;
  /** A call as an expression would write it. */
  example: string;
  fn: (...args: never[]) => unknown;
}

/** An application embedded in an iframe — see {@link ModuleContributions.embed}. */
export interface ModuleEmbed {
  /** Fully-resolved iframe URL. The host resolves it from the seed at boot. */
  url: string;
  /** The iframe `allow` attribute, derived from the declared permissions so consent and enforcement share a source. */
  allow: string;
  /** Optional avatar for the launcher. */
  image?: string;
}

/** Entity types this module owns, declared rather than written against a backend. */
export interface ModuleEntities {
  manifest: EntityManifest;
  /** Explicit predicate bindings, keyed `"Entity.property"` — for adopting data written under another name. */
  predicates?: Record<string, string>;
  /**
   * Which dataset these install into. Omit for `'space'`. `'agent'` installs them into the agent's
   * personal space — theirs alone, never shared with a community — reached through the `agentData`
   * kernel. Not the root: that is the app's configuration, and the host writes it itself.
   */
  scope?: ModuleScope;
}

/**
 * What a module puts in front of a person. Data: the host fans every field out to a registry that
 * already exists, and nothing here runs.
 */
export interface ModuleContributions {
  /**
   * Durable entity types. Predicates are minted under `we://module/<id>/<property>`, with core
   * vocabulary reused where the property name matches; the registry refuses anything minted outside
   * that subtree, because a predicate mistake silently orphans data rather than failing.
   */
  entities?: ModuleEntities;
  /**
   * Named fragments a template can place with `{ type: '$part', props: { id: '<moduleId>.<name>' } }`,
   * and this module's own nodes can compose. **A part is public API** — keep the set small and name
   * each for what it *is*.
   */
  parts?: Record<string, SchemaNode | ModulePart>;
  /** Surfaces the host places. See {@link PanelContribution}. */
  panels?: PanelContribution[];
  /** Persistent overlay chrome, rendered outside the router so it survives navigation. */
  slots?: SlotContribution[];
  /**
   * Anchor names this module opens for others to contribute to, marked in its own chrome with
   * `{ type: '$slot', props: { anchor } }`. Prefix them with the module id — the namespace is shared.
   */
  anchors?: string[];
  /** Rail entries that are not a panel's. See {@link ModuleLauncher}. */
  launchers?: ModuleLauncher[];
  /**
   * A store key: keep this module's chrome on screen in a space that has not enabled it, while true.
   *
   * Chrome is gated on the module being active in the space on screen, which is right for chrome
   * *about* that space and wrong for chrome about something still running: a call outlives navigating
   * away from it, and gating its bar on the destination space took away the hang-up button while the
   * call carried on. A module declaring this must make the key false the moment it stops holding
   * anything, or its chrome becomes permanent.
   */
  holds?: string;
  /** A store key returning {@link ChromeReserve}: fixed chrome floating panels must clear. */
  reserve?: string;
  /** What this module lets a space or an agent decide. See {@link ModuleSetting}. */
  settings?: readonly ModuleSetting[];
  /** The presence activities this module publishes, by type. See {@link ActivityShape}. */
  activities?: Record<string, ActivityShape>;
  /** Content types. See {@link BlockContribution}. */
  blocks?: BlockContribution[];
  /**
   * Sections a space may enable — `TemplateSchema`s with `meta.role: 'view'`. Catalogued beside the
   * built-in views and gated by `Space.enabledViews` exactly as they are. A module still cannot
   * change the address space: a view is separately enabled per space, and a shell that routes itself
   * ignores it.
   */
  views?: TemplateSchema[];
  /** Functions lent to expressions. See {@link ModuleFunction}. */
  functions?: ModuleFunction[];
  /**
   * Framework components, by the name templates reference them under. Only for imperative cores that
   * genuinely need framework code — a Cesium viewer, a graph canvas. Declaring any means declaring
   * `requires.frameworks`.
   */
  components?: Record<string, unknown>;
  /**
   * A whole application in an iframe. An embedded app is a module whose entire contribution is a URL
   * and a set of permissions, and it gets the rest of the contract for free.
   */
  embed?: ModuleEmbed;
}

// ── The definition ──────────────────────────────────────────────────────────

export interface ModuleDefinition {
  manifest: ModuleManifest;
  contributes?: ModuleContributions;
  /**
   * The one piece that is code. A factory rather than a value so the host controls lifetime; called
   * once, at registration, with reactivity **injected** — a store written against `deps.signal` never
   * imports a framework. Members are private to the module's own chrome unless marked with
   * `deps.state` or `deps.action` — see `store.ts`.
   *
   * Omit it for a module whose declaration is the whole of it. The notes module is one.
   */
  createStore?: (deps: ModuleStoreDeps) => ModuleStore;
}

/**
 * What a host hands a module package's `createModule` factory.
 *
 * Framework components a module *contributes* but must not *import* — the globe's Cesium viewer is a
 * Solid component the host owns, and the module package importing it would make the module Solid.
 */
export interface ModuleHost {
  components: Record<string, unknown>;
}

/** Identity function that exists for inference and for a greppable declaration site. */
export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}

// ── What a host lends a store ───────────────────────────────────────────────

/**
 * Which dataset a module's write or read goes to.
 *
 * Absent means the space on screen. Named, it is resolved by the host — and **a URI that cannot be
 * resolved refuses rather than falling back**: writing a call's transcript into whichever space the
 * reader has wandered to is worse than not writing it.
 */
export interface DatasetTarget {
  /** The dataset's shared URI, as `Focus.datasetUri` carries it. */
  dataset?: string;
}

/** Where a newly created record should be attached, and nothing else. */
export interface CreateEntityOptions extends DatasetTarget {
  /** The record to link this one under, by id and predicate. Creating it parented leaves no window where a crash orphans it. */
  parent?: { id: string; predicate: string };
}

/** The slice of the host's identity directory a module may read. */
export interface ModuleIdentityAccess {
  /** The profile the host has cached for this id, or `undefined`. Reads reactively. */
  get: (agentId: string) => ModuleIdentity | undefined;
  /** Ask the host to fetch a profile it has not cached. Safe to call repeatedly. */
  fetch: (agentId: string) => void;
}

/** What a module gets to know about an agent. */
export interface ModuleIdentity {
  name?: string;
  avatar?: string;
}

/**
 * Naming and reaching spaces — for a module whose state can outlive the space on screen.
 *
 * `open` is deliberately not a router: a module may ask to go to a space it can already name, and
 * nothing here builds navigation of its own.
 */
export interface ModuleDatasetAccess {
  /** What the host knows about the dataset with this uri, or `undefined`. Reads reactively. */
  get: (datasetUri: string) => ModuleDataset | undefined;
  /** Go to that dataset, as clicking it in the host's own navigation would. */
  open: (datasetUri: string) => void;
  /** Go to whatever a **record reference** names — the space, and the record's page within it. */
  openRef: (ref: string) => void;
  /**
   * Told when a dataset this agent held is removed. A subscription rather than polled state, because
   * "gone" is an event and the absence that follows it looks like every other absence. Returns an
   * unsubscribe.
   */
  onRemoved?: (cb: (datasetUri: string) => void) => () => void;
}

/** What a module gets to know about a dataset. */
export interface ModuleDataset {
  name?: string;
  avatar?: string;
}

/**
 * What a host lends a module's store.
 *
 * Every field is a neutral type — never a host object. Everything past `signal`, `state` and `action`
 * is optional, and a module must degrade rather than throw when something is absent: a host may
 * legitimately have no transport, no presence, no dataset open.
 *
 * The kernels are under one key and only the ones the manifest asked for are present. That is what
 * turns "this module reaches presence" from something a reviewer infers into something a manifest
 * says and an install screen shows.
 */
export interface ModuleStoreDeps {
  /** Returns a `[read, write]` pair — Solid's `createSignal` shape, which every framework can supply. */
  signal: <T>(initial: T) => [() => T, (next: T) => void];
  /** Re-run `fn` when anything it reads changes — `createEffect` in Solid, `watchEffect` in Vue. */
  effect?: (fn: () => void) => void;
  /**
   * Register teardown for this module's store. Run when the module is unregistered, in reverse order,
   * each guarded. Through the deps bag rather than as a `destroy` key on the store, because a store
   * key would be template-callable vocabulary, and any rendered schema could tear a running call down.
   */
  onDispose?: (fn: () => void) => void;
  /** Publish a store member as readable state. See `store.ts`. */
  state: <T>(accessor: T, doc: string) => T extends (...args: never[]) => unknown ? T : () => T;
  /** Publish a store member as a callable action. See `store.ts`. */
  action: <T extends (...args: never[]) => unknown>(fn: T, doc: string) => T;

  /** The dataset the module is currently scoped to, read reactively. `null` outside a space. */
  dataset?: () => DatasetHandle | null;
  /** The current dataset's **global** uri — what presence puts in `Focus.datasetUri`. */
  datasetUri?: () => string | null;
  /** How the current dataset is named inside a record reference — `n:<cid>` or `p:<uuid>`. Empty while none is open. */
  datasetRefKey?: () => string;
  /** This agent's id in the host's identity scheme. `null` before login. */
  selfId?: () => string | null;
  /** The call record the address names, when the interface on screen is about one. `null` otherwise. */
  callOnScreen?: () => string | null;
  /**
   * This module's own settings, resolved for where the agent is right now and defaulted where nobody
   * spoke. Reactive. Secret-typed settings are absent here — read them through the `secrets` kernel.
   */
  settings?: () => Record<string, boolean | string | number>;
  /** Say something to the person, outside this module's own surfaces. Three tones and a sentence. */
  notify?: (tone: 'success' | 'warning' | 'error', message: string) => void;
  /** Who an agent id belongs to. */
  identities?: ModuleIdentityAccess;
  /** Naming and reaching spaces. */
  datasets?: ModuleDatasetAccess;

  /** The kernels this module declared, and no others. See `kernels.ts`. */
  kernels: Partial<ModuleKernels>;
}

// ── Derived facts about a definition ────────────────────────────────────────

/**
 * What a person is agreeing to when they turn a module on — derived, never authored.
 *
 * The contract used to carry a free `capabilities` list that six modules wrote and nothing read.
 * Deriving it from what the manifest requires and what the module contributes means it cannot be
 * left stale, and it is what Settings → Modules and an install screen display.
 */
export function moduleCapabilities(definition: ModuleDefinition): string[] {
  const { manifest, contributes } = definition;
  const out = new Set<string>();
  for (const permission of manifest.requires?.permissions ?? []) out.add(permission);
  for (const kernel of manifest.requires?.kernels ?? []) out.add(`kernel:${kernel}`);
  if (contributes?.entities) out.add(contributes.entities.scope === 'agent' ? 'storage:agent' : 'storage:space');
  if (contributes?.panels?.length) out.add('dock');
  for (const slot of contributes?.slots ?? []) out.add(`slot:${slot.anchor}`);
  if (contributes?.embed) out.add('embed');
  if (contributes?.components && Object.keys(contributes.components).length) out.add('components');
  return [...out];
}

/** What this host is, for {@link checkModuleCompatibility}. */
export interface ModuleHostProfile {
  backend: string;
  framework: string;
  /** The kernels this host implements. Omit to mean all of them — the permissive default a test wants. */
  kernels?: readonly string[];
}

export interface ModuleCompatibility {
  compatible: boolean;
  /** Human-readable reasons this module cannot run here, for the install prompt. */
  problems: string[];
}

/**
 * Check a module against what this host actually is. Refuse loudly at registration rather than
 * half-mounting something that cannot work.
 */
export function checkModuleCompatibility(definition: ModuleDefinition, host: ModuleHostProfile): ModuleCompatibility {
  const problems: string[] = [];
  const requires = definition.manifest.requires ?? {};

  if (requires.backends?.length && !requires.backends.includes(host.backend)) {
    problems.push(`needs backend ${requires.backends.join(' or ')}, but this host runs ${host.backend}`);
  }
  if (requires.frameworks?.length && !requires.frameworks.includes(host.framework)) {
    problems.push(`needs framework ${requires.frameworks.join(' or ')}, but this host runs ${host.framework}`);
  }
  if (host.kernels) {
    const missing = (requires.kernels ?? []).filter((kernel) => !host.kernels!.includes(kernel));
    if (missing.length)
      problems.push(
        `needs kernel${missing.length > 1 ? 's' : ''} ${missing.join(', ')}, which this host does not implement`,
      );
  }

  return { compatible: problems.length === 0, problems };
}

// ── Predicates ──────────────────────────────────────────────────────────────

/** The subtree a module may mint predicates in. */
export function modulePredicatePrefix(moduleId: string): string {
  return `we://module/${moduleId}/`;
}

/**
 * Predicates a module declares that it is not entitled to mint.
 *
 * The rule: **mint only under `we://module/<id>/`, but reuse the core vocabulary freely.** A module's
 * entity using `we://name` is shared vocabulary working as intended. Minting a *new* flat `we://<word>`
 * has no adjudicator, and a flat namespace with no adjudicator becomes a squatting machine the moment
 * modules install from anywhere. This checks the tractable half: anything under `we://module/` must be
 * under *this* module's subtree, and any other scheme is refused outright.
 */
export function modulePredicateViolations(moduleId: string, predicates: readonly string[]): string[] {
  const mine = modulePredicatePrefix(moduleId);
  return predicates.filter((p) => {
    if (p.startsWith(mine)) return false;
    if (p.startsWith('we://module/')) return true; // another module's subtree
    return !p.startsWith('we://'); // a scheme of its own
  });
}
