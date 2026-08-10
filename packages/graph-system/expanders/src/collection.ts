/**
 * The containment expander — a parent's children, through an *untyped* relation.
 *
 * The entity expander cannot do this one, and the reason is worth stating because it will come up
 * again for every relation WE declares this way. `CollectionBlock.children` carries no target class,
 * so the neutral manifest has nothing to point `include` at — the relation is real, traversable, and
 * invisible to a schema-driven walk. The drill-down (`scope`) path exists precisely for that case: it
 * names the parent, the relation, and the type of child being asked for.
 *
 * Which is why the child types are configuration rather than discovery. Nothing in the schema says
 * what may sit inside a collection, so the template says instead — and because nesting is expressed
 * as "a collection may contain a collection", drilling into a call transcript, a note, a board and
 * then further into a nested board is the same rule applied repeatedly.
 */
import type { Expander, GraphEdge, GraphNode } from '@we/graph-protocol';
import { parseAddress } from '@we/graph-protocol';

import { edgeId, rowToNode } from './nodes';

export interface CollectionExpanderOptions {
  /** Entity types this expands. Others are left to the entity expander. */
  parents?: string[];
  /** The untyped to-many relation holding the children. */
  via?: string;
  /** Child entity types to look for, in order. Each is one drill-down query. */
  children?: string[];
  /** Edge type drawn from parent to child. */
  edgeType?: string;
}

const ID = 'collection';

export function collectionExpander(options: CollectionExpanderOptions = {}): Expander {
  const via = options.via ?? 'children';
  const childEntities = options.children ?? ['CollectionBlock', 'TextBlock', 'ImageBlock'];
  const edgeType = options.edgeType ?? 'contains';

  return {
    id: ID,
    kinds: ['entity'],
    types: options.parents ?? ['CollectionBlock'],
    // Above the entity expander: on something that is explicitly a container, "open it" means show
    // what is inside, not what it happens to reference.
    priority: 10,
    description: 'Opens a container entity into its children, through an untyped to-many relation.',
    async expand(request, context) {
      const address = parseAddress(request.id);
      if (!address || address.kind !== 'entity' || !address.type || !address.id) {
        return { nodes: [], edges: [] };
      }
      // Containment runs one way. Asking what a block is inside is a question for the entity
      // expander's backward pass, not a second drill-down with the arrows reversed.
      if (request.direction === 'in') return { nodes: [], edges: [] };

      const dataset = address.dataset ?? context.defaultDataset() ?? '';
      const shapes = context.models(dataset);
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      for (const child of childEntities) {
        if (!shapes.some((s) => s.name === child)) continue;
        const rows = await context
          .query({
            entity: child,
            dataset,
            scope: { anchor: address.type, via, anchorId: address.id },
            limit: request.limit ?? 50,
            signal: request.signal,
          })
          .catch((error: unknown) => {
            context.warn(
              `cannot read ${child} children of ${address.type}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return [] as Record<string, unknown>[];
          });

        const shape = shapes.find((s) => s.name === child);
        for (const row of rows) {
          const node = rowToNode(row, child, dataset, shape, ID);
          if (!node) continue;
          nodes.push(node);
          edges.push({
            id: edgeId(request.id, edgeType, node.id),
            source: request.id,
            target: node.id,
            type: edgeType,
          });
        }
      }

      return { nodes, edges, total: nodes.length };
    },
  };
}
