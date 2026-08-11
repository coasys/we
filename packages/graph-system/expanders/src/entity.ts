/**
 * The entity expander — typed relations, in both directions.
 *
 * The default answer to "what is adjacent to this?" for anything backed by a model, and the one that
 * makes a knowledge map over interpretation output work without a line of per-class code: it reads
 * the dataset's own shapes, so a class installed last week appears with its relations already
 * traversable.
 *
 * ## Both directions, and why the reverse one matters
 *
 * WE's relations are one-directional — the neutral manifest does not emit `reverseOf`, and the IR
 * walks forward — so "what points at this?" has to be asked as its own query, against every shape
 * whose relations target this type. That is more work than following a relation, and it is not
 * optional: a map you can only walk downstream is a tree, and the interesting question about a belief
 * is usually who holds it, not what it mentions.
 */
import type {
  EntityShape,
  Expander,
  ExpanderContext,
  ExpandRequest,
  ExpandResult,
  GraphEdge,
  GraphNode,
} from '@we/graph-protocol';
import { parseAddress } from '@we/graph-protocol';

import { edgeId, placeholder, rowToNode } from './nodes';
import { endpointRelations, isReified, reifiedEdgeFrom, type ReifiedEdgeMap } from './reified';

export interface EntityExpanderOptions {
  /** Relations to follow. Absent means all of them. */
  relations?: string[];
  /** Relations never to follow — noisy back-references, audit trails. */
  exclude?: string[];
  /**
   * Entities that are really edges — see `reified.ts`.
   *
   * Without this an interpretation or Flux dataset draws every `SemanticRelationship` as a node, so
   * the map shows three times as many dots and none of the relationships they encode.
   */
  reified?: ReifiedEdgeMap;
}

const ID = 'entity';

export function entityExpander(options: EntityExpanderOptions = {}): Expander {
  return {
    id: ID,
    kinds: ['entity'],
    description: "Follows an entity's typed relations, forwards and backwards, using the dataset's own schema.",
    async expand(request, context) {
      const address = parseAddress(request.id);
      if (!address || address.kind !== 'entity' || !address.type || !address.id) return empty();

      const dataset = address.dataset ?? context.defaultDataset() ?? '';
      const shapes = context.models(dataset);
      const shape = shapes.find((s) => s.name === address.type);
      if (!shape) {
        context.warn(`no shape for "${address.type}" in this dataset — cannot expand it`);
        return empty();
      }

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      if (request.direction !== 'in') {
        await expandForward({ request, context, address, dataset, shape, options, nodes, edges });
      }
      if (request.direction !== 'out') {
        await expandBackward({ request, context, address, dataset, shapes, options, nodes, edges });
      }

      return { nodes, edges, total: nodes.length };
    },
  };
}

