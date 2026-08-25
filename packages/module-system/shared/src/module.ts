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
import type {
  Activity,
  DatasetHandle,
  EphemeralPort,
  InterpretationProposal,
  InterpretationResult,
  ModelManifest,
  Peer,
  TranscriptionPort,
} from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';

/**
 * Where the *host* lets chrome attach. A small fixed set on purpose: too few and modules fight for
 * position, too many and it becomes a layout system.
 */
export type CoreSlotAnchor = 'overlay' | 'dock-left' | 'dock-right' | 'dock-bottom' | 'banner';

/**
 * Where chrome attaches — a host anchor, or one a module opened up with {@link ModuleDefinition.anchors}.
 *
 * The open half exists because the fixed set answers "where on screen" and some chrome needs to
 * answer "inside what". A transcribe toggle belongs in the call's control bar, beside mute and
 * camera, and no screen-edge anchor can express that — the bar moves, appears conditionally, and is
 * owned by another module.
 *
 * The alternative was for the call module to name the transcribe module in its own bar, which is the
 * coupling the whole contract exists to avoid: uninstall one and the other renders a button wired to
 * nothing. With an anchor, neither module knows the other, and a third (reactions, recording) joins
 * the same bar without either of them changing.
 *
 * `(string & {})` rather than `string` so editors still complete the core names.
 */
export type SlotAnchor = CoreSlotAnchor | (string & {});

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
 * Which edge a dock occupies, or `null` for "not docked right now".
 *
 * The null is what makes this one store key rather than two: a dock's visibility and its position
 * are the same question, and splitting them lets them disagree.
 */
export type DockEdge = 'left' | 'right' | 'top' | 'bottom' | null;

/**
 * How much room a dock asks for, named rather than measured.
 *
 * A module knows how much of the screen its panel *deserves*; only the host knows how much there
 * is. A module publishing pixels would have to read the viewport, which is the host's business —
 * and on a narrow window those pixels would be wrong in a way the module could not detect. Four
 * names, resolved by the host against the current viewport and the edge being docked to.
 */
export type DockSize = 'sm' | 'md' | 'lg' | 'full';

/**
 * The shape a panel's content wants, for the host to solve a height from.
 *
 * A bare ratio is not enough, and the missing term is visible: the call stage pads itself by 12px and
 * puts 12px between tiles, so solving `height = width / ratio` gave a box a little too short for its
 * own pictures — which the tiles then answered by shrinking to fit the height and leaving a gap down
 * each side. The fit looked wrong in the axis it had not been asked about.
 *
 * So the ratio describes the *pictures*, and the insets are the fixed pixels around them — padding,
 * and the gaps between rows and columns, which are fixed once the tile count is known. The host
 * solves `(width - insetX) / ratio + insetY`, then adds its own titlebar. Everything in the sum is a
 * constant at a given moment, which is what keeps this a value rather than a callback.
 */
export interface DockAspect {
  /** Width ÷ height of the content itself, ignoring anything around it. */
  ratio: number;
  /** Fixed horizontal pixels around the content: padding, and gaps between columns. */
  insetX?: number;
  /** Fixed vertical pixels: padding, and gaps between rows. */
  insetY?: number;
}

/**
 * A panel that takes room from the app rather than covering it.
 *
 * The distinction that earns a second kind of contribution alongside {@link SlotContribution}: a
 * slot is chrome that *overlays* — it positions itself, and whatever is beneath carries on
 * underneath. A dock **insets**: the host shrinks the content viewport by the dock's size, so
 * nothing is hidden and the two can be used at once.
 *
 * Which one a piece of chrome wants is not a property of the module, it is a property of the
 * moment. A call's control bar overlays, because you glance at it; a call's video stage docks,
 * because you watch it while reading the space. So a module contributes both, and moves its own
 * state between them.
 *
 * ### Why the geometry is the host's
 *
 * A docked module used to position itself with `position: fixed` and a hardcoded offset for the
 * module rail — which meant every module re-derived geometry it cannot see, and none of them could
 * inset the content because the content viewport is not theirs to resize. Here the module says how
 * it would like to open, and the host owns everything after that: where it lands, what it has to
 * clear, what the viewport becomes, and what happens when the window is too narrow to give anything
 * up.
 *
 * "After that" now includes moving and resizing it. Every panel gets a grip, eight snap targets and
 * a toggle for taking room, from the frame the host wraps it in — so a module that wants its panel
 * somewhere else does not implement dragging, and a user who moves one keeps it moved across every
 * module that has one. The call module's six-placement menu is what this replaced; it was the third
 * piece of geometry a module had written for itself, and the first that other modules would have had
 * to copy.
 */
