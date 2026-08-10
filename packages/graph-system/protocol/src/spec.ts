/**
 * The graph specification — what a template writes, and the whole authoring surface.
 *
 * Everything here is JSON. That is the constraint the design is built around: a template is data, an
 * LLM edits data in place, and a value that can only be expressed as a function is a value no
 * community member can ever author. Where something genuinely needs code, it is named here and
 * implemented as a registered plugin — expander, layout, renderer, behaviour, metric — which is the
 * same ladder WE already runs between templates and components, one level down.
 */
import type { GraphFragment } from './graph';
import type { EdgeStyleRules, NodeStyleRules } from './style';

/**
 * Where the graph starts.
 *
 * A static diagram uses `nodes`/`edges` and nothing else — no seeds, no expanders, no exploration
 * vocabulary. An explorer names a source and its options. Both are the same field because a literal
 * fragment *is* a source; separating them would make the simple case learn the hard case's shape.
 */
export type SeedSpec =
  | ({ literal: true } & GraphFragment)
  | {
      /** Registered seed source id — `query`, `dataset`, `models`, … */
      source: string;
      options?: Record<string, unknown>;
    };

/** When to expand automatically, rather than waiting for a click. */
export interface AutoExpandRule {
  /** Match clause against the node — same vocabulary as style rules. */
  when?: Record<string, unknown>;
  /** How many hops to open from matching nodes. */
  depth: number;
  direction?: 'in' | 'out' | 'both';
  /** Cap per node, so an auto-rule cannot open a hub. */
  limit?: number;
}

export interface ExpansionSpec {
  /** Hops opened from every seed node. `0` shows only the seeds. */
  defaultDepth?: number;
  /** Direction used for click-expansion and for rules that do not name one. */
  direction?: 'in' | 'out' | 'both';
  /** Page size for one expansion. */
  limit?: number;
  /** Expander ids to enable. Absent means every registered expander that claims a node. */
  expanders?: string[];
  /** Only follow these edge types. */
  edgeTypes?: string[];
  auto?: AutoExpandRule[];
  /**
   * Hard ceiling on nodes held at once.
   *
   * Not a performance tweak — a correctness one. Without it a single click on a hub can take the tab
   * down, and the user's last action becomes unrecoverable. On reaching it the engine stops expanding
   * and says so rather than silently truncating.
   */
  maxNodes?: number;
}

export interface LayoutSpec {
  /** Registered layout id — `force`, `radial`, `grid`, `manual`, … */
  type: string;
  /** Layout-specific options, passed through untouched. */
  options?: Record<string, unknown>;
}

/** Registered behaviour id, or an id with options. */
export type BehaviourSpec = string | { type: string; options?: Record<string, unknown> };

export interface GraphSpec {
  seeds?: SeedSpec | SeedSpec[];
  expansion?: ExpansionSpec;
  layout?: LayoutSpec;
  nodeStyle?: NodeStyleRules;
  edgeStyle?: EdgeStyleRules;
  behaviours?: BehaviourSpec[];
  /** Starting camera. Absent fits the seeds to the viewport. */
  viewport?: { x?: number; y?: number; zoom?: number };
}
