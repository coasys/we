/**
 * Style rules for globe features, in the graph's dialect.
 *
 * A data layer is styled with the same `{ when, style }` rules a GraphView takes, resolved by the same
 * code. So `{ "metric": "field", "options": { "from": "population" }, "scale": "heat" }` means the
 * same thing on a pin as on a card, and an author or a model that has learnt one has learnt both. What
 * differs is the style's properties, which are each kind's own (a pin has a size, an area an
 * extrusion), and those are declared by the kinds.
 */
import { defaultMetrics, type MetricValues, resolveColor, resolveNumber, resolveStyle } from '@we/graph-core';
import type { GraphNode, Metric, MetricRef, StyleRule, StyleRules, StyleValue } from '@we/graph-protocol';
import { metricKey } from '@we/graph-protocol';

export type { MetricRef, StyleRule, StyleRules, StyleValue };

/** The metrics a globe rule can name. The graph's shape metrics (degree, community) read edges, which a globe has none of. */
const METRICS: ReadonlyMap<string, Metric> = new Map(defaultMetrics().map((metric) => [metric.id, metric]));

function isMetricRef(value: unknown): value is MetricRef {
  return typeof value === 'object' && value !== null && 'metric' in value;
}

function flatten<T>(rules: StyleRules<T> | undefined): StyleRule<T>[] {
  return (rules ?? []).flatMap((rule) => (Array.isArray(rule) ? rule : [rule]));
}

/**
 * Computes every metric the rules name, over all the subjects at once — a heat scale is relative to
 * the rest of the data, so it cannot be worked out one feature at a time.
 */
export function computeMetrics<T extends object>(
  subjects: GraphNode[],
  rules: StyleRules<T> | undefined,
): MetricValues {
  const values = new Map<string, Map<string, number>>();
  for (const rule of flatten(rules)) {
    for (const value of Object.values(rule.style ?? {})) {
      if (!isMetricRef(value)) continue;
      const key = metricKey(value);
      if (values.has(key)) continue;
      const metric = METRICS.get(value.metric);
      values.set(key, metric ? metric.compute({ nodes: subjects, edges: [] }, value.options) : new Map());
    }
  }
  return values;
}

/** One subject's style, resolved against the metrics already computed for all of them. */
export class StyleResolver<T extends object> {
  private readonly metrics: MetricValues;

  constructor(
    subjects: GraphNode[],
    private readonly rules: StyleRules<T> | undefined,
  ) {
    this.metrics = computeMetrics(subjects, rules);
  }

  /** The merged style of every rule that matches. */
  style(subject: GraphNode): T {
    return resolveStyle(subject, this.rules, this.metrics);
  }

  number(value: StyleValue<number> | undefined, subject: GraphNode, fallback: number): number {
    return resolveNumber(value, subject, this.metrics, fallback);
  }

  /** A colour as a CSS value — a token, a role, a `color-mix()` — for a {@link ColorResolver} to paint. */
  color(value: StyleValue<string> | undefined, subject: GraphNode, fallback: string): string {
    return resolveColor(value, subject, this.metrics, fallback);
  }
}