export interface DockContribution {
  /**
   * A key on this module's own store returning {@link DockEdge}: where the panel would *like* to
   * open, and `null` while it is closed.
   *
   * An opening bid, not a position. The user drags a panel where they want it and the host remembers
   * — so this decides where it appears the first time and nothing after that. The `null` is the part
   * that keeps mattering: a panel's visibility and its placement are the same question, and splitting
   * them into two keys lets them disagree.
   *
   * A store key rather than a value because both halves of that change while the app runs. Named
   * like {@link ModuleLauncher.action} is, and for the same reason — the host reads it, and a module
   * cannot build a `$store` path to itself.
   */
  edge: string;
  /**
   * A key on this module's store returning {@link DockSize}. Omit for `'md'`.
   *
   * Also an opening bid, with one exception: `'full'` is a live state rather than a starting size,
   * and a panel returning it covers the content region for as long as it does. That is a statement
   * about the module's own moment — "watch this" — which is why it stays here while position and
   * size did not.
   */
  size?: string;
  /**
   * A key on this module's store returning `true` while the panel should **overlay** rather than
   * take room.
   *
   * The bid for how it opens. Whether a panel goes on to displace content is the user's, through a
   * toggle the host puts on the panel itself — offered on the four edge-centre snaps, where pushing
   * content aside has a coherent meaning, and refused in a corner, where it would carve out a column
   * and leave most of it empty.
   *
   * It exists as a flag rather than two contributions because it must be the *same* container:
   * moving a panel between two nodes remounts its subtree, and a subtree containing live video loses
   * its streams when that happens. One box that changes shape, never two boxes.
   *
   * The host also forces this on when the window is too narrow to give anything up.
   */
  float?: string;
  /**
   * A key on this module's store returning the shape its **content** wants: see {@link DockAspect}.
   *
   * Optional, and only worth publishing where the panel's contents have a shape of their own. A video
   * stage does: its tiles are 16:9 and they pack into a grid, so for any given width there is exactly
   * one height at which no band of empty panel is left above or below the picture. A notes panel does
   * not — text reflows, and any height is as correct as any other.
   *
   * Where it exists, the host offers "Fit to content" on the panel's own menu and solves for the
   * height, keeping the width the user chose. Resizing by hand always overshoots slightly, and
   * without this there is no way to feel your way back to exactly right.
   */
  aspect?: string;
  /**
   * A key on this module's store naming the action that closes the panel — the host puts a close
   * button on its titlebar, at the end, after the position menu.
   *
   * Optional only because a panel might genuinely have no way to be dismissed. Declare it wherever
   * there is one: every panel drew its own close button inside its own content before this existed,
   * so each was in a slightly different place, at a slightly different size, and the video stage —
   * whose content is a grid of tiles with nowhere to put a header — had none at all. The titlebar is
   * where the rest of a panel's controls already are, and the host owns it, so declaring the action
   * is the whole of a module's part in this.
   *
   * Closing is not the same as being placed. The host will not call this itself: where a panel sits
   * is the host's, whether it is open is the module's, and the button is the one place those meet.
   */
  close?: string;
  /** The panel itself. A `SchemaNode`, so a deployment can restyle or white-label it. */
  node: SchemaNode;
  /** Ties break on module id, exactly as {@link SlotContribution.order} does. */
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
  | 'microphone'
  | 'camera'
  | 'screen-share'
  | 'notifications'
  | 'storage'
  | `network:${string}`
  | `slot:${SlotAnchor}`
  /**
   * Contributes a panel that takes room from the app rather than drawing over it.
   *
   * A stronger claim than `slot:*` and worth saying separately: a slot draws on top of what you were
   * doing, a dock makes the rest of the app smaller. No edge in the name — which edge is the user's
   * choice at runtime, so naming one here would be a declaration that goes stale the first time they
   * move it.
   */
  | 'dock'
  /**
   * Access to a slice of the agent's data layer, for a module that reaches it directly rather than
   * through the ports — in practice an embedded application, which talks to the host's agent itself.
   *
   * Added when embedded apps folded into the module contract, which surfaced that the two had been
   * describing capabilities in different vocabularies: the seed said `perspectives` / `languages` /
   * `agents`, modules said `microphone` / `storage`. One list, because the point of the list is to be
   * shown to a person at install, and a person reading two vocabularies has to learn both.
   */
  | `data:${string}`;

/**
 * Map a seed entry's capability list onto {@link ModuleCapability}.
 *
 * `filesystem` and `network` already had module equivalents under different names; the data-layer
 * ones become `data:*`. Anything unrecognised passes through as `data:<name>` rather than being
 * dropped — silently discarding a declared capability would understate what the user is agreeing to,
 * which is the one failure mode this list must not have.
 */
export function seedCapabilityToModule(capability: string): ModuleCapability {
  if (capability === 'filesystem') return 'storage';
  if (capability === 'network') return 'network:*';
  return `data:${capability}`;
}

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
   * Panels that take room from the app rather than covering it. See {@link DockContribution}.
   *
   * Separate from `slots` because the host does something different with them: a slot is spliced
   * into the shell and positions itself, a dock is given a box and its size is subtracted from the
   * content viewport.
   */
  docks?: DockContribution[];

