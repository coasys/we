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
  EntityManifest,
  EphemeralPort,
  InterpretationProposal,
  InterpretationResult,
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
 * Whose decision a module is, and therefore where its data lives and where its chrome appears.
 *
 * See {@link ModuleDefinition.scope} for the full argument. One word rather than two flags, because
 * a module whose data is the agent's and whose chrome is the space's is a contradiction nobody
 * should be able to spell.
 */
export type ModuleScope = 'space' | 'agent';

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
   * cannot build a `modules.<id>.<key>` path to itself.
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

/**
 * A named fragment that is *about* something, and can be pointed at something else.
 *
 * The subject is named as the expression the module itself uses, so the part stays valid on its own
 * — it is the module's own working node, not a template with a hole in it — and a placer that wants
 * it over a different record says so, and the host substitutes. Without this, every part is welded
 * to the state its module happens to hold, which is the coupling that made them uncomposable in the
 * first place.
 */
export interface ModulePart {
  node: SchemaNode;
  /** The expression this part is about, e.g. `modules.transcribe.collectionId`. */
  subject?: string;
}

export interface ModuleDefinition {
  /** Stable, unique. Namespaces this module's stores (`modules.<id>.*`) and its slot ordering ties. */
  id: string;
  name: string;
  description?: string;
  icon?: string;
  version?: string;

  /**
   * Whose module this is: a **space**'s, or the **agent**'s. Omit for `'space'`.
   *
   * Everything the module system was built for so far belongs to a community. A call, a transcript,
   * a shared scratchpad: the space decides whether it is on, and the module's chrome is gated on
   * `spaceStore.activeModules` — registered ∩ installed ∩ enabled here, less what this agent muted.
   *
   * Some capabilities are not about a community at all. A panel that gathers things from *across*
   * spaces has no space to be enabled in, and the moment you leave one it would vanish taking what
   * it held with it. `'agent'` says so: the chrome is gated on being **installed** by this agent and
   * nothing else, and the launcher is in the rail wherever they are, including outside a space
   * entirely.
   *
   * It is not an escape from the gate — Settings → Modules still decides. It is the honest reading
   * of which of the two answers "should this be here": for a space module the community's, for an
   * agent module the person's.
   */
  scope?: ModuleScope;

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

  /**
   * Named schema fragments a template can place, and this module's own nodes can reference.
   *
   * A module's presentation is a **default, not a monopoly**. Its panel is usually several surfaces
   * in one — a feed, a control, a readout — and an interface that wants them arranged differently
   * could only hand-write copies, which is how one template ended up with its own transcript beside
   * the module's. Publishing the pieces lets it compose instead, and the module goes on composing
   * its own panel out of the same ones.
   *
   * Keyed `<moduleId>.<name>` by the registry, and placed as
   * `{ type: '$part', props: { id: 'transcribe.feed' } }`.
   *
   * **A part is public API.** It cannot be reshaped without breaking templates this module has never
   * heard of, so keep the set small and name each for what it *is* rather than for how it looks.
   *
   * A part written as a bare node is used as it stands. One written as {@link ModulePart} names the
   * expression that is its **subject** — the record it is about — and a placer may substitute a
   * different one, which is what makes a feed reusable over a call it was not written for.
   */
  schemas?: Record<string, SchemaNode | ModulePart>;

  /** Persistent chrome. Rendered by the host outside the router, so it survives navigation. */
  slots?: SlotContribution[];

  /**
   * A store key the host reads to decide whether this module's chrome must stay on screen even in a
   * space that has not enabled it. Omit for a module that holds nothing.
   *
   * Chrome is gated on the module being active in the space you are looking at, which is right for
   * chrome that is *about* that space. It is wrong for chrome that is about something still running:
   * a call outlives navigating away from it, so gating on the destination space took away the bar
   * while the call carried on — including the hang-up button, leaving no way to end it and no sign
   * it was happening. Nothing was broken behind the scenes, which is what made it hard to read.
   *
   * "Holding", not "enabled elsewhere": the question is whether this module has live state a person
   * needs to reach, so the module answers it rather than the host inferring it. A module that
   * declares this must make the key false the moment it stops holding anything, or its chrome
   * becomes permanent.
   */
  holdsWhen?: string;

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
    manifest: EntityManifest;
    /** Explicit predicate bindings, keyed `"Entity.property"`. */
    predicates?: Record<string, string>;
    /**
     * Which dataset these are installed into. Omit for `'space'`.
     *
     * `'agent'` installs them into the **root dataset** instead — the agent's own, private, never
     * synced. That is where a module's knowledge about *you* belongs rather than about a community:
     * what you have gathered, a saved graph layout, a preference the space has no business holding.
     *
     * Before this existed a module could own entities in a space and nowhere else, so a personal
     * capability had two options: write per-agent state into a shared neighbourhood, or not exist.
     * Pair it with {@link ModuleDefinition.scope} — a module whose data is agent-scoped almost
     * always renders that way too.
     */
    scope?: ModuleScope;
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

