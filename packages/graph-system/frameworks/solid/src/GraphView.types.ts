/**
 * Props for the graph view.
 *
 * Every field is JSON — this is the surface a template writes and an LLM edits, so a value that could
 * only be a function would be a value no community member can author. Interaction results come back
 * as events (`onNodeClick` and friends), which a schema binds to `$action` handlers with the payload
 * on `$event.detail`.
 *
 * The plugin contracts — expanders, layouts, renderers, behaviours, metrics — live in
 * `@we/graph-protocol` and are named here by id, never passed as objects.
 */
import type { EdgeWaypoint } from '@we/graph-core';
import type {
  BehaviourSpec,
  EdgeStyleRules,
  ExpansionSpec,
  GraphEdge,
  GraphNode,
  GraphValue,
  LayoutSpec,
  MatchClause,
  NodeStyleRules,
  SeedSpec,
} from '@we/graph-protocol';
import type { JSX } from 'solid-js';

/**
 * @ai A general-purpose graph view: knowledge maps, schema maps, hierarchies, cluster maps and
 * free-positioned canvases, all from the same engine.
 *
 * The shape of a graph is set by four independent choices: where it starts (`seeds`), how much of it
 * opens (`expansion`), how it is arranged (`layout`), and how it looks (`nodeStyle` / `edgeStyle`).
 *
 * Common recipes:
 * - **Knowledge map** — `seeds: { source: 'query', options: { entity: 'Belief' } }` with
 *   `expansion: { defaultDepth: 1 }` and `layout: { type: 'force' }`.
 * - **Schema map** — `seeds: { source: 'schema' }`, which draws the dataset's own entity types and
 *   the relations between them. Picks up model types added later with no template change.
 * - **Hierarchy** — `layout: { type: 'tree' }` with a `collection` expansion for nested content.
 * - **Static diagram** — `seeds: { literal: true, nodes: [...], edges: [...] }` and no expansion at all.
 */
export interface GraphViewProps {
  /** Where the graph starts. A literal fragment, or a named seed source with options. */
  seeds?: SeedSpec | SeedSpec[];
  /** How much opens automatically, how far a click reaches, and the node ceiling. */
  expansion?: ExpansionSpec;
  /**
   * Change this to re-run the seed queries and reconcile the result into the graph on screen.
   *
   * The graph reads its data once, when it mounts. That is right for a map you explore and wrong the
   * moment the same page can *write* — create a record in a modal and nothing appears, because
   * nothing told the graph to look again. Bumping this is that telling.
   *
   * A merge, not a reload: positions, pins, the selection, the camera and every open node survive, so
   * the new record turns up as one more node among the ones the user arranged. Rows that have gone
   * are dropped, unless an expansion is still holding them.
   *
   * Any value works — only the fact that it *changed* matters. In a template that is a `$localState`
   * number bumped with `{ $setLocal: 'revision', by: 1 }` from a create action's `onSuccess`, or a
   * boolean flipped with `$toggleLocal`; both say the same thing to the graph.
   */
  revision?: number | string | boolean;
  /**
   * Follow the data: re-read when records of the types the seeds read change. Defaults to true.
   *
   * Set `false` for a graph that must hold still under the reader — a diagram in a document, a
   * thumbnail, anything being presented or screenshotted. A graph with no query-backed seeds is
   * unaffected either way, since nothing is watched.
   */
  live?: boolean;
  /** Which layout arranges it. Defaults to `force`. */
  layout?: LayoutSpec;
  /** Ordered node style rules; later matches win per property. */
  nodeStyle?: NodeStyleRules;
  /** Ordered edge style rules. */
  edgeStyle?: EdgeStyleRules;
  /** Interactions to enable, by registered id. Defaults to pan-zoom, select and expand-on-double-click. */
  behaviours?: BehaviourSpec[];
  /**
   * Entity types that are really *edges*, keyed by name — `{ SemanticRelationship: { source, target } }`.
   *
   * Some relationships carry data and are modelled as entities; drawn naively each becomes a node, so
   * a map of tagged messages shows three times as many dots and no relationships. Declaring one here
   * collapses each instance into the edge it stands for. Defaults to the shapes AD4M's interpretation
   * work and Flux already produce; pass `{}` to switch it off.
   *
   * Read once when the graph mounts, since expanders are constructed with it.
   *
   * `sourceType`/`targetType` name properties holding each end's entity type, for a relationship
   * whose endpoints are untyped — a connection somebody drew can point at anything, so there is no
   * declared target class to read the type from.
   */
  reified?: Record<string, { source: string; target: string; type?: string; sourceType?: string; targetType?: string }>;