  /**
   * Anchor names this module opens up for others to contribute to.
   *
   * Declared rather than implied by use, for the same reason a missing module is reported rather
   * than skipped: a contribution to an anchor nobody provides renders nowhere, and a typo would
   * otherwise be indistinguishable from a module that is simply switched off. The registry says so
   * at registration instead.
   *
   * The module marks where they land with `{ type: '$slot', props: { anchor: '<name>' } }` inside its
   * own chrome. Prefix them with the module id — `call-controls`, not `controls` — since the
   * namespace is shared.
   */
  anchors?: string[];

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
   *
   * **Predicates must be minted under `we://module/<id>/`** — see
   * {@link modulePredicateViolations}, which the registry runs at registration.
   */
  models?: unknown[];

  /**
   * Entity types this module owns, **declared** rather than written against a backend.
   *
   * This is what `models` should have been. A manifest states what the entity *is* — its scalar
   * properties, its typed relations, which of them hold files — and each backend compiles that
   * into whatever it installs. A module declaring entities this way imports no backend SDK, so it
   * does not declare `backends` either: it runs wherever the host does.
   *
   * Predicates are minted for you under `we://module/<id>/<property>`, with core vocabulary
   * (`we://name`, `we://title`, …) reused where the property name matches. `predicates` overrides
   * an individual binding — necessary when adopting a manifest for entities that already have
   * data written under a different name.
   */
  entities?: {
    manifest: ModelManifest;
    /** Explicit predicate bindings, keyed `"Entity.property"`. */
    predicates?: Record<string, string>;
  };

  /**
   * A whole application embedded in an iframe, rather than components and fragments.
   *
   * This is what an "embedded app" is once you stop treating it as a separate concept: a module
   * whose entire contribution is a URL and a set of iframe permissions. It used to have its own
   * registry, its own seed section, its own activation path and its own launcher wiring — four
   * parallel mechanisms for something that differs from a module only in what it contributes.
   *
   * Folding it in means an embedded app gets the rest of the module contract for free: `backends`
   * gates one that needs a specific data layer to reach the host's agent, `Space.enabledModules`
   * turns it on per community, and refusal surfaces as `problems` at registration rather than as a
   * blank iframe and a timeout.
   */
  embed?: ModuleEmbed;