  /**
   * Store members a **space template** may not reach — see {@link ModuleStoreSurface}.
   *
   * Omit it and every member is reachable at both tiers, which is the historical behaviour and the
   * right default for a module whose store only touches the space on screen.
   */
  chromeOnlyStoreMembers?: readonly string[];
}

/**
 * Which of a module's store members are host-chrome's alone.
 *
 * ## The hole this closes
 *
 * `modules` is the one entry in the template bag that is not filtered per member. It cannot be:
 * `templateSurface.ts` classifies members it can *see* in a store interface it knows, and a module's
 * store is a flat record of signals, derived closures and actions that the host has never heard of.
 * So the whole namespace is handed to every tier, and the reason that was acceptable is that modules
 * are bundled — chosen by the deployment's seed, shipped with the app, at the app's own trust level.
 *
 * The Pocket is where that stopped holding. Its actions write `PocketItem` and `PocketFolder` into
 * the **agent's private root dataset**, so `modules.pocket.gather` from a synced space template is a
 * stranger's template writing into a store that has nothing to do with the space it came from —
 * the `resolvePerspective` shape again, a filtered bag around an unfiltered namespace.
 *
 * A module knows which of its members are chrome's, and nothing else does, so it says. The list is
 * subtracted from the space-tier bag and left intact at the chrome tier; a member named here is
 * *absent* below, exactly as an ungranted store member is, so a template gets no error channel.
 *
 * ## What this is not
 *
 * Not the state-vs-action split. Every member a module publishes is still tagged reactive, so a
 * `{ $: 'modules.call.leave' }` still *calls* during paint. Fixing that needs a `state()` marker in
 * `ModuleStoreDeps` and a change in every module's `createStore`; it is a real follow-up and this is
 * not it. What this is, is the scope question — which is the half that had a live consequence.
 */
export type ModuleStoreSurface = readonly string[];

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
   * How far up the bottom edge it reaches, in pixels, including its own offset from the bottom.
   *
   * The call bar's edge, and so the common one. It sits at the bottom because a panel has a titlebar
   * and no footer: chrome along the top covers the grip, the position menu and the button that
   * un-maximises — the three controls a panel is recovered with — while chrome along the bottom
   * covers nothing that is pressed.
   */
  bottom?: number;
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

  /**
   * How the current dataset is named inside a **record reference** — `n:<cid>` or `p:<uuid>`.
   *
   * The host builds it rather than the module, because only the host knows a dataset has two names
   * and which one applies: a neighbourhood is keyed by its CID, so the same string means the same
   * record to every agent who joined it, and a personal dataset falls back to a local uuid that
   * means nothing anywhere else. A module deriving this itself would get the second case wrong in
   * the direction that matters — a reference that looks shareable and is not.
   *
   * Empty while no dataset is open. See `@we/backend-shared`'s `recordRef`.
   */
  datasetRefKey?: () => string;

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
  /** Naming and reaching spaces — for a module whose state can outlive the space on screen. */
  datasets?: ModuleDatasetAccess;

  /**
   * This agent's own records, in the root dataset. See {@link AgentDataAccess}.
   *
   * The other half of `entities: { scope: 'agent' }` — declaring private entities without a way to
   * write them would be half a feature. Nothing here reaches a space.
   */
  agentData?: AgentDataAccess;

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
   * The imperative twin of the `record.create` a schema already has. A module that creates data in
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
  linkEntity?: (entity: string, id: string, relation: string, value: string, options?: DatasetTarget) => Promise<void>;
}