interface Work {
  request: ExpandRequest;
  context: ExpanderContext;
  address: NonNullable<ReturnType<typeof parseAddress>>;
  dataset: string;
  options: EntityExpanderOptions;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function wanted(relation: string, request: ExpandRequest, options: EntityExpanderOptions): boolean {
  if (options.exclude?.includes(relation)) return false;
  if (options.relations && !options.relations.includes(relation)) return false;
  if (request.edgeTypes && !request.edgeTypes.includes(relation)) return false;
  return true;
}

/**
 * Follow this instance's own relations.
 *
 * One query with every wanted relation included, rather than one per relation: the include path
 * batches, so this is a single round trip regardless of how many relations a class declares.
 */
async function expandForward({
  request,
  context,
  address,
  dataset,
  shape,
  options,
  nodes,
  edges,
}: Work & { shape: EntityShape }): Promise<void> {
  const relations = shape.relations.filter((r) => wanted(r.name, request, options));
  if (!relations.length) return;

  const include: Record<string, unknown> = {};
  for (const relation of relations) {
    // Nesting the endpoints so a relation pointing *at* a reified class can be resolved through it in
    // the same round trip, rather than drawing the relationship and stopping there.
    const nested = isReified(relation.target, options.reified)
      ? { include: Object.fromEntries(endpointRelations(relation.target, options.reified!).map((n) => [n, true])) }
      : true;
    include[relation.name] = nested;
  }

  const rows = await context.query({
    entity: shape.name,
    dataset,
    where: { id: address.id },
    include,
    limit: 1,
    signal: request.signal,
  });
  const row = rows[0];
  if (!row) return;

  for (const relation of relations) {
    const value = row[relation.name];
    const targets = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    const targetShape = context.models(dataset).find((s) => s.name === relation.target);

    for (const target of targets.slice(0, request.limit ?? 50)) {
      if (isReified(relation.target, options.reified) && target && typeof target === 'object') {
        const resolved = reifiedEdgeFrom(
          target as Record<string, unknown>,
          relation.target,
          options.reified![relation.target],
          dataset,
          context.models(dataset),
          ID,
        );
        if (resolved) {
          nodes.push(...resolved.nodes);
          edges.push(resolved.edge);
          continue;
        }
      }

      // A relation comes back either hydrated (include worked) or as a bare id (it did not, or the
      // instance has not synced). Both are legitimate; the bare case becomes a placeholder rather
      // than being dropped, so the edge still tells you something is there.
      const node =
        typeof target === 'object' && target !== null
          ? rowToNode(target as Record<string, unknown>, relation.target, dataset, targetShape, ID)
          : typeof target === 'string'
            ? placeholder(dataset, relation.target, target, ID)
            : null;
      if (!node) continue;
      nodes.push(node);
      edges.push({
        id: edgeId(request.id, relation.name, node.id),
        source: request.id,
        target: node.id,
        type: relation.name,
      });
    }
  }
}

/**
 * Find what points at this instance.
 *
 * Asked per candidate shape — every type declaring a relation whose target is ours — through the
 * neutral `scope` drill-down with `direction: 'in'`. A host that cannot run that says so and this
 * degrades to the forward half rather than returning a graph that quietly omits half its edges.
 */
async function expandBackward({
  request,
  context,
  address,
  dataset,
  shapes,
  options,
  nodes,
  edges,
}: Work & { shapes: EntityShape[] }): Promise<void> {
  const candidates = shapes.flatMap((source) =>
    source.relations
      .filter((relation) => relation.target === address.type && wanted(relation.name, request, options))
      .map((relation) => ({ source, relation })),
  );

  for (const { source, relation } of candidates) {
    const reifiedInclude = isReified(source.name, options.reified)
      ? Object.fromEntries(endpointRelations(source.name, options.reified!).map((name) => [name, true]))
      : undefined;

    const rows = await context
      .query({
        entity: source.name,
        dataset,
        scope: { anchor: address.type!, via: relation.name, anchorId: address.id!, direction: 'in' },
        limit: request.limit ?? 50,
        include: reifiedInclude,
        signal: request.signal,
      })
      .catch((error: unknown) => {
        context.warn(
          `cannot read what points at ${address.type} via ${source.name}.${relation.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [] as Record<string, unknown>[];
      });

    for (const row of rows) {
      // A reified class reached backwards is the normal way an edge is found: you are standing on one
      // endpoint and the relationship points at you. Collapse it rather than adding a dot.
      if (isReified(source.name, options.reified)) {
        const resolved = reifiedEdgeFrom(row, source.name, options.reified![source.name], dataset, shapes, ID);
        if (!resolved) {
          context.warn(`${source.name} ${String(row.id)} is missing an endpoint — skipped`);
          continue;
        }
        nodes.push(...resolved.nodes);
        edges.push(resolved.edge);
        continue;
      }

      const node = rowToNode(row, source.name, dataset, source, ID);
      if (!node) continue;
      nodes.push(node);
      edges.push({
        id: edgeId(node.id, relation.name, request.id),
        source: node.id,
        target: request.id,
        type: relation.name,
      });
    }
  }
}

function empty(): ExpandResult {
  return { nodes: [], edges: [] };
}
