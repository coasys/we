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
  /**
   * Child types to skip, whatever else says to look for them.
   *
   * For containment that is bookkeeping rather than content. A board keeps its coordinates as
   * `Placement` records parented alongside its cards — the cheapest place to put them, since a
   * board's children are already a mixed bag — and a containment walk that drew them would put a
   * dot on the canvas for every card, saying nothing and doubling the node count.
   *
   * A denylist rather than leaving them out of `children`, because the two lists answer different
   * questions: `children` is what a template *wants*, and this is what is never worth drawing
   * whatever anybody wants. It applies to the default list too, which is the case that matters —
   * a template that names no children at all still should not see them.
   */
  exclude?: string[];
  /** Edge type drawn from parent to child. */
  edgeType?: string;
}

const ID = 'collection';

/**
 * Child types looked for when a template does not say.
 *
 * Each entry is one drill-down query per expansion, so this is a real cost and not a free "list
 * everything" — which is why it is the block types a collection actually tends to hold rather than
 * every entity WE declares.
 *
 * `TaskBlock` and `EventBlock` are here because a collection can now acquire them without anyone
 * composing them: interpretation writes what it finds in a call transcript straight onto the call's
 * collection. Leaving them out made a successful extraction look like nothing had happened — the
 * records existed and the one view built to show a collection's contents did not draw them.
 *
 * A type absent from the dataset's schema is skipped rather than queried, so listing one a given
 * space has never installed costs nothing.
 */
const DEFAULT_CHILDREN = ['CollectionBlock', 'TextBlock', 'ImageBlock', 'TaskBlock', 'EventBlock'];

/**
 * Never drawn as containment, whatever a template asks for.
 *
 * `Placement` is a coordinate parented next to the thing it positions — see the board seed — so it
 * is a child in the storage sense and never in the sense anybody means by "what is in here".
 */
const NEVER_CHILDREN = ['Placement'];

export function collectionExpander(options: CollectionExpanderOptions = {}): Expander {
  const via = options.via ?? 'children';
  const skip = new Set([...NEVER_CHILDREN, ...(options.exclude ?? [])]);
  const childEntities = (options.children ?? DEFAULT_CHILDREN).filter((name) => !skip.has(name));
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