  width?: string;
  height?: string;
  /** Background colour — design token or CSS colour. */
  bg?: string;
  /** Show the loading/paging/warning strip. Defaults to true. */
  showStatus?: boolean;
  /**
   * What the canvas says when it has nothing on it.
   *
   * The default — "Nothing to show yet." — is the honest thing for a graph whose host has no
   * opinion, and it is the wrong thing wherever there is something to *do* about the emptiness. A
   * canvas that fills as a conversation produces records can say so; the widget cannot know that, and
   * a caller that wraps its own placeholder around the graph instead ends up with two — one over the
   * page and one over the canvas, swapping as data arrives, with different words and a different
   * background.
   *
   * An expression, like any prop, so one line can answer both cases a caller has: what to do when
   * there is no subject yet, and what to expect once there is.
   */
  empty?: string;
  /** The icon above it. Defaults to `graph`. */
  emptyIcon?: string;
  /**
   * Draw that icon in a gradient — a `we-icon` gradient name, `primary` being the one every template
   * has — rather than flat and faint.
   *
   * The distinction the design system draws everywhere else: gradient where there is something to do
   * about the emptiness, flat where there is not, so an invitation and a dead end read apart before
   * either sentence is read. A graph with no opinion from its host is a dead end by default, which is
   * why this is opt-in — but the caller that bothered to write its own `empty` is usually the caller
   * that has something to invite, and it is the only one that can tell.
   */
  emptyGradient?: string;
  /**
   * Something to press, under that sentence — the control that resolves the emptiness, where the
   * caller has one.
   *
   * A slot rather than a prop pair (`emptyActionLabel` + `emptyAction`), because what the control
   * *is* differs: a button, a pair of them, a link, a file drop. The renderer spreads a schema
   * node's `slots` onto a component's props, so a template writes
   * `slots: { emptyAction: … }` and the node arrives here already rendered.
   *
   * Inside the placeholder rather than beside the graph, which is the whole reason this exists.
   * A caller that floats its own button over the canvas has to position it against a box whose size
   * it cannot see — one that changes as panels open — so it drifts out from under the sentence it
   * belongs to. Here it is laid out by the same column, at every size, for nothing.
   *
   * Gate it yourself if the emptiness has more than one cause: the sentence above already varies,
   * and an action that suits one of them rarely suits the other.
   */
  emptyAction?: JSX.Element;
  /** Show the controls. Defaults to true. Superseded by `controls`, which names them individually. */
  showControls?: boolean;
  /**
   * Which chrome buttons to draw, by registered id — `zoom-in`, `zoom-out`, `fit`, `relayout`.
   *
   * Omit for the sensible set; pass `[]` for a graph with no chrome, which is what an embedded
   * thumbnail wants. A module contributing its own control makes it nameable here.
   */
  controls?: string[];

