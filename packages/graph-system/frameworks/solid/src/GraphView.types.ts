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
 * free-positioned boards, all from the same engine.
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
   * board that fills as a conversation produces records can say so; the widget cannot know that, and
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
  onNodeClick?: (node: GraphNode & { recordId?: string; fields: { name: string; value: string }[] }) => void;
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
   * The user dragged a line from one node to another, with the `connect-nodes` behaviour armed.
   *
   * Intent, not a mutation: the graph has no write path, and what connecting two things means
   * differs completely between a knowledge map, a board and an outline. A template answers by
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
   * Fired when a drag ends, with the world position — what a board persists.
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
   * Where the box *lives* is the template's decision, the same as a position: on a board it belongs
   * to the placement rather than the record, so the same note can be a banner on one board and a
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
  onNodeAction?: (payload: { action: string; id: string; recordId?: string; recordType?: string }) => void;
  /**
   * Data-layer bindings, injected by the host's component registry rather than written in a template.
   * Templates never supply these.
   */
  host?: GraphHostBindings;
}

/** One control offered above a selected node — see {@link GraphViewProps.nodeActions}. */
export interface NodeAction {
  /** Reported back as `action` when it is pressed. */
  id: string;
  /** Phosphor icon name. */
  icon: string;
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
   * Fields to lay over a node's own data, keyed by the record id the node stands for.
   *
   * The seam for **optimistic edits**, and it is here rather than in the engine because it is not
   * the graph's business how long a write takes to come back. A board's own gestures — resize a
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
   * can see are different rectangles. Nothing noticed until a board parked its unplaced cards in
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
   * appears in the status strip, where "the board read one row and built no nodes" is neither
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
    identityProperty?: string;
    description?: string;
  }[];
}