  /**
   * The key on this module's store that returns the audio it is capturing, as `MediaStream | null`.
   *
   * Declared rather than wired, for the same reason `launcher` is: the call module knows it has a
   * microphone open, and only the host knows who else might want to hear it. Module stores have no
   * channel to each other by design, and opening one so a transcriber could reach into a call would
   * be a worse answer than routing through the host.
   *
   * One producer is expected. If two ever declare it, the host takes the first and says so.
   */
  audioSource?: string;

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
 * Fixed chrome a module has on screen right now, for the host to route panels and other chrome
 * around — published as `chromeReserve` on the module's store.
 *
 * Read by name off the store rather than declared on the definition, because the answer changes with
 * the module's own state: the call bar exists during a call and not otherwise, and reserving its band
 * permanently is what the host used to do with a constant.
 *
 * ## The frame of reference
 *
 * A reserve describes a box **centred on the content region, against the top edge** — which is what
 * the module chrome the host places there actually is. Heights at an edge *sum*, because contributions
 * to one anchor are stacked in a column; widths take the largest, because they are stacked rather than
 * laid side by side.
 *
 * Report the height a module's chrome has when **collapsed**, not its live one. Chrome that grows as
 * somebody opens a disclosure would otherwise shove a floating panel down the screen mid-read, which
 * is worse than an overlap the person who caused it can see.
 */
export interface ChromeReserve {
  /** How far down the top edge it reaches, in pixels, including its own offset from the top. */
  top?: number;
  /**
   * How wide it is at its widest, in pixels.
   *
   * What lets the host tell "the module rail has slid left far enough to hit the call bar" from "the
   * rail is nowhere near it". Without a width the two could only ever be assumed to collide or
   * assumed not to, and both were wrong in an arrangement somebody reaches within a minute: a rail
   * that always dropped moved for chrome a thousand pixels away, and one that never dropped ended up
   * printed across the call controls.
   *
   * Estimate generously. The cost of over-reporting is chrome that moves slightly earlier than it had
   * to; the cost of under-reporting is two pieces of chrome on top of each other.
   */
  width?: number;
}

/**
 * What a host lends a module's store, so the module needn't import a framework *or* a backend.
 *
 * Every field is a neutral port already declared in this package — never a host object. That is the
 * line that keeps the bag from becoming a back door: a module receiving `EphemeralPort` can signal on
 * any backend that implements one, whereas a module receiving a backend store would be a backend-coupled module
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
   * Register teardown for this module's store. Run when the module is unregistered, in reverse
   * order, each guarded so one failure cannot strand the rest.
   *
   * The contract had no teardown at all, and the consequence was not abstract: uninstalling — or
   * merely re-registering, which a hot reload does — the call module during a call dropped the only
   * reference to live `RTCPeerConnection`s and a `getUserMedia` stream, with nothing left able to
   * close them. **The camera light stayed on.** Transcribe had the same shape over an `AudioContext`
   * and a backend stream.
   *
   * Registered through the deps bag rather than returned as a `destroy` key on the store, and that
   * placement is the whole design. A module's store keys are exposed to templates at
   * `modules.<id>.<key>` — so a `destroy` on the store would be template-callable vocabulary, and
   * any rendered schema could tear a running call down. Teardown is host business; the host is who
   * lends this.
   *
   * Optional, like everything past `signal`: a host that never unregisters need not supply it, and a
   * module holding nothing that needs closing need not call it.
   */
  onDispose?: (fn: () => void) => void;

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

  /**
   * Who an agent id belongs to — the same directory the `$agent` block reads.
   *
   * Presence deliberately carries `agentId` and nothing else: a roster that also cached profiles
   * would re-fetch every peer's on every heartbeat, which is the mistake it was written to avoid. So
   * the join to a name and a picture happens here instead, at the point of display.
   *
   * `get` reads reactively and returns nothing for an id the host has not cached; `fetch` asks it to,
   * and the read updates on its own when it arrives. A module must therefore render something for an
   * unknown agent rather than waiting — a generated avatar from the id is the usual answer, and stays
   * the answer on a host with no directory at all.
   */
  identities?: ModuleIdentityAccess;