/**
 * Which dataset a module's write goes to.
 *
 * ## Why "the current one" is the wrong default for a module
 *
 * Every write a module made resolved to `datasetStore.currentDataset()` — the space *on screen*.
 * That is right for a module whose work is caused by the person looking at it, and it is wrong for
 * every module whose work outlives the view, which is the interesting kind. #161 made a call
 * survive navigation, and transcribe kept writing each utterance into whatever space had been
 * opened since: start a call in A with recording on, walk into B, keep talking, and every line
 * became a `TextBlock` in **B's** perspective carrying a `children` link from a record id B does
 * not hold. Peers in A stopped seeing the transcript; B accumulated orphans.
 *
 * So a module that knows where its work belongs says so, by dataset URI — the same string presence
 * anchors an activity with, which is how transcribe knows it at all. Absent still means the space on
 * screen, so nothing that never had this question changes.
 *
 * **A URI that cannot be resolved refuses the write.** Not "falls back to the current dataset":
 * falling back is the bug, and writing a call's transcript into the wrong space is worse than not
 * writing it. The host returns `null`/no-ops and logs.
 */
export interface DatasetTarget {
  /** The dataset's shared URI, as `Focus.datasetUri` carries it. Absent means the space on screen. */
  dataset?: string;
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
export interface CreateEntityOptions extends DatasetTarget {
  /**
   * The record to link this one under, named by id and predicate rather than by model class.
   *
   * The raw form of the backend's parent scope, chosen because it is expressible without importing
   * anything: a module has no access to the host's model classes, and should not.
   */
  parent?: { id: string; predicate: string };
}

/**
 * Read and write this agent's **own** records — the ones a module declared `scope: 'agent'`.
 *
 * The write surface for the root dataset, and the counterpart of `createEntity`, which writes into
 * whichever space is open. Two calls rather than one because the root dataset is where a module
 * keeps what it knows about *you*, and knowing it usually means reading it back: "have I gathered
 * this already" is a question about the agent's own collection, and it has to be answerable without
 * a space being open at all.
 *
 * Deliberately not a general ORM. No update, no relations, no includes — the same restraint
 * `createEntity` shows, and for the same reason: a module's data surface should be the smallest
 * thing that does the job, not whatever the host's ORM happens to expose. A module that needs more
 * than this from a schema already has it, through `$query` against
 * `dataset: 'datasetStore.rootDataset'`.
 *
 * Absent where the host has no agent dataset — a presentation-only host, or the frames before boot
 * finishes. A module must degrade rather than throw.
 */
export interface AgentDataAccess {
  /** Whether the agent's dataset is reachable yet. False during boot. */
  ready: () => boolean;
  /** Create a record. Returns its id, or `null` if there was nowhere to write it. */
  create: (entity: string, fields: Record<string, unknown>, options?: CreateEntityOptions) => Promise<string | null>;
  /** Read records back. The same `where`/`order`/`limit` a `$query` takes. */
  find: (
    entity: string,
    query?: { where?: Record<string, unknown>; order?: Record<string, 'asc' | 'desc'>; limit?: number },
  ) => Promise<Record<string, unknown>[]>;
  /**
   * Change the named fields of one record, leaving the rest.
   *
   * ## Why this widened a deliberately narrow surface
   *
   * The restraint above is right — a module's data surface should be the smallest thing that does
   * the job — and create/find/remove was one call short of it. The Pocket could make folders and
   * never rename one: no update, so a typo in a folder name was permanent, and the alternatives are
   * both wrong. Delete-and-recreate loses the id, and everything filed in the folder hangs off it;
   * create-a-replacement leaves the original behind.
   *
   * A rename is not a general ORM. This takes an id and a field bag, exactly as `record.update` does
   * for a schema, and is bounded by the same thing everything else here is: the agent's own dataset.
   */
  update: (entity: string, id: string, fields: Record<string, unknown>) => Promise<void>;
  /** Delete one record. Irreversible, and only ever this agent's own. */
  remove: (entity: string, id: string) => Promise<void>;
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
   * What the launcher says while `activeWhen` is true. Falls back to {@link label}.
   *
   * Most launchers need nothing here: "Notes" names a panel, and a panel is called the same thing
   * open or shut. It exists for the launcher whose two states are genuinely different acts — a call
   * button means "start a call" before there is one and "go to the call" after — where one label
   * has to be wrong half the time, and the half it is wrong in is the half where a stale tooltip
   * describes an action the button no longer performs.
   *
   * Pointless without `activeWhen`, which is the only thing that decides when it applies.
   */
  activeLabel?: string;
  /**
   * The method on this module's own store to call, named without the `modules.<id>.` prefix.
   *
   * A bare method name rather than a full `$action` path because the host invokes it: `$action` takes
   * a literal string, so a rail iterating over modules could not build one per entry.
   *
   * One method for every state the launcher has. A module whose button means different things before
   * and after something starts resolves that inside the method — see the call module's `goToCall` —
   * rather than by declaring two, because only the store can ask "which state am I in" at the moment
   * of the click.
   */
  action: string;
  /**
   * A store key the host reads to show the launcher as active.
   *
   * Usually "is my panel open", which is what makes a rail of these read as tabs. It does not have
   * to be: the call module lights on *being in a call*, because that is the fact worth carrying in
   * permanent chrome, and its panel is the lesser question. The rule is only that the key names
   * something the button is about.
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
   * Whether this community has automatic extraction switched on.
   *
   * A different question from {@link available}, and both have to be asked: `available` is what this
   * *node* can do, this is what the space has *decided*. Conflating them produced the wrong sentence
   * on screen — a space with the setting off reported that the node could not auto-extract, which is
   * neither true nor actionable.
   *
   * Reactive, and that is the point of exposing it rather than letting the host refuse the call: a
   * standing watch has to follow the setting while a call is running. Toggling it used to change
   * nothing until everybody left the call and rejoined, because the only thing that read it was a
   * throw inside `watchCollection`, and nothing re-ran that.
   */
  autoEnabled: () => boolean;
  /**
   * What this call extracts, and what else it could — one row per model, ticked when it is on.
   *
   * Here because a module cannot work it out, and should not try. Three layers decide it: the
   * codebase says which entities are candidates at all, the space says which of them its calls
   * start with, and the call's own participants add or remove from there. A module has no read
   * surface, no dataset handle, and no business knowing that a space carries models — so it is
   * handed the answer rather than the inputs.
   *
   * One list of `{ entity, selected }` rather than two, because the surface that renders it is a
   * row of toggles and a schema cannot join two lists to work out which are ticked.
   *
   * Reactive, and read on every call rather than captured: a community adopting a model makes it a
   * candidate a moment later, and a module store outlives a space switch. Empty means nothing here
   * may be extracted — an honest answer, and one to render as such rather than as a failure.
   *
   * The class list itself never reaches a module. It used to, and the module held the constant that
   * decided it — which is why a community could write careful hints for a `Sighting` and never have
   * anything extract one.
   */
  targets: (collectionId: string) => { entity: string; selected: boolean }[];
  /**
   * Add or remove one model from what this call extracts.
   *
   * A **group** decision, not this agent's: it is recorded in the space beside the call, and the
   * standing watch re-registers against it, so it changes what the whole neighbourhood extracts
   * from this conversation. That is what it has to be — the watch is one registration every peer
   * shares, and per-agent lists would have peers overwriting each other's in a loop.
   *
   * Takes effect from here on. A watch keeps a processed-turn cursor, so a model switched on
   * part-way through a call is applied to what is said *next*; the one-shot pass carries no cursor,
   * so pressing Extract is how the rest of the conversation gets swept with the new list. Worth
   * saying wherever this is offered, because it is not guessable.
   *
   * Rejects on a host that cannot record it, so a module can offer the affordance only where it
   * means something rather than silently dropping a press.
   */
  setTarget: (collectionId: string, entity: string, on: boolean) => Promise<void>;
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
  runOnCollection: (collectionId: string) => Promise<InterpretationResult>;
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
  watchCollection: (collectionId: string) => Promise<void>;
  /** Stop the watch on a collection. Safe to call when none was registered. */
  unwatchCollection: (collectionId: string) => Promise<void>;
  /**
   * Attach anything a standing pass produced but did not attach, and report how many.
   *
   * A pass can complete with nobody there to finish it — the engine mints instances and a client
   * writes the edge, and the client that would have done it may not have been running. Returns 0
   * where there was nothing to repair, including on a backend that parents its own results.
   */
  reconcileCollection: (collectionId: string) => Promise<number>;
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
  /**
   * Whether this space shares each pass's model exchange with every member.
   *
   * A space setting, read-only and reactive. It exists beside {@link activity} because a row's
   * `hasDetail` is not a proxy for it: a peer's pass has no prompt until it reaches the model, a
   * skipped pass never has one, and a row broadcast before the setting synced carries none — so a
   * module explaining "why can't I open this" must ask about the setting, not about the row.
   */
  detailShared: () => boolean;