  /**
   * A click on a node, with its scalars flattened into a list.
   *
   * `data` is a record, and a schema has no way to iterate one — `$each` takes an array. A panel
   * that wants to show what a node actually holds needs `fields`, and deriving it here is the only
   * place it can be done at all.
   */
  onNodeClick?: (
    node: GraphNode & { recordId?: string; recordType?: string; fields: { name: string; value: string }[] },
  ) => void;
  /**
   * Ask the graph to open a node, from outside a gesture.
   *
   * Double-clicking expands a node with whatever `expansion.expanders` names, which is one question.
   * "Show me this record's own fields" and "show me what it relates to" are two, and a map that can
   * only ask one of them makes an instance something you look at rather than something you open.
   * Naming the expanders here is how a panel asks the second question of a node already open for the
   * first.
   *
   * Acts when the value *changes*, like `revision`, so it is a request rather than a state; set it
   * back to null when the selection changes, or selecting a node would re-run the last request
   * against it.
   */
  expandRequest?: { id: string; expanders?: string[]; direction?: 'in' | 'out' | 'both' } | null;
  /**
   * A double-click on a node. Requires the `node-double-click` behaviour.
   *
   * `recordId`/`recordType` are resolved out of the address, since opening a node means opening the
   * record it stands for. Absent for a node that stands for none — a property, a literal, a cluster.
   */
  onNodeDoubleClick?: (node: GraphNode & { recordId?: string; recordType?: string }) => void;
  /**
   * A click on an edge, with the record behind it resolved where there is one.
   *
   * `recordId`/`recordType` are present only for a **reified** edge — one that stands for an entity
   * rather than for a declared relation — and they are the whole reason `reifiedAs` exists: the edge
   * carries a graph address, and a template has no operator that could take one apart to fetch the
   * record and show its comments.
   */
  onEdgeClick?: (edge: GraphEdge & { recordId?: string; recordType?: string }) => void;
  /**
   * Somebody dragged one end of a connection around a node's rim, pinning the **side** it leaves or
   * arrives on. `side` is empty when they dragged it back to the middle, which clears the anchor.
   *
   * Intent, not a mutation, exactly as `onEdgeCreate` is: where a connection attaches is a fact
   * about a *view*, and only the template knows which view it is looking at. On a canvas it belongs
   * on an `EdgeRoute` parented to that canvas, so the same connection shown elsewhere is unaffected —
   * see `recordStore.anchorOnCanvas`.
   *
   * Binding this is also what makes the handles appear. Nothing draws an affordance for a gesture
   * that would end in nothing, which is the same rule the connect dots and the resize grips follow.
   */
  /**
   * Somebody dragged one end of a connection onto a **different** node, re-attaching it.
   *
   * The other half of `onEdgeAnchor`, and the same gesture: which of the two fires is decided by
   * where the drag was let go. Worth knowing that they write at different scopes — an anchor is how
   * *one view* draws the connection, and this is what the connection **is**, so it changes on every
   * canvas and for everyone. That is the right answer for "this actually goes there", but it is not
   * the same kind of edit.
   *
   * `nodeId`/`nodeType` are the new endpoint's record; `recordId`/`recordType` are the connection's,
   * where it stands for one. Intent, not a mutation, exactly as every other event here — the graph
   * has no write path and what re-attaching means is the template's to decide.
   */
  onEdgeRetarget?: (payload: {
    id: string;
    end: 'source' | 'target';
    nodeId: string;
    nodeType: string;
    recordId?: string;
    recordType?: string;
  }) => void;
  onEdgeReroute?: (payload: {
    id: string;
    /**
     * The whole list, in order, in the edge's own frame — see `EdgeWaypoint`.
     *
     * The list rather than the one that moved, because a route is one shape: written per point, two
     * people bending the same line would each overwrite half of the other's, and the shape that came
     * out would be neither of theirs. Empty means the route has been straightened.
     */
    points: EdgeWaypoint[];
    recordId?: string;
    recordType?: string;
  }) => void;
  onEdgeAnchor?: (payload: {
    id: string;
    end: 'source' | 'target';
    side: '' | 'n' | 'e' | 's' | 'w';
    recordId?: string;
    recordType?: string;
  }) => void;
  /**
   * The user dragged a line from one node to another, with the `connect-nodes` behaviour armed.
   *
   * Intent, not a mutation: the graph has no write path, and what connecting two things means
   * differs completely between a knowledge map, a canvas and an outline. A template answers by
   * creating whatever record it thinks the connection is — for WE's own knowledge map, a
   * `Relationship`, whose fields are the two ends' ids and types.
   */
  onEdgeCreate?: (payload: {
    source: GraphNode;
    target: GraphNode;
    /**
     * Each end's *record* id and entity name, parsed out of its address.
     *
     * The nodes carry graph addresses (`we-graph://entity/<dataset>/<type>/<id>`), and a template
     * has no operator that could take one apart. These are the four values writing a connection
     * actually needs, so the event answers the question it raises rather than handing over
     * something the reader then has to decode.
     */
    sourceId: string;
    sourceType: string;
    targetId: string;
    targetType: string;
    /** Each end as it is drawn on the map, so a form can name what is being connected. */
    sourceLabel: string;
    targetLabel: string;
  }) => void;
  /**
   * The user double-clicked empty canvas. Requires the `canvas-double-click` behaviour.
   *
   * Carries the world point, which is the whole of the message: on a surface where position is the
   * data, "make something here" is a request that can be acted on and "make something" is not.
   */
  onCanvasDoubleClick?: (payload: { x: number; y: number }) => void;
  onSelectionChange?: (ids: string[]) => void;
  /**
   * Fired when a drag ends, with the world position — what a canvas persists.
   *
   * `recordId` is the node's own id, parsed out of its address, since a template writing the
   * position back needs the record rather than the graph's name for it. Absent for a node that
   * stands for no record — a property, a literal, a synthetic cluster — which is also how a
   * template can tell that there is nothing to save.
   */
  onNodeDragEnd?: (payload: { id: string; x: number; y: number; recordId?: string; recordType?: string }) => void;
  /**
   * The user dragged a selected card's edge or corner, giving it this box in world units.
   *
   * Binding it is what puts the handles on screen — a handle that moved and then changed nothing is
   * worse than no handle — so a graph whose sizes are not stored anywhere simply omits it.
   *
   * **Carries a position as well as a size**, and a consumer that writes one must write both.
   * Resizing from a corner holds the *opposite* corner still, and a card is drawn from its centre,
   * so keeping one edge where it is means the centre moves. Storing only the size would slide the
   * card sideways by half the change on every resize.
   *
   * Where the box *lives* is the template's decision, the same as a position: on a canvas it belongs
   * to the placement rather than the record, so the same note can be a banner on one canvas and a
   * small square on another. `recordId` carries the record the node stands for, absent for a node
   * that stands for none.
   */
  onNodeResize?: (payload: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    recordId?: string;
    recordType?: string;
  }) => void;
  /**
   * Something from elsewhere was dropped onto the graph — a record dragged out of the Pocket, or
   * from any `we-draggable` — with the world point it landed on.
   *
   * Binding this is what makes the graph a drop target at all: it registers with the app's drag
   * session and converts the pointer to world units through its own camera, which is the one thing
   * a `we-drop-zone` wrapped around the graph could not do. Fired once per item carried. Writes
   * nothing — what a drop means is the template's decision, and on a canvas it is usually
   * `recordStore.dropOnCanvas`, which places the record where it landed.
   *
   * `dataset` is the record's home as the drag spelt it, absent for one picked up in the dataset on
   * screen. A receiver that can only draw its own dataset's records should test it.
   */
  onDrop?: (payload: {
    entity: string;
    id: string;
    dataset?: string;
    label: string;
    x: number;
    y: number;
    /** The post a dropped block sits in — see `DragItem.within`. */
    within?: { entity: string; id: string };
    /** What the source drew it with, for a receiver that cannot read the source. */
    preview?: { thumbnail?: string; author?: string; source?: string };
  }) => void;

  /**
   * Small controls that appear above a node while it is selected — a tick, a cross, a bin.
   *
   * The sibling of the resize handles, and the same bargain: only on the selection, because
   * furniture on every node would cover the content it is there to show, and selecting first is how
   * you say which node you mean anyway.
   *
   * `when` is the **same match clause the style rules take**, so the vocabulary an interface already
   * knows for deciding how a node *looks* decides what it can *do*. An action with no `when` is
   * offered on every node.
   *
   * Which means the same prefix rule: a bare key reads a node's own field (`type`, `label`), and
   * anything a **seed** put in the node's data bag is behind `data.`. "Offer this only on a card
   * nobody has agreed to yet" is `{ when: { 'data.pending': true } }`, and written without the
   * prefix it matches nothing, silently — which is what a clause does when it names a field that is
   * not there.
   *
   * Nothing here says what an action means. The graph reports that one was pressed, on which record,
   * and the interface decides — deleting, accepting a suggestion, opening something. A widget that
   * knew what a tick meant would be a widget only one template could use.
   */
  nodeActions?: NodeAction[];
  /** One of {@link nodeActions} was pressed on a node. */
  onNodeAction?: (payload: {
    action: string;
    id: string;
    recordId?: string;
    recordType?: string;
    /** What a `control` produced. Absent for a button. */
    value?: unknown;
    /** The control is still moving — show the value, do not write it yet. */
    preview?: boolean;
    /**
     * Where the node is, in world units — so an action can pin a card where it is drawn. A parked
     * card has no stored position, and accepting one should not send it somewhere else on reload.
     */
    x: number;
    y: number;
  }) => void;
  /**
   * A record the interface wants shown: selected, and brought into view if it is off screen.
   *
   * The other direction from `onNodeClick` / `onEdgeClick`. Those tell the interface what somebody
   * picked on the graph; this lets something *beside* the graph pick — an inspector listing a card's
   * connections, a link somebody sent with a record in it — and have the graph answer as though the
   * click had happened here. Without it the two disagree the moment anything but the graph chooses:
   * the panel opens a card and the canvas goes on showing nothing selected, somewhere else entirely.
   *
   * A **record id**, not a graph address, for the reason every event here resolves addresses into
   * records: a template has no operator that could build `we-graph://entity/<dataset>/<type>/<id>`,
   * and it already holds the id. It matches a node standing for that record, or — failing one — a
   * line whose `reifiedAs` is that record, so a connection can be focused as readily as a card.
   *
   * Four properties make it safe to bind straight to the same value a click writes:
   *
   * - **Idempotent.** Already selected is left alone, and the camera only moves for something outside
   *   the visible part of the canvas. Binding it to the selection a click just made therefore does
   *   nothing at all — no jump every time somebody clicks a card they can already see.
   * - **Once per value.** Applied when it changes, not on every redraw: a live graph re-reads as the
   *   data changes, and re-applying then would yank the camera back to a card somebody has since
   *   panned away from.
   * - **Patient.** A record not in the graph yet — a line written a moment ago, a canvas still
   *   loading — is looked for again as the graph fills in, and applied when it arrives.
   * - **Silent.** Selecting this way emits no `selectionChange`. The interface asked; being told back
   *   is an echo, and a harmful one: choosing a line clears the node selection, which reports an
   *   empty list, which an interface reasonably reads as "nothing selected — close the panel".
   *
   * Empty does nothing, rather than clearing the selection. Clearing is a background click's job, and
   * a focus that emptied the graph whenever its source was momentarily blank would fight it.
   *
   * A record the graph does not hold *does* clear it, once. Whatever is selected is then not what the
   * interface is showing — an inspector opening a connection's far end, which lives on another
   * canvas — and a ring left on the card somebody came from would say something false. If the record
   * arrives later it is selected then.
   *
   * "Visible" means the part of the canvas nobody is covering — `host.obscured` is subtracted — so a
   * card sitting under a floating panel counts as off screen and is brought out from under it.
   */
  focus?: string;
  /**
   * Records whose cards are **folded**: everything hanging off each of them is hidden, and the card
   * says how much.
   *
   * The reading counterpart of `expansion`, and a different question from it. Expansion is about
   * resolution — how much of the graph is fetched at all — where a fold hides part of what is
   * already here, so folding costs no query, moves nothing that stays, and unfolding puts every card
   * back exactly where it was. On a canvas, where position is the work, that distinction is the
   * whole feature: a fold has to be able to tidy the board without rearranging it.
   *
   * **Record ids, like `focus`**, and for the same reason: a template has no operator that could
   * build `we-graph://entity/<dataset>/<type>/<id>`, and it already holds the id. An id the graph
   * does not hold is ignored rather than refused, so a fold outliving a deleted card leaves the rest
   * of the fold alone.
   *
   * Which cards go away is worked out from the connections, pointing outward — see `foldGraph` in
   * `@we/graph-core`. Two consequences worth knowing, because both are deliberate:
   *
   * - **A card a second, unfolded card still points at stays.** Folding must not take something
   *   somebody else is holding, or the canvas shows a line running to nothing.
   * - **A connection that crossed the boundary comes back as one aggregate line** from the folded
   *   card, labelled with how many it stands for. A fold that quietly dropped it would be a canvas
   *   showing an isolated card where there were six related ones. Those lines carry no record, so
   *   `onEdgeClick` finds nothing behind them — they are a summary, not a claim.
   *
   * Hold this in something shareable. It is view state — what a reader is looking at rather than
   * anything about the space — so WE's canvas keeps it in the address, which makes a folded canvas
   * a thing you can send somebody and something a reload comes back to.
   */
  folded?: string[];
  /**
   * The fold control on a card was pressed — `folded` says which way.
   *
   * Binding it is what puts the control on a card at all, the same bargain `onNodeResize` and
   * `onEdgeCreate` make: a graph nobody is listening to offers no affordance that would do nothing.
   * The graph writes nothing itself — where the fold set is kept is the interface's business — so a
   * handler that does not put the id into `folded` is a button that visibly does nothing.
   *
   * Offered only where it would take something away, which the graph works out and the interface
   * cannot: a card whose only child a second parent is holding folds to nothing, and a control that
   * promised otherwise would be worse than none. `count` is how many cards the press is about to
   * hide, or — unfolding — how many it is about to bring back.
   */
  onNodeFold?: (payload: {
    id: string;
    recordId?: string;
    recordType?: string;
    /** The state being asked for, not the state it was in. */
    folded: boolean;
    count: number;
  }) => void;
  /**
   * The delete key, pressed while the graph holds focus and something is selected.
   *
   * Emits and writes nothing, like every other gesture here: what removing a thing *means* is the
   * interface's, and it differs — a canvas deletes the record, an outline unparents it, a map with
   * no write path should bind nothing at all and leave the key inert. Binding it is also what makes
   * the graph focusable in the first place, so a graph nobody wired this on does not start swallowing
   * keystrokes from whatever is around it.
   *
   * Fires only when something is selected — a press with an empty selection means nothing and has
   * nothing to report. `recordId`/`recordType` are filled **only when the selection is exactly one
   * record**: one selected node, or the selected edge, which are alternatives rather than layers (see
   * the engine's `selectEdge`). `count` says how many, so an interface can tell one from several
   * rather than guessing from an absence. Several is left unhandled deliberately — the host's delete
   * confirmation is modal and per record, so firing it N times would stack N dialogs, and a batch
   * confirmation is a thing to design rather than to fall into.
   *
   * Backspace counts as delete. On a Mac it is *the* delete key, and a canvas that answered only to
   * the one the manual calls Delete would be inoperable on half the keyboards it runs on.
   */
  onDeleteSelection?: (payload: {
    recordId?: string;
    recordType?: string;
    /** Which of the two selections this was, for an interface that treats them differently. */
    kind?: 'node' | 'edge';
    /** How many things are selected. `1` is the case the ids above are filled for. */
    count: number;
  }) => void;
  /**
   * Data-layer bindings, injected by the host's component registry rather than written in a template.
   * Templates never supply these.
   */
  host?: GraphHostBindings;
}

