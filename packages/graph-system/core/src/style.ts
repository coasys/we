/**
 * Style-rule evaluation — turning declarative rules into a drawing instruction per node.
 *
 * The match vocabulary is deliberately the one the schema system's `$filter` already uses, so an
 * author who can filter a list can style a graph without learning a second dialect. Rules are applied
 * in order and shallow-merged, last match winning per property, which makes a cascade read top to
 * bottom instead of as one nested condition.
 *
 * What is *not* here is anything computational. Sizing by centrality or colouring by community does
 * not grow this matcher; it goes through {@link MetricRef}, resolved against values a registered
 * metric computed earlier. That is the line that keeps the authoring surface data rather than a
 * language it is slowly becoming.
 */
import type {
  EdgeCurve,
  EdgeStyle,
  GraphEdge,
  GraphNode,
  GraphValue,
  MatchClause,
  MatchOperators,
  MetricRef,
  NodeStyle,
  NodeVisual,
  StyleRule,
  StyleRules,
} from '@we/graph-protocol';

import { normaliseCurve } from './geometry';

/** Normalised metric output, by metric id then node id. Produced by the algorithms package. */
export type MetricValues = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** Read a match key off a node or edge. `data.x` reaches into the data bag; everything else is a field. */
function readField(subject: GraphNode | GraphEdge, key: string): unknown {
  if (key.startsWith('data.')) return subject.data?.[key.slice(5)];
  return (subject as unknown as Record<string, unknown>)[key];
}

function isOperators(value: unknown): value is MatchOperators {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['not', 'contains', 'exists', 'in', 'gt', 'lt'].some((k) => k in (value as object));
}

function matchesOperators(actual: unknown, ops: MatchOperators): boolean {
  if (ops.exists !== undefined) {
    const present = actual !== undefined && actual !== null;
    if (present !== ops.exists) return false;
  }
  if (ops.not !== undefined) {
    const excluded = Array.isArray(ops.not) ? ops.not : [ops.not];
    if (excluded.includes(actual as GraphValue)) return false;
  }
  if (ops.in !== undefined && !ops.in.includes(actual as GraphValue)) return false;
  if (ops.contains !== undefined) {
    if (typeof actual !== 'string') return false;
    if (!actual.toLowerCase().includes(ops.contains.toLowerCase())) return false;
  }
  if (ops.gt !== undefined && !(typeof actual === 'number' && actual > ops.gt)) return false;
  if (ops.lt !== undefined && !(typeof actual === 'number' && actual < ops.lt)) return false;
  return true;
}

