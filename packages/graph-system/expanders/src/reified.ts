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
  /**
   * Property naming the source's entity type, where the relation is untyped.
   *
   * A schema-declared relation names its target class, which is where an endpoint's type normally
   * comes from — and it is exactly what a relationship somebody *drew* cannot have, since the point
   * is connecting whatever two things a member found worth connecting. A node address needs the
   * type, so the record carries it beside the reference and this names the property holding it.
   */
  sourceType?: string;
  /** The same, for the target end. */
  targetType?: string;
}

/** Entity name → how to read it as an edge. */
export type ReifiedEdgeMap = Record<string, ReifiedEdgeSpec>;

/** The shapes this engine will actually meet: WE's own, interpretation's, and Flux's. */
export const DEFAULT_REIFIED_EDGES: ReifiedEdgeMap = {
  SemanticRelationship: { source: 'expression', target: 'tag', type: 'tagged' },
  // WE's own hand-drawn connection. Its `type` is deliberately not the entity name: what the edge
  // *means* is whatever the author typed into `label`, and `rowToNode`'s label rules already pick
  // that up — so the type stays a stable category ("this is a relationship somebody asserted") and
  // the label carries the meaning.
  Relationship: {
    source: 'source',
    target: 'target',
    type: 'relates',
    sourceType: 'sourceType',
    targetType: 'targetType',
  },
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

/** Read an endpoint's entity name off the row, where the spec says a property holds it. */
function readType(row: Record<string, unknown>, property: string | undefined): string {
  if (!property) return '';
  const value = row[property];
  return typeof value === 'string' ? value : '';
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

  /*
    An endpoint's type comes from the relation's declared target, or — where the relation is
    untyped — from a property on the row.

    Both are needed and neither is a fallback for the other. A schema-declared relationship
    (`SemanticRelationship.tag` → `Topic`) knows its target class and stores no copy of it, which is
    right: the schema is the authority and a stored duplicate could drift from it. A drawn one has
    no declared target at all, so the row is the only place the type can live.
  */
  const sourceEntity = sourceRelation.target || readType(row, spec.sourceType);
  const targetEntity = targetRelation.target || readType(row, spec.targetType);
  if (!sourceEntity || !targetEntity) return null;

  const from = endpoint(row[spec.source], sourceEntity, dataset, shapes, sourceId);
  const to = endpoint(row[spec.target], targetEntity, dataset, shapes, sourceId);
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