  /**
   * Suggestions staged in a dataset, awaiting a human.
   *
   * `target` names which — the same {@link DatasetTarget} the write surface takes, and for the same
   * reason. Interpretation follows the call, and a call now outlives the space on screen, so
   * "proposals here" was answering about wherever the reader had wandered to. Absent still means the
   * space on screen.
   *
   * `collection` narrows it to what was staged on **that collection's contents**, and a review
   * surface about one conversation should always pass it. A staged suggestion outlives the pass that
   * made it: one nobody resolved an hour ago is still staged, so without this it arrives in the next
   * call's list looking like something that call just found — and accepting it commits a record
   * parented to the earlier call, where the reviewer is not looking. A module names the collection
   * and nothing else; resolving what containment means here is the host's, exactly as it is for
   * {@link runOnCollection}.
   */
  proposals: (target?: DatasetTarget, collection?: string) => Promise<InterpretationProposal[]>;
  /** Commit a staged suggestion — the whole record, or one property by name. */
  accept: (id: string, property?: string, target?: DatasetTarget) => Promise<boolean>;
  /** Drop a staged suggestion. */
  reject: (id: string, property?: string, target?: DatasetTarget) => Promise<boolean>;
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

/**
 * The slice of the host's dataset directory a module may read, plus the one thing it may do with it.
 *
 * Exists because module state stopped being confined to the space on screen. A call outlives
 * navigating away from where it started, so the module holds a space the user is no longer in — and
 * has to be able to say which one and offer the way back. Before that, "the space" was always the
 * one you were looking at and the host's own chrome could name it.
 *
 * The same reasoning as {@link ModuleIdentityAccess}, one level up: a module wanting a name and a
 * picture for a space should not be typed against a particular backend's idea of what a space is.
 *
 * `open` is deliberately not a router. A module may ask to go to a *space it can already name*,
 * which is the whole of what "return to the call" needs; it cannot construct a route, and there is
 * nothing here for building navigation of its own.
 */
export interface ModuleDatasetAccess {
  /**
   * What the host knows about the dataset with this uri, or `undefined`.
   *
   * Must read reactively, so a module reading it inside a derived value re-runs when the name or
   * picture arrives. `undefined` is ordinary — for a space whose record has not loaded yet, and for
   * one this agent has not joined.
   */
  get: (datasetUri: string) => ModuleDataset | undefined;
  /** Go to that dataset, as clicking it in the host's own navigation would. */
  open: (datasetUri: string) => void;
  /**
   * Go to whatever a **record reference** names — the space, and the record's own page within it.
   *
   * Takes the reference whole rather than its parts, because parsing one is the host's job and
   * routing to one certainly is: a module holding `we:n:<cid>/CollectionBlock/<id>` should not have
   * to know that a record's page lives at `/space/<segment>/record/<Entity>?id=<id>`, nor that the
   * segment is a CID for a shared space and a dataset id for a personal one. Restating that route
   * in a module is how it drifts — see `RECORD_ROUTE_PATH`, which exists because two readers of one
   * path had already disagreed silently.
   *
   * A reference naming only a dataset opens the space itself. A relative one (`we:./…`) resolves
   * against the space on screen. A person has no page, so nothing happens. See
   * `@we/backend-shared`'s `recordRef`.
   */
  openRef: (ref: string) => void;
  /**
   * Told when a dataset this agent held is removed, by its uri.
   *
   * ## Why a module needs to hear this
   *
   * A module whose work outlives the space on screen — a call, a transcript — holds resources that
   * belong to a *particular* dataset, and nothing else can end them. Removing a call's space used to
   * leave the call running: the `getUserMedia` tracks stayed open, the peer connections stayed up,
   * and the presence lease went on heartbeating into a perspective that no longer existed.
   *
   * A subscription rather than a state a module polls, because "gone" is an event and the absence
   * that follows it is indistinguishable from every other absence. `datasets.get(uri)` is
   * `undefined` during boot, while the list loads, and for a space this agent never joined; a module
   * tearing a call down on that would tear it down on the boot frame. Only the host knows which
   * absence is a removal.
   *
   * Returns an unsubscribe. Optional on hosts that cannot report it, in which case a module must
   * behave as it did before — which is to say, this is a repair, not a dependency.
   */
  onRemoved?: (cb: (datasetUri: string) => void) => () => void;
}

/** What a module gets to know about a dataset. */
export interface ModuleDataset {
  /** Display name, already assembled from whatever the host holds. */
  name?: string;
  /** Resolved image, ready to render — never a reference a module would have to fetch itself. */
  avatar?: string;
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