/** One control offered above a selected node — see {@link GraphViewProps.nodeActions}. */
export interface NodeAction {
  /** Reported back as `action` when it is pressed, or when a control changes. */
  id: string;
  /** Phosphor icon name. Required for a button; ignored for a `control`. */
  icon?: string;
  /**
   * A host-supplied control in the header instead of a button — see
   * {@link GraphHostBindings.nodeControls}. Named rather than passed, like `content`, so a template
   * stays JSON: `{ id: 'color', control: 'color', value: { from: 'data.canvasColor' } }`.
   *
   * What changes is reported through `onNodeAction` with the action's id and a `value`, and with
   * `preview: true` while a control is still moving — a slider reports as it goes, and the graph
   * itself writes nothing either way.
   */
  control?: string;
  /** The field on the node the control shows and edits — `{ from: 'data.canvasColor' }`. */
  value?: { from: string };
  /** The tooltip, and the accessible name — an icon with neither is a button nobody can identify. */
  title?: string;
  /** Offered only on nodes this matches. Omit for every node. */
  when?: MatchClause;
  /**
   * What kind of answer this is, said in colour: `positive` for the one that keeps something,
   * `danger` for the one that removes it. Omit for a control that is neither.
   *
   * One axis rather than a flag each, because they are three points on it and a pair of booleans
   * would admit a fourth that means nothing. It was `danger?: boolean`, which left the accepting
   * half of a tick-and-cross pair with no way to say so — a red cross beside a grey tick reads as
   * one real choice and one placeholder.
   */
  tone?: 'positive' | 'danger';
}

