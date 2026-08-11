/**
 * Reified edges — relationships that are entities in their own right.
 *
 * Some relationships carry data. AD4M's interpretation work produces exactly this shape: a
 * `SemanticRelationship { relevance }` whose two relations name the things it connects, so the edge
 * has properties, provenance and an identity of its own. Flux's existing schema has the same thing.
 *
 * Drawn naively they are a disaster: every relationship becomes a **node**, so a map of a hundred
 * tagged messages shows three hundred dots and no relationships at all. The fix is to recognise them
 * and collapse each instance into the single edge it stands for, carrying its scalars in `data` and
 * its address in `reifiedAs` — so clicking the edge can still open the underlying record.
 *
 * ## Why this is configuration rather than inference
 *
 * It is tempting to auto-detect: "a class with exactly two relations and no other purpose is an
 * edge". That is wrong often enough to be dangerous — a `Membership` with `agent` and `space` is a
 * reified edge, a `Comment` with `author` and `post` is a node people want to see and read. Only the
 * person modelling the space knows which is which, so the template says.
 */
import type { EntityShape, GraphEdge, GraphNode } from '@we/graph-protocol';
import { entityAddress } from '@we/graph-protocol';

import { labelProperty, placeholder, rowToNode } from './nodes';

/** Which relations on a reified class name its two endpoints. */
export interface ReifiedEdgeSpec {
  /** Relation holding the edge's source. */
  source: string;
  /** Relation holding the edge's target. */
  target: string;
  /** Edge type drawn. Defaults to the entity name. */
  type?: string;
}

/** Entity name → how to read it as an edge. */
export type ReifiedEdgeMap = Record<string, ReifiedEdgeSpec>;

/** Flux's and interpretation's shape, ready to use — the two this engine will actually meet first. */
export const DEFAULT_REIFIED_EDGES: ReifiedEdgeMap = {
  SemanticRelationship: { source: 'expression', target: 'tag', type: 'tagged' },
};

export function isReified(entity: string, map: ReifiedEdgeMap | undefined): boolean {
  return Boolean(map && entity in map);
}

/** The relation names that are endpoints, so a caller can `include` them in one query. */
export function endpointRelations(entity: string, map: ReifiedEdgeMap): string[] {
  const spec = map[entity];
  return spec ? [spec.source, spec.target] : [];
}

interface Endpoint {
  node: GraphNode;
  id: string;
}

/** Resolve one endpoint, hydrated or as a bare id. Returns null when the relation is empty. */
function endpoint(
  value: unknown,
  targetEntity: string,
  dataset: string,
  shapes: EntityShape[],
  source: string,
): Endpoint | null {
  if (typeof value === 'string') {
    return { node: placeholder(dataset, targetEntity, value, source), id: value };
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const node = rowToNode(
      row,
      targetEntity,
      dataset,
      shapes.find((s) => s.name === targetEntity),
      source,
    );
    if (node && typeof row.id === 'string') return { node, id: row.id };
  }
  return null;
}

/**
 * Turn one instance of a reified class into the edge it represents, plus whichever endpoints came
 * back with it.
 *
 * Returns `null` when either endpoint is missing — a relationship with one end is not an edge, and
 * drawing half of it would be worse than dropping it. The caller warns.
 */
export function reifiedEdgeFrom(
  row: Record<string, unknown>,
  entity: string,
  spec: ReifiedEdgeSpec,
  dataset: string,
  shapes: EntityShape[],
  sourceId: string,
): { edge: GraphEdge; nodes: GraphNode[] } | null {
  const id = typeof row.id === 'string' ? row.id : undefined;
  if (!id) return null;

  const shape = shapes.find((s) => s.name === entity);
  const sourceRelation = shape?.relations.find((r) => r.name === spec.source);
  const targetRelation = shape?.relations.find((r) => r.name === spec.target);
  if (!sourceRelation || !targetRelation) return null;

  const from = endpoint(row[spec.source], sourceRelation.target, dataset, shapes, sourceId);
  const to = endpoint(row[spec.target], targetRelation.target, dataset, shapes, sourceId);
  if (!from || !to) return null;

  // Scalars only — the edge's own data, which is the entire reason the relationship was reified.
  const data: Record<string, string | number | boolean | null> = {};
  for (const property of shape?.properties ?? []) {
    const value = row[property.name];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      data[property.name] = value as string | number | boolean | null;
    }
  }

  const labelKey = labelProperty(shape);
  return {
    edge: {
      // Keyed on the instance, so re-reaching the same relationship from either end is one edge.
      id: `reified|${entityAddress(dataset, entity, id)}`,
      source: from.node.id,
      target: to.node.id,
      type: spec.type ?? entity,
      label: labelKey && typeof row[labelKey] === 'string' ? (row[labelKey] as string) : undefined,
      data,
      // Keeps the record reachable: the edge is a view of an entity, and clicking it should be able
      // to open that entity rather than dead-ending.
      reifiedAs: entityAddress(dataset, entity, id),
    },
    nodes: [from.node, to.node],
  };
}
