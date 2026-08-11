/**
 * Declarative styling — rules, not callbacks.
 *
 * The widget this replaces took `size?: (node) => number` and `color?: (node) => string`, which is
 * why no template ever used it: a schema is JSON and JSON has no functions. Every style decision here
 * is therefore data, and the match vocabulary is deliberately the one WE's schema system already uses
 * for `$filter` — `contains`, `exists`, `not`, `in` — so an author who can filter a list can style a
 * graph without learning a second dialect.
 *
 * Rules are evaluated in order and shallow-merged, last match winning per property. That makes
 * "everything is grey, beliefs are purple, *unresolved* beliefs are outlined" three rules that read
 * top to bottom, rather than one condition tree.
 *
 * Where a value genuinely has to be computed — size by centrality, colour by a scale — the answer is
 * not to grow this vocabulary toward a programming language. It is {@link MetricRef}: a named,
 * registered plugin, referenced from data with parameters. Same bargain the template system makes
 * with components.
 */
import type { GraphValue } from './graph';

/** Operators a match clause may use against a node/edge field. Mirrors the schema system's `$filter`. */
export interface MatchOperators {
  not?: GraphValue | GraphValue[];
  contains?: string;
  exists?: boolean;
  in?: GraphValue[];
  gt?: number;
  lt?: number;
}

/**
 * A match clause. Keys are `kind`, `type`, `label`, `unresolved`, or `data.<field>`; sibling keys are
 * ANDed. A bare value means equality.
 */
export type MatchClause = Record<string, GraphValue | MatchOperators>;

/**
 * A value computed by a registered metric rather than read off the node.
 *
 * This is the escape hatch, and it is the reason the rule vocabulary can stay small: anything
 * computational becomes a plugin with a name and parameters, so the data surface never has to grow
 * conditionals, arithmetic or scales.
 */
export interface MetricRef {
  /** Registered metric id — `degree`, `betweenness`, `community`, … */
  metric: string;
  /** Metric-specific options, passed through untouched. */
  options?: Record<string, unknown>;
  /** Map the metric's normalised 0..1 output onto an output range. */
  range?: [number, number];
  /** Map onto a named colour scale instead of a numeric range. */
  scale?: string;
}

export type StyleValue<T> = T | MetricRef;

export interface NodeStyle {
  /** Radius in world units, or the box's half-height for non-circular shapes. */
  size?: StyleValue<number>;
  /** Design token (`primary-500`) or CSS colour. Tokens resolve against the live theme. */
  color?: StyleValue<string>;
  borderColor?: string;
  borderWidth?: number;
  /**
   * `circle` and `rect` draw in both DOM and canvas modes; `template` requires DOM.
   *
   * `card` is the post-it: a sized box with the label *inside* it, wrapped, rather than a mark with a
   * caption underneath. Worth being a shape rather than a flag because it changes what `size` means —
   * a card is `width` × `height`, not a radius — and because a board is mostly cards.
   */
  shape?: 'circle' | 'rect' | 'card' | 'template';
  /** Card width in world units. Only meaningful for `shape: 'card'`; defaults to a readable box. */
  width?: number;
  /** Card height. Defaults to `width` × 0.75, roughly a post-it. */
  height?: number;
  opacity?: number;
  labelColor?: string;
  labelSize?: number;
  /** Hide the label below this zoom, so a dense graph stays readable when zoomed out. */
  labelMinZoom?: number;
  icon?: string;
  image?: string;
  /** Name of a registered node renderer, when the built-in shapes are not enough. */
  renderer?: string;
}

export interface EdgeStyle {
  width?: StyleValue<number>;
  color?: StyleValue<string>;
  opacity?: number;
  /** `bezier` is the readable default for dense graphs; `orthogonal` suits trees and flows. */
  curve?: 'straight' | 'bezier' | 'orthogonal';
  arrow?: 'none' | 'target' | 'both';
  dashed?: boolean;
  showLabel?: boolean;
  labelColor?: string;
}

/** One rule: match, then apply. A rule with no `when` is the base style. */
export interface StyleRule<TStyle> {
  when?: MatchClause;
  style: TStyle;
}

export type NodeStyleRules = StyleRule<NodeStyle>[];
export type EdgeStyleRules = StyleRule<EdgeStyle>[];

/**
 * A registered metric.
 *
 * Runs over the visible graph on demand — a user action, an expansion settling — never per frame.
 * Returns a value per node, which the core normalises before a {@link MetricRef} maps it onto a range
 * or a scale.
 */
export interface Metric {
  id: string;
  description?: string;
  compute(
    graph: { nodes: { id: string }[]; edges: { source: string; target: string }[] },
    options?: Record<string, unknown>,
  ): Map<string, number>;
}
