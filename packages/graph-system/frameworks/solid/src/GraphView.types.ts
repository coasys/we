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
   */
  reified?: Record<string, { source: string; target: string; type?: string }>;

  width?: string;
  height?: string;
  /** Background colour — design token or CSS colour. */
  bg?: string;
  /** Show the loading/paging/warning strip. Defaults to true. */
  showStatus?: boolean;
  /** Show the controls (zoom, fit, re-layout). Defaults to true. */
  showControls?: boolean;

  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
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
  defaultDataset(): string | null;
  models(dataset?: string): {
    name: string;
    properties: { name: string; type: 'string' | 'number' | 'boolean' | 'uri'; required?: boolean }[];
    relations: { name: string; target: string; cardinality: 'one' | 'many' }[];
    identityProperty?: string;
    description?: string;
  }[];
}
