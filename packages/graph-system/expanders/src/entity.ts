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
import { isReified, reifiedEdgeFrom, type ReifiedEdgeMap } from './reified';
import { followedRelations, readRelations, reifiedEnds, type RelationFilter } from './relations';

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

      await expandAround({
        request,
        context,
        address,
        dataset,
        shapes,
        options,
        nodes,
        edges,
        forward: request.direction !== 'in',
        backward: request.direction !== 'out',
      });

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

/** The relation names a request still allows — the options' list, narrowed by the request's own. */
function filterFor(request: ExpandRequest, options: EntityExpanderOptions): RelationFilter {
  const relations =
    options.relations && request.edgeTypes
      ? options.relations.filter((name) => request.edgeTypes!.includes(name))
      : (options.relations ?? request.edgeTypes);
  return { ...(relations ? { relations } : {}), ...(options.exclude ? { exclude: options.exclude } : {}) };
}

/**
 * Follow this instance's own relations, and find what points at it.
 *
 * Both through the shared relation reader, so a knowledge map and a canvas tree follow the same
 * relations: typed only, and never into the host's bookkeeping. Forward is one read with every
 * relation included; backward is one inbound read per relation pointing at this type.
 *
 * Forward, an untyped relation is never followed — that would mint an address for every comment,
 * call and child of every node the walk touches, which is a different graph. Backward, an untyped
 * relation is asked only where its class is reified (see `reifiedEnds`): that is how a drawn
 * connection is found, standing on one of its ends.
 */
async function expandAround(
  work: Work & { shapes: EntityShape[]; forward: boolean; backward: boolean },
): Promise<void> {
  const { request, context, address, dataset, shapes, options, nodes, edges } = work;
  const filter = filterFor(request, options);
  const followed = followedRelations(shapes, filter);
  const { rows, links } = await readRelations({
    context,
    dataset,
    type: address.type!,
    ids: [address.id!],
    forward: work.forward ? followed.filter((relation) => relation.holder === address.type) : [],
    backward: work.backward
      ? [
          ...followed.filter((relation) => relation.target === address.type),
          ...reifiedEnds(shapes, options.reified, filter),
        ]
      : [],
    reified: options.reified,
    limit: request.limit ?? 50,
    signal: request.signal,
  });
  const rowOf = new Map(rows.map((found) => [found.row.id, found]));
  const forwardCount = new Map<string, number>();

  for (const link of links) {
    const outward = link.holder === address.id && link.relation.holder === address.type;
    if (outward) {
      // A relation's values capped per relation, as the forward pass always has.
      const taken = forwardCount.get(link.relation.name) ?? 0;
      if (taken >= (request.limit ?? 50)) continue;
      forwardCount.set(link.relation.name, taken + 1);
    }
    const otherId = outward ? link.value : link.holder;
    const otherType = outward ? link.relation.target : link.relation.holder;
    const found = rowOf.get(otherId);

    // A reified class is an edge, not a dot: collapse it into the edge it stands for.
    if (isReified(otherType, options.reified) && found) {
      const resolved = reifiedEdgeFrom(found.row, otherType, options.reified![otherType], dataset, shapes, ID);
      if (!('reason' in resolved)) {
        nodes.push(...resolved.nodes);
        edges.push(resolved.edge);
        continue;
      }
      /*
        Backward, a reified record is only ever the edge — standing on one end, the relationship points
        at you — so one that cannot be resolved is reported and skipped. Forward it falls through to
        an ordinary node, a degradation rather than a failure.
      */
      if (!outward) {
        context.warn(`${otherType} ${otherId} not drawn: ${resolved.reason}`);
        continue;
      }
    }

    /*
      A relation comes back either hydrated (include worked) or as a bare id (it did not, or the
      instance has not synced). Both are legitimate; the bare case becomes a placeholder rather than
      being dropped, so the edge still tells you something is there.
    */
    const shape = shapes.find((s) => s.name === otherType);
    const node = found
      ? rowToNode(found.row, otherType, dataset, shape, ID)
      : outward
        ? placeholder(dataset, otherType, otherId, ID)
        : null;
    if (!node) continue;
    nodes.push(node);
    edges.push(
      outward
        ? {
            id: edgeId(request.id, link.relation.name, node.id),
            source: request.id,
            target: node.id,
            type: link.relation.name,
          }
        : {
            id: edgeId(node.id, link.relation.name, request.id),
            source: node.id,
            target: request.id,
            type: link.relation.name,
          },
    );
  }
}

function empty(): ExpandResult {
  return { nodes: [], edges: [] };
}
