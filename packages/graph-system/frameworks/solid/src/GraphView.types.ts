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
  LayoutSpec,
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
   * The user dragged a selected card's corner to this size, in world units.
   *
   * Binding it is what puts the handle on screen — a corner that moved and then changed nothing is
   * worse than no corner — so a graph whose sizes are not stored anywhere simply omits it.
   *
   * Where a size *lives* is the template's decision, the same as a position: on a board it belongs
   * to the placement rather than the record, so the same note can be a banner on one board and a
   * small square on another. `recordId` carries the record the node stands for, absent for a node
   * that stands for none.
   */
  onNodeResize?: (payload: {
    id: string;
    width: number;
    height: number;
    recordId?: string;
    recordType?: string;
  }) => void;

  /**
   * Data-layer bindings, injected by the host's component registry rather than written in a template.
   * Templates never supply these.
   */
  host?: GraphHostBindings;
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
  query(request: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  /**
   * Report changes to records of a type, and return a function that stops reporting.
   *
   * Optional: a host with no change notification omits it and the graph stays as loaded. The engine
   * decides what to watch from the reads its seeds performed — nothing calls this directly.
   */
  watch?(request: { entity: string; dataset?: string }, onChange: () => void): () => void;
  defaultDataset(): string | null;
  models(dataset?: string): {
    name: string;
    properties: { name: string; type: 'string' | 'number' | 'boolean' | 'uri'; required?: boolean }[];
    relations: { name: string; target: string; cardinality: 'one' | 'many' }[];
    identityProperty?: string;
    description?: string;
  }[];
}
