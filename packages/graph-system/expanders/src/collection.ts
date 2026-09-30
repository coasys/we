/**
 * The containment expander — a parent's children, through an *untyped* relation.
 *
 * `CollectionBlock.children` carries no target class, so for a long time `include` had nothing to
 * point at and the relation was real, traversable and invisible to a schema-driven walk. This
 * expander existed to work around that: one `scope` drill-down per child type, with the types
 * supplied as configuration because nothing in the schema said what may sit inside a collection.
 *
 * The relation is now declared polymorphic, so a single read returns every member already
 * classified. That removes the workaround and, with it, the defect at its centre — a configured
 * list is a list somebody has to keep current, and a collection holding a type nobody thought to
 * name simply did not appear. Interpretation writing a `TaskBlock` into a call was exactly that:
 * the records existed, the view that shows a collection's contents did not draw them, and adding
 * the type to a constant was the fix. There is no constant to add to now.
 *
 * `children` survives as a *restriction* for a template that wants a narrower view, and costs
 * nothing when absent. Nesting still falls out on its own, since a collection containing a
 * collection is one more member with a type.
 */
import type { Expander, GraphEdge, GraphNode } from '@we/graph-protocol';
import { nodeTypeOf, parseAddress } from '@we/graph-protocol';

import { edgeId, rowToNode } from './nodes';

export interface CollectionExpanderOptions {
  /** Entity types this expands. Others are left to the entity expander. */
  parents?: string[];
  /** The untyped to-many relation holding the children. */
  via?: string;
  /**
   * Restrict the drawing to these child types. Absent draws whatever the collection holds.
   *
   * It used to be a work list — each entry one drill-down query — which made omitting a type the
   * same as the type not being there. Now the members arrive classified, so this narrows a view
   * rather than deciding what is read, and leaving it out is the right default.
   */
  children?: string[];
  /**
   * Child types to skip, whatever else says to look for them.
   *
   * For containment that is bookkeeping rather than content. A canvas keeps its coordinates as
   * `Placement` records parented alongside its cards — the cheapest place to put them, since a
   * canvas's children are already a mixed bag — and a containment walk that drew them would put a
   * dot on the canvas for every card, saying nothing and doubling the node count.
   *
   * A denylist rather than leaving them out of `children`, because the two lists answer different
   * questions: `children` is what a template *wants*, and this is what is never worth drawing
   * whatever anybody wants. The distinction matters more now that `children` is usually absent —
   * "draw everything in here" must still not mean the bookkeeping.
   */
  exclude?: string[];
  /** Edge type drawn from parent to child. */
  edgeType?: string;
}

const ID = 'collection';

/**
 * Never drawn as containment, whatever a template asks for.
 *
 * `Placement` is a coordinate parented next to the thing it positions — see the canvas seed — so it
 * is a child in the storage sense and never in the sense anybody means by "what is in here".
 */
const NEVER_CHILDREN = ['Placement'];

export function collectionExpander(options: CollectionExpanderOptions = {}): Expander {
  const via = options.via ?? 'children';
  const skip = new Set([...NEVER_CHILDREN, ...(options.exclude ?? [])]);
  // Absent means "draw whatever is in there", which is the point: the members arrive already
  // classified, so there is no list to guess and nothing to leave out by forgetting to name it.
  const allowed = options.children ? new Set(options.children.filter((name) => !skip.has(name))) : undefined;
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

      const [parent] = await context
        .query({
          entity: address.type,
          dataset,
          where: { id: address.id },
          include: { [via]: true },
          limit: 1,
          signal: request.signal,
        })
        .catch((error: unknown) => {
          context.warn(
            `cannot read the ${via} of ${address.type}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [] as Record<string, unknown>[];
        });

      const members = Array.isArray(parent?.[via]) ? (parent[via] as Record<string, unknown>[]) : [];
      let untyped = 0;

      for (const row of members.slice(0, request.limit ?? 50)) {
        // Each member says what it is, because the relation is read polymorphically. A row without
        // it is counted and reported rather than skipped in silence: it means the read did not
        // classify — a relation not declared polymorphic, or an executor that cannot — and the
        // symptom is a container that opens onto nothing, which is indistinguishable from an empty
        // one at a glance.
        const child = nodeTypeOf(row);
        if (!child) {
          untyped += 1;
          continue;
        }
        if (skip.has(child)) continue;
        // `children` is now a restriction rather than a work list: naming types no longer decides
        // which queries run, only which of the members already in hand are drawn.
        if (allowed && !allowed.has(child)) continue;

        const node = rowToNode(
          row,
          child,
          dataset,
          shapes.find((s) => s.name === child),
          ID,
        );
        if (!node) continue;
        nodes.push(node);
        edges.push({
          id: edgeId(request.id, edgeType, node.id),
          source: request.id,
          target: node.id,
          type: edgeType,
        });
      }

      if (untyped) {
        context.warn(
          `${untyped} of ${members.length} members of this ${address.type} came back without a type and were not drawn — ` +
            `is "${via}" declared polymorphic?`,
        );
      }

      return { nodes, edges, total: nodes.length };
    },
  };
}
