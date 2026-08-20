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
   * Any value works — only the fact that it *changed* matters, so the natural shape in a template is
   * a `$localState` boolean flipped with `$toggleLocal` from a create action's `onSuccess`. There is
   * no arithmetic in the schema language, so a counter is not something a template can increment;
   * this takes a boolean precisely so the one available "something happened" gesture is enough.
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

  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  /**
   * The user dragged a line from one node to another, with the `connect-nodes` behaviour armed.
   *
   * Intent, not a mutation: the graph has no write path, and what connecting two things means
   * differs completely between a knowledge map, a board and an outline. A template answers by
   * creating whatever record it thinks the connection is — for WE's own knowledge map, a
   * `Relationship`, whose fields are the two ends' ids and types.
   */
  onEdgeCreate?: (payload: { source: GraphNode; target: GraphNode }) => void;
  onSelectionChange?: (ids: string[]) => void;
  /** Fired when a drag ends, with the world position — what a board persists. */
  onNodeDragEnd?: (payload: { id: string; x: number; y: number }) => void;

  /**
   * Data-layer bindings, injected by the host's component registry rather than written in a template.
   * Templates never supply these.
   */
  host?: GraphHostBindings;
}

/** What the host lends the graph so its expanders can read data without knowing the backend. */
export interface GraphHostBindings {
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