  /**
   * Speech to text, for a module that listens. Absent when the backend cannot transcribe.
   *
   * A module must degrade rather than throw: no port means no transcription model is reachable, and
   * saying so is more use than failing.
   */
  transcription?: TranscriptionPort;

  /**
   * Turning what was said into typed records. Absent when the backend cannot interpret.
   *
   * The companion to {@link transcription} and degraded on the same terms — a module that offers
   * extraction should hide or disable the affordance rather than fail when the port is missing,
   * because "this node has no LLM" is a true and useful sentence and a thrown error is not.
   *
   * Scoped to the dataset by the host, so a module never handles a dataset handle: every call here
   * applies to the space the module is running in.
   */
  interpretation?: ModuleInterpretationAccess;

  /**
   * Audio the host is currently capturing, or `null` when nothing is.
   *
   * The stream itself, deliberately, rather than a copy: a module that transcribes a call must hear
   * exactly what the call is sending, so that muting the microphone stops the transcript too. A
   * second `getUserMedia` would keep listening through a mute, which is the kind of surprise that
   * makes a feature untrustworthy.
   *
   * Published by whichever module declares {@link ModuleDefinition.audioSource}; the host routes it
   * so the two never reference each other.
   */
  audioInput?: () => MediaStream | null;

  /**
   * Write a record into the current dataset.
   *
   * The imperative twin of the `model.create` a schema already has. A module that creates data in
   * response to a click does not need this — the schema action is better, and notes deliberately
   * ships no CRUD wrapper because of it. This is for data that arrives without a click: a transcript
   * appears because somebody spoke, and there is no event to hang a schema action on.
   *
   * Returns the new record's id, or `null` if there was nowhere to write it.
   */
  createEntity?: (
    entity: string,
    fields: Record<string, unknown>,
    options?: CreateEntityOptions,
  ) => Promise<string | null>;

  /**
   * Add one value to a to-many relation on a record that already exists.
   *
   * Deliberately **add-one**, not update-the-array. Appending by writing the whole list back is a
   * read-modify-write, and two agents doing it concurrently lose each other's entry — the same
   * last-write-wins hazard that rules out a shared `editorState`. Adding a single link is
   * conflict-free by construction, which is what makes a call's participant list safe to build from
   * several agents at once with no coordination.
   *
   * There is deliberately no general `update` here yet. When one arrives it will need an answer for
   * concurrent writers, and this covers the add-only cases without pretending to have one.
   */
  linkEntity?: (entity: string, id: string, relation: string, value: string) => Promise<void>;
}

/**
 * Where a newly created record should be attached, and nothing else.
 *
 * Narrow on purpose. The write surface a module gets is one call, and widening it to a general
 * options bag would let a module reach whatever the host's ORM happens to expose. Attaching to a
 * parent is the one thing a module genuinely cannot express otherwise: a transcript block is
 * meaningless outside the call that contains it, and creating it unparented — then linking it in a
 * second step — leaves a window where a crash orphans the block into the space.
 */
export interface CreateEntityOptions {
  /**
   * The record to link this one under, named by id and predicate rather than by model class.
   *
   * The raw form of the backend's parent scope, chosen because it is expressible without importing
   * anything: a module has no access to the host's model classes, and should not.
   */
  parent?: { id: string; predicate: string };
}