/** Does a subject satisfy a clause? Sibling keys are ANDed; an empty clause matches everything. */
export function matches(subject: GraphNode | GraphEdge, clause?: MatchClause): boolean {
  if (!clause) return true;
  for (const [key, expected] of Object.entries(clause)) {
    const actual = readField(subject, key);
    if (isOperators(expected)) {
      if (!matchesOperators(actual, expected)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Flatten a rule list one level, so a group produced by a `$map` sits inline among hand-written rules.
 *
 * One level rather than deep, deliberately: the case is "a rule per row of data", and a rule list
 * nested twice is a template doing something nobody should have to read. Exported because the engine
 * also walks rules — to work out which metrics they reference — and two flattenings that disagreed
 * would mean a metric silently not computed for a rule that uses it.
 */
export function flattenRules<TStyle>(rules: StyleRules<TStyle> | undefined): StyleRule<TStyle>[] {
  if (!rules) return [];
  return rules.flatMap((rule) => (Array.isArray(rule) ? rule : [rule]));
}

/**
 * Merge every matching rule's style, in order.
 *
 * The rule list is read as `StyleRule<TStyle>[]` for inference's sake — a parameter typed as the
 * nested union infers `TStyle` as `object` and loses every property name downstream — and flattened
 * at the top. Callers pass `NodeStyleRules`/`EdgeStyleRules`, which are the nested form.
 */
export function resolveStyle<TStyle extends object>(
  subject: GraphNode | GraphEdge,
  rules: StyleRule<TStyle>[] | StyleRules<TStyle> | undefined,
): TStyle {
  let result = {} as TStyle;
  for (const rule of flattenRules(rules)) {
    if (matches(subject, rule.when)) result = { ...result, ...rule.style };
  }
  return result;
}

function isMetricRef(value: unknown): value is MetricRef {
  return typeof value === 'object' && value !== null && 'metric' in value;
}

/**
 * Resolve a value that may be a metric reference.
 *
 * A metric that has not been computed yields the fallback rather than an error: metrics run on user
 * action, so a rule referencing one is legitimately unresolved until it does, and a graph that
 * refused to draw until then would be worse than one that draws plainly.
 */
export function resolveNumber(
  value: number | MetricRef | undefined,
  nodeId: string,
  metrics: MetricValues,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return value;
  if (!isMetricRef(value)) return fallback;
  const normalised = metrics.get(value.metric)?.get(nodeId);
  if (normalised === undefined) return fallback;
  const [min, max] = value.range ?? [fallback, fallback * 2];
  return min + normalised * (max - min);
}

/**
 * Colour scales, as data.
 *
 * Named rather than expression-based for the same reason everything else here is: a template must be
 * able to say "colour by community" without containing a function. Values are design tokens where a
 * token exists, so a scale still answers to the active theme.
 */
const SCALES: Record<string, string[]> = {
  categorical: ['primary-500', 'success-500', 'warning-500', 'danger-500', 'neutral-500'],
  heat: ['primary-100', 'primary-300', 'primary-500', 'primary-700', 'primary-900'],
  cool: ['neutral-200', 'neutral-400', 'primary-400', 'primary-600', 'primary-800'],
};

export function resolveColor(
  value: string | MetricRef | undefined,
  nodeId: string,
  metrics: MetricValues,
  fallback: string,
): string {
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (!isMetricRef(value)) return fallback;
  const normalised = metrics.get(value.metric)?.get(nodeId);
  if (normalised === undefined) return fallback;
  const scale = SCALES[value.scale ?? 'heat'] ?? SCALES.heat;
  const index = Math.min(scale.length - 1, Math.floor(normalised * scale.length));
  return scale[index];
}

/** Defaults chosen so a graph with no `nodeStyle` at all still reads clearly. */
const DEFAULT_NODE: Required<Pick<NodeVisual, 'shape' | 'size' | 'color' | 'labelColor' | 'labelSize'>> = {
  shape: 'circle',
  size: 14,
  color: 'primary-500',
  labelColor: 'neutral-800',
  labelSize: 12,
};

/** Turn a node plus its resolved style into a drawing instruction. */
/** A card readable at one glance without dominating the canvas. */
const DEFAULT_CARD = { width: 160, height: 120 };

export function nodeVisual(node: GraphNode, style: NodeStyle, metrics: MetricValues): NodeVisual {
  const visual: NodeVisual = {
    shape: style.shape ?? DEFAULT_NODE.shape,
    size: resolveNumber(style.size, node.id, metrics, DEFAULT_NODE.size),
    color: resolveColor(style.color, node.id, metrics, DEFAULT_NODE.color),
    label: node.label ?? node.type,
    labelColor: style.labelColor ?? DEFAULT_NODE.labelColor,
    labelSize: style.labelSize ?? DEFAULT_NODE.labelSize,
    // Scaling by default: the intuition people arrive with is a board, where zooming magnifies the
    // whole drawing. Constant-size text is the specialist choice, so it is the one you ask for.
    scaleLabelWithZoom: style.scaleLabelWithZoom ?? true,
  };
  if (visual.shape === 'card') {
    visual.width = style.width ?? DEFAULT_CARD.width;
    // Proportional rather than fixed, so widening a card keeps its shape instead of turning it into
    // a letterbox.
    visual.height = style.height ?? Math.round(visual.width * 0.75);
    // `size` is the hit radius everywhere else in the system; for a card it is half the box, so
    // picking covers the card rather than a dot in the middle of it.
    visual.size = Math.max(visual.width, visual.height) / 2;
  }
  if (style.borderColor !== undefined) visual.borderColor = style.borderColor;
  if (style.borderWidth !== undefined) visual.borderWidth = style.borderWidth;
  if (style.opacity !== undefined) visual.opacity = style.opacity;
  if (style.icon !== undefined) visual.icon = style.icon;
  if (style.image !== undefined) visual.image = style.image;

  // A placeholder must look like one. Without this an unsynced relation target is indistinguishable
  // from a real node with a short name, which is the difference between "not here yet" and "empty".
  if (node.unresolved) {
    visual.opacity = visual.opacity ?? 0.45;
    visual.borderWidth = visual.borderWidth ?? 1;
    visual.borderColor = visual.borderColor ?? 'neutral-400';
  }
  return visual;
}

const DEFAULT_EDGE = { width: 1.5, color: 'neutral-300' };

export interface EdgeVisual {
  width: number;
  color: string;
  opacity?: number;
  curve: EdgeCurve;
  arrow: 'none' | 'target' | 'both';
  dashed?: boolean;
  /** False keeps stroke width constant on screen. See `EdgeStyle.scaleWithZoom`. */
  scaleWithZoom: boolean;
  label?: string;
  labelColor?: string;
}

export function edgeVisual(edge: GraphEdge, style: EdgeStyle, metrics: MetricValues): EdgeVisual {
  // A bundle stands for many edges, so it says so in its weight rather than pretending to be one
  // relationship — the honesty a collapsed view depends on.
  const weightBoost = edge.weight && edge.weight > 1 ? Math.min(4, 1 + Math.log2(edge.weight)) : 1;
  const visual: EdgeVisual = {
    width: resolveNumber(style.width, edge.id, metrics, DEFAULT_EDGE.width) * weightBoost,
    color: resolveColor(style.color, edge.id, metrics, DEFAULT_EDGE.color),
    curve: normaliseCurve(style.curve),
    arrow: style.arrow ?? 'target',
    scaleWithZoom: style.scaleWithZoom ?? true,
  };
  if (style.opacity !== undefined) visual.opacity = style.opacity;
  if (style.dashed !== undefined) visual.dashed = style.dashed;
  if (style.showLabel) visual.label = edge.label ?? edge.type;
  if (style.labelColor !== undefined) visual.labelColor = style.labelColor;
  return visual;
}
