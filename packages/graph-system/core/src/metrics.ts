/**
 * Metrics — the computed half of styling.
 *
 * `MetricRef` lets a template say "size by how connected this is" or "colour by cluster" without
 * containing a function. That only works if something computes the numbers, and until now nothing
 * did: the consumer side existed and every `{ metric: … }` silently fell back. These are the
 * producers.
 *
 * Deliberately few, and deliberately cheap. Each runs over the *visible* graph on demand — a user
 * action, an expansion settling — never per frame, so an O(n·m) pass over a few hundred nodes is
 * free. Anything heavier (betweenness, eigenvector) should project out to a real graph library
 * rather than being hand-rolled here; that is the line drawn in the package README.
 *
 * Every metric returns values **normalised to 0..1**, because that is what a `range` or a `scale`
 * maps from. A metric that returned raw counts would make every rule that uses it depend on the size
 * of the dataset.
 */
import type { Metric } from '@we/graph-protocol';

interface Snapshot {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}

/** Adjacency both ways, built once per computation. */
function adjacency(graph: Snapshot): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const node of graph.nodes) result.set(node.id, new Set());
  for (const edge of graph.edges) {
    result.get(edge.source)?.add(edge.target);
    result.get(edge.target)?.add(edge.source);
  }
  return result;
}

/** Scale to 0..1. An all-equal graph maps to 0, not to NaN or to 1. */
function normalise(raw: Map<string, number>): Map<string, number> {
  let min = Infinity;
  let max = -Infinity;
  for (const value of raw.values()) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  const result = new Map<string, number>();
  for (const [id, value] of raw) result.set(id, span > 0 ? (value - min) / span : 0);
  return result;
}

/**
 * How connected a node is.
 *
 * The one people actually want. "Make the important things bigger" is the first request of every
 * knowledge map, and on a graph built by expansion, degree is a decent proxy for importance because
 * the things you opened repeatedly are the things that mattered.
 */
export const degreeMetric: Metric = {
  id: 'degree',
  description: 'Number of edges touching a node, normalised 0..1. The usual choice for sizing.',
  compute(graph) {
    const neighbours = adjacency(graph);
    const raw = new Map<string, number>();
    for (const [id, set] of neighbours) raw.set(id, set.size);
    return normalise(raw);
  },
};

/**
 * Community detection by label propagation.
 *
 * Chosen over Louvain deliberately: it is about thirty lines, near-linear, needs no modularity
 * bookkeeping, and for the sizes this engine holds on screen it finds the same obvious groupings.
 * Louvain is the better algorithm on a graph of a hundred thousand nodes — and at that size this
 * should be projecting out to a library rather than running in the render package.
 *
 * The output is a community *index* normalised into 0..1, which is what makes
 * `{ metric: 'community', scale: 'categorical' }` colour each cluster differently. It is a
 * categorical value wearing a continuous type — the honest alternative would be a second metric
 * shape, and that is not worth it for one consumer.
 *
 * Note the determinism problem this avoids: label propagation with random tie-breaking gives
 * different colours on every run over identical data, which looks like the graph changed. Ties break
 * on the lowest node id instead, so the same graph always colours the same way.
 */
export const communityMetric: Metric = {
  id: 'community',
  description: 'Groups nodes by label propagation; pair with scale: "categorical" for a cluster map.',
  compute(graph, options) {
    const rounds = Number((options as { rounds?: number } | undefined)?.rounds ?? 8);
    const neighbours = adjacency(graph);
    const labels = new Map<string, string>();
    for (const node of graph.nodes) labels.set(node.id, node.id);

    // Stable order in, stable order out — see the note above.
    const order = [...graph.nodes].map((n) => n.id).sort();

    for (let round = 0; round < rounds; round += 1) {
      let changed = false;
      for (const id of order) {
        const counts = new Map<string, number>();
        for (const other of neighbours.get(id) ?? []) {
          const label = labels.get(other);
          if (label !== undefined) counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        if (!counts.size) continue;

        let best = labels.get(id)!;
        let bestCount = -1;
        for (const [label, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
          if (count > bestCount) {
            best = label;
            bestCount = count;
          }
        }
        if (best !== labels.get(id)) {
          labels.set(id, best);
          changed = true;
        }
      }
      // Converged: another round cannot move anything.
      if (!changed) break;
    }

    // Map each surviving label to an index, in first-seen order over the sorted node list, so the
    // numbering is stable too.
    const index = new Map<string, number>();
    for (const id of order) {
      const label = labels.get(id)!;
      if (!index.has(label)) index.set(label, index.size);
    }

    const raw = new Map<string, number>();
    for (const id of order) raw.set(id, index.get(labels.get(id)!) ?? 0);
    return normalise(raw);
  },
};

/** The default set, ready to register. */
export function defaultMetrics(): Metric[] {
  return [degreeMetric, communityMetric];
}