/** An application embedded in an iframe — see {@link ModuleDefinition.embed}. */
export interface ModuleEmbed {
  /** Fully-resolved iframe URL. The host resolves it from the seed at boot, since only it knows the platform. */
  url: string;
  /**
   * The iframe `allow` attribute, derived from `capabilities`.
   *
   * Derived rather than authored so a module cannot declare "microphone" at install and then quietly
   * grant itself more at mount — the string the user consented to and the string the browser enforces
   * come from the same source.
   */
  allow: string;
  /** Optional avatar for the launcher, when an icon name isn't enough. */
  image?: string;
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

/**
 * The slice of interpretation a module may reach, with the dataset already bound.
 *
 * Narrowed the same way {@link ModulePresenceAccess} is: the host knows which space the module is
 * running in, so a module that had to pass a dataset handle could only get it wrong. What is left is
 * the two things a feature actually does — run a pass, and resolve what a pass proposed.
 *
 * `watch` is deliberately absent. A standing watch is a *dataset-level* registration that outlives
 * the module instance that made it and coordinates across peers; handing that to a module store
 * whose lifetime is a panel being open invites a watch per mount. It belongs to the host, whenever
 * something needs it.
 */
export interface ModuleInterpretationAccess {
  /** Whether interpretation can run at all — false when the backend has no model configured. */
  available: () => boolean;
  /**
   * Interpret a collection's children, attaching what is created back onto that same collection.
   *
   * Takes an id rather than the turns themselves, and that follows from the contract rather than
   * from taste: `createEntity`/`linkEntity` are a module's entire data surface and there is no read,
   * so a module can write utterances into a call and cannot read them back out. The host gathers
   * them — which is also where the knowledge belongs, since assembling turns means knowing how a WE
   * collection is laid out, and that is exactly the backend detail modules are kept away from.
   *
   * Rejects when there is no usable model, so a caller can tell "no LLM here" from "nothing worth
   * extracting was said" — the two are identical from an empty result and only one is worth saying.
   */
  runOnCollection: (collectionId: string, request: { classes: string[] }) => Promise<InterpretationResult>;
  /**
   * Keep interpreting a collection as it grows, without anyone pressing anything.
   *
   * The standing counterpart to {@link runOnCollection}, and it does **not** contradict the note
   * above about `watch` being absent: a module names a collection worth watching and holds nothing.
   * The watch id, the dataset, the containment predicate and the lifetime are all the host's, which
   * is what keeps a panel closing from leaving a registration behind.
   *
   * Registering twice for one collection is one registration, not two — the engine keeps its
   * processors in the perspective's own graph, so peers converge on the same row.
   *
   * Rejects on a backend that can interpret but cannot coordinate a shared watch, so a module can
   * offer the affordance only where it means something.
   */
  watchCollection: (collectionId: string, request: { classes: string[] }) => Promise<void>;
  /** Stop the watch on a collection. Safe to call when none was registered. */
  unwatchCollection: (collectionId: string) => Promise<void>;
  /**
   * Attach anything a standing pass produced but did not attach, and report how many.
   *
   * A pass can complete with nobody there to finish it — the engine mints instances and a client
   * writes the edge, and the client that would have done it may not have been running. Returns 0
   * where there was nothing to repair, including on a backend that parents its own results.
   */
  reconcileCollection: (collectionId: string, request: { classes: string[] }) => Promise<number>;
  /**
   * What extraction is doing in this space right now — this agent's passes and its peers'.
   *
   * Read-only and reactive, like {@link ModuleIdentityAccess.get}: a module reading it inside a
   * derived value re-runs as phases arrive. Empty is the ordinary case, and means "nothing is
   * running" rather than "not supported" — a backend that cannot report progress and a quiet
   * afternoon look the same from here, and neither is worth a module branching on.
   *
   * A module may read this and cannot start, stop or subscribe to anything. Same rule as `watch`
   * being absent from this interface: the feed follows the dataset and outlives the panel that
   * started a pass, so its lifetime is the host's. What a module has is a place to render it.
   */
  activity: () => InterpretationActivitySummary[];

