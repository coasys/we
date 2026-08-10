/**
 * The schema expander — from a *type* to its instances.
 *
 * The seed that maps a dataset's vocabulary produces nodes standing for entity types rather than for
 * records, and the first thing anyone does on such a map is click one. Without this that click
 * reached the entity expander, which looked for a shape literally named `$schema`, found none, and
 * warned — technically correct and useless.
 *
 * With it the two maps become one gesture: start from the shapes, open the one you care about, and
 * you are in a knowledge map of its records, with the ordinary entity expander taking over from
 * there. That is the resolution ladder the engine exists for, applied to the level above entities.
 */
import type { Expander, GraphEdge, GraphNode } from '@we/graph-protocol';
import { entityAddress, parseAddress } from '@we/graph-protocol';

import { edgeId, rowToNode } from './nodes';

/** The pseudo-type the schema seed gives its nodes. Shared so the two cannot drift apart. */
export const SCHEMA_TYPE = '$schema';

export interface SchemaExpanderOptions {
  /** Instances to load per type. */
  limit?: number;
  /** Edge type drawn from the type node to each instance. */
  edgeType?: string;
}

export function schemaExpander(options: SchemaExpanderOptions = {}): Expander {
  const edgeType = options.edgeType ?? 'instance';

  return {
    id: 'schema',
    kinds: ['entity'],
    types: [SCHEMA_TYPE],
    // Above the entity expander, which would otherwise claim these nodes and find no shape for them.
    priority: 20,
    description: 'Opens an entity-type node from the schema map into instances of that type.',
    async expand(request, context) {
      const address = parseAddress(request.id);
      if (!address || address.kind !== 'entity' || !address.id) return { nodes: [], edges: [] };

      // The seed puts the real entity name in `id`; `data.entity` carries it too, but the address is
      // the one thing guaranteed to survive a round trip through persisted state.
      const entity = address.id;
      const dataset = address.dataset ?? context.defaultDataset() ?? '';
      const shape = context.models(dataset).find((s) => s.name === entity);
      if (!shape) {
        context.warn(`no shape named "${entity}" in this dataset`);
        return { nodes: [], edges: [] };
      }

      const limit = request.limit ?? options.limit ?? 25;
      const rows = await context.query({
        entity,
        dataset,
        limit,
        offset: request.cursor ? Number(request.cursor) : undefined,
        signal: request.signal,
      });

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const typeNode = entityAddress(dataset, SCHEMA_TYPE, entity);

      for (const row of rows) {
        const node = rowToNode(row, entity, dataset, shape, 'schema');
        if (!node) continue;
        nodes.push(node);
        edges.push({ id: edgeId(typeNode, edgeType, node.id), source: typeNode, target: node.id, type: edgeType });
      }

      // A full page probably means more behind it. Reporting a cursor without knowing the total is
      // honest — `total` stays undefined, so the UI says "more" rather than inventing a number.
      const cursor = rows.length === limit ? String((request.cursor ? Number(request.cursor) : 0) + limit) : undefined;
      return { nodes, edges, cursor };
    },
  };
}
