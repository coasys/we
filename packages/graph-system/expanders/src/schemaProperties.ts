/**
 * The schema-properties expander — a model opened into what it *is*.
 *
 * `schemaExpander` answers "what records are there of this type"; this answers the question that
 * comes first on a map of a vocabulary, "what is this type": one node per property, labelled with
 * its kind, one per relation naming what it points at, and a **Records** node that opens into the
 * instances through `schema-instances`. A type with a thousand records is then one click from them
 * rather than a thousand nodes on the first.
 */
import type { Expander, GraphEdge, GraphNode } from '@we/graph-protocol';
import { entityAddress, parseAddress, propertyAddress } from '@we/graph-protocol';

import { edgeId } from './nodes';
import { INSTANCES_TYPE, SCHEMA_TYPE } from './schema';

export function schemaPropertiesExpander(): Expander {
  return {
    id: 'schema-properties',
    kinds: ['entity'],
    types: [SCHEMA_TYPE],
    // Above `schema`, which claims the same nodes; a graph names whichever question it is asking.
    priority: 30,
    description: 'Opens a type node into its properties and relations, with a Records node for its instances.',
    async expand(request, context) {
      const address = parseAddress(request.id);
      if (!address || address.kind !== 'entity' || !address.id || request.direction === 'in') {
        return { nodes: [], edges: [] };
      }
      const dataset = address.dataset ?? context.defaultDataset() ?? '';
      const shape = context.models(dataset).find((s) => s.name === address.id);
      if (!shape) {
        context.warn(`no shape named "${address.id}" in this dataset`);
        return { nodes: [], edges: [] };
      }

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      // Each line says what it joins — a field, a relation — so a map drawing labels can tell them apart.
      const add = (node: GraphNode, label: string) => {
        nodes.push(node);
        edges.push({
          id: edgeId(request.id, 'property', node.id),
          source: request.id,
          target: node.id,
          type: 'property',
          label,
        });
      };

      for (const property of shape.properties) {
        add(
          {
            id: propertyAddress(dataset, SCHEMA_TYPE, shape.name, property.name),
            kind: 'property',
            type: property.name,
            label: `${property.name} · ${property.type}${property.required ? '' : '?'}`,
            data: { field: property.name, valueType: property.type, required: property.required ?? false },
            source: 'schema-properties',
          },
          'property',
        );
      }
      for (const relation of shape.relations) {
        add(
          {
            id: propertyAddress(dataset, SCHEMA_TYPE, shape.name, relation.name),
            kind: 'property',
            type: relation.name,
            label: `${relation.name} → ${relation.target || 'anything'}${relation.cardinality === 'many' ? ' (many)' : ''}`,
            data: { field: relation.name, target: relation.target, cardinality: relation.cardinality },
            source: 'schema-properties',
          },
          'relation',
        );
      }

      const records = entityAddress(dataset, INSTANCES_TYPE, shape.name);
      nodes.push({
        id: records,
        kind: 'entity',
        type: INSTANCES_TYPE,
        label: 'Records',
        data: { entity: shape.name },
        source: 'schema-properties',
      });
      edges.push({
        id: edgeId(request.id, 'instance', records),
        source: request.id,
        target: records,
        type: 'instance',
        label: 'records',
      });

      return { nodes, edges, total: nodes.length };
    },
  };
}