/**
 * A component the host lends the graph to draw *inside* a card.
 *
 * Receives the whole node, so it can read whatever the seed put in `data` — a serialized editor
 * state, a title, a colour. Rendered without pointer events, like everything else in the transformed
 * layer: picking is geometric and owned by the engine, and content that took clicks would put a hole
 * in the canvas wherever a card happened to be.
 */
export type NodeContent = (props: { node: GraphNode }) => JSX.Element;

/**
 * A control the host lends a node's action header — see {@link NodeAction.control}.
 *
 * Handed the node, the value the action's `value` names on it (undefined where the node carries
 * none), and the fill the node is currently drawn in as CSS, so a colour control can show what the
 * card looks like rather than a blank where nothing has been chosen. It answers through the two
 * callbacks and draws nothing outside its box: the header positions it.
 */
export type NodeControl = (props: {
  node: GraphNode;
  value: unknown;
  fill: string;
  title?: string;
  /** The control is moving — show this, write nothing. */
  onPreview: (value: unknown) => void;
  /** The control settled on this. */
  onChange: (value: unknown) => void;
}) => JSX.Element;

/** What the host lends the graph so its expanders can read data without knowing the backend. */
export interface GraphHostBindings {
  /**
   * Components a style rule may name with `content`, keyed by name.
   *
   * The seam that keeps a block renderer out of a graph package meant to be portable. A template
   * names `content: 'block'`; the host decides what drawing a block means, and a deployment with no
   * such component simply has a card that falls back to its label.
   */
  nodeContent?: Record<string, NodeContent>;
  /**
   * Controls a node action may name with `control`, keyed by name — a colour picker, a shape menu,
   * a scale slider. Lent by the host for the reason `nodeContent` is: the primitives are the
   * host's, and a graph package that named one would stop being portable.
   */
  nodeControls?: Record<string, NodeControl>;
  /**
   * Fields to lay over a node's own data, keyed by the record id the node stands for.
   *
   * The seam for **optimistic edits**, and it is here rather than in the engine because it is not
   * the graph's business how long a write takes to come back. A canvas's own gestures — resize a
   * card, colour it, change its shape — are answered by a record the host writes, and the answer
   * arrives via a subscription and a re-seed. Even a fast backend is a round trip away, and a slider
   * that lags a round trip behind the finger reads as broken rather than as slow.
   *
   * So the host says what it has just written and has not yet seen come back; the graph draws it as
   * though it had. Applied before the style rules run, so `{ from: 'data.x' }` reads it exactly as it
   * reads a seeded value and nothing else has to know the difference. The host clears an entry when
   * a read confirms it, at which point this and the seeded data agree and the change is invisible.
   *
   * Reactive: read inside the render, so a host signal here re-draws the nodes it names.
   */
  pendingData?(): Record<string, Record<string, GraphValue>>;
  /**
   * The parts of the graph's own box something else is drawn over, in screen pixels per edge.
   *
   * The graph fills the region the host gave it, and the host may float panels over that region
   * without shrinking it — so the canvas the engine believes is on screen and the canvas a reader
   * can see are different rectangles. Nothing noticed until a canvas parked its unplaced cards in
   * the top-left of the first one, which was underneath a panel: the cards were drawn, present and
   * findable by every gesture, and invisible.
   *
   * Only affects questions about what is *visible* — where to put a node nobody has placed, and
   * anything else that has to choose a spot. Panning, zooming and hit-testing are unchanged: the
   * covered pixels are still canvas.
   *
   * Reactive, read inside an effect, so a panel being dragged or resized is followed. Omitted by a
   * host with nothing over its graph, which is every host but an app shell.
   */
  obscured?(): { top: number; right: number; bottom: number; left: number };
  /**
   * These records' pending fields are now carried by the graph's own data, so the host can forget
   * them.
   *
   * Reported from the drawn node rather than judged by the host, because the host reads rows and the
   * graph draws nodes, and there is a whole seed between the two. Clearing on the read is half a
   * second early: the edit flashes to its new value, snaps back for the rest of the seed, and
   * arrives again — which is exactly the flicker optimism was added to remove.
   */
  confirmPending?(recordIds: string[]): void;
  query(request: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  /**
   * Report changes to records of a type, and return a function that stops reporting.
   *
   * Optional: a host with no change notification omits it and the graph stays as loaded. The engine
   * decides what to watch from the reads its seeds performed — nothing calls this directly.
   */
  watch?(request: { entity: string; dataset?: string }, onChange: () => void): () => void;
  /**
   * Say what happened inside a load, for whoever is debugging an empty canvas.
   *
   * Optional, and a host without a trace sink omits it. Not `warn`: a warning is for the reader and
   * appears in the status strip, where "the canvas read one row and built no nodes" is neither
   * actionable nor interesting. It is the *only* place that difference is visible, though — a seed
   * that read nothing, a seed that read rows and dropped them, and a graph whose nodes are all off
   * screen are the same blank rectangle.
   */
  trace?(event: string, detail?: Record<string, unknown>): void;
  defaultDataset(): string | null;
  models(dataset?: string): {
    name: string;
    properties: { name: string; type: 'string' | 'number' | 'boolean' | 'uri'; required?: boolean }[];
    relations: { name: string; target: string; cardinality: 'one' | 'many' }[];
    /** The property that names an instance — the host's own answer. See `EntityShape`. */
    nameProperty?: string;
    /** The dedup key, which is **not** the name. See `EntityShape.identityProperty`. */
    identityProperty?: string;
    description?: string;
  }[];
}