  /** Suggestions staged in this dataset, awaiting a human. */
  proposals: () => Promise<InterpretationProposal[]>;
  /** Commit a staged suggestion — the whole record, or one property by name. */
  accept: (id: string, property?: string) => Promise<boolean>;
  /** Drop a staged suggestion. */
  reject: (id: string, property?: string) => Promise<boolean>;
}

/**
 * One running or finished extraction pass, as a module sees it.
 *
 * Every field is a string or a boolean because the consumer is a schema, which has no arithmetic
 * and no date formatting — the host computes `label` and `elapsed` for the same reason
 * `runtimeStore.aiModels` carries its own `statusText`.
 *
 * Deliberately not the host's own view type. A module contract that named an app-shell type would
 * couple every module to the shell's internals; this is the subset a module can act on, which is
 * also all of it that means anything outside the shell.
 */
export interface InterpretationActivitySummary {
  passId: string;
  /** The runner's agent id, or `''` when the backend could only say somebody is working. Pair it
   *  with {@link ModuleIdentityAccess} for a face. */
  runner: string;
  /** Their display name, never blank — this is a sentence subject, so it falls back to "Someone". */
  name: string;
  avatar: string;
  /** Whether this agent is running the pass. Only a pass of this agent's can carry `prompt` or
   *  `response`, so this is what a UI checks before offering to show them. */
  mine: boolean;
  /** True while the pass is in flight. */
  running: boolean;
  /** A whole clause: "Anna is waiting on the model", "Extracted 3 records". */
  label: string;
  /** `m:ss` since the pass started, empty once it has settled. */
  elapsed: string;
  /** When it settled, ISO-8601, for a relative reading beside the result. Empty while running. */
  finishedAt: string;
  /** Why, for a pass that skipped or failed. Empty otherwise. */
  detail: string;
  prompt: string;
  response: string;
  /** Whether there is anything behind a disclosure — so a UI can disable the control with a reason
   *  rather than opening an empty panel. */
  hasDetail: boolean;
  /**
   * Whether the row should offer to open. `hasDetail`, and either settled or running long enough
   * that somebody would want to look inside — a pass that finishes in two seconds offers nothing a
   * person can act on, and its detail is on the settled row a moment later anyway.
   */
  openable: boolean;
}

/**
 * The slice of the host's identity directory a module may read.
 *
 * Read-only, and deliberately not `AgentProfileSummary`: what a host knows about an agent is the
 * host's business, and a module wanting a picture and a name should not be typed against a
 * particular backend's idea of a person. The fields below are the ones every directory has.
 */
export interface ModuleIdentityAccess {
  /**
   * The profile the host has cached for this id, or `undefined`.
   *
   * Must read reactively, so a module reading it inside a derived value re-runs when a profile
   * arrives. Returning `undefined` is the ordinary case for a peer whose profile has not been
   * fetched yet — never an error.
   */
  get: (agentId: string) => ModuleIdentity | undefined;
  /** Ask the host to fetch a profile it has not cached. Safe to call repeatedly. */
  fetch: (agentId: string) => void;
}

/** What a module gets to know about an agent. */
export interface ModuleIdentity {
  /** Display name, already assembled from whatever name fields the host holds. */
  name?: string;
  /** Resolved image, ready to render — never a reference a module would have to fetch itself. */
  avatar?: string;
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
/** The subtree a module may mint predicates in. */
export function modulePredicatePrefix(moduleId: string): string {
  return `we://module/${moduleId}/`;
}

/**
 * Predicates a module declares that it is not entitled to mint.
 *
 * The rule: **mint only under `we://module/<id>/`, but reuse the core vocabulary freely.** A module's
 * entity using `we://name` is shared vocabulary working as intended — generic UI that displays names
 * then works on it for free. Minting a *new* flat `we://<word>` is what has no adjudicator, and a
 * flat namespace with no adjudicator becomes a squatting machine the moment modules are installable
 * from a marketplace.
 *
 * Distinguishing "reuse" from "mint" without a registry of core names is not possible in general, so
 * this checks the tractable half: anything under `we://module/` must be under *this* module's
 * subtree, and any other scheme (`module://`, `myapp://`) is refused outright. That catches the two
 * mistakes that actually happen — copying another module's predicates, and inventing a scheme —
 * while leaving core-vocabulary reuse alone.
 *
 * Worth enforcing rather than documenting because predicates are how existing data is found: a
 * mistake here is not a bug you fix later, it silently orphans everything already written.
 *
 * Backend-shaped, so it takes the predicates rather than the models — only the adapter that
 * understands a model class can extract them.
 */
export function modulePredicateViolations(moduleId: string, predicates: readonly string[]): string[] {
  const mine = modulePredicatePrefix(moduleId);
  return predicates.filter((p) => {
    if (p.startsWith(mine)) return false;
    if (p.startsWith('we://module/')) return true; // another module's subtree
    return !p.startsWith('we://'); // a scheme of its own
  });
}

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
