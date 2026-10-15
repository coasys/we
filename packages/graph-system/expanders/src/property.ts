/**
 * The property expander — the resolution level below an entity.
 *
 * Expanding an instance here does not walk to its neighbours; it opens the instance *itself* out into
 * its own fields. That is what makes "render models as nodes, then click to see their properties" one
 * gesture in the same engine rather than a second kind of graph.
 *
 * ## Why literal values are shared nodes
 *
 * A property node holds the field; the value it points at is a {@link literalAddress}, which is
 * deliberately not dataset- or instance-scoped. So two beliefs written by the same author converge on
 * one author node, and three tasks marked `blocked` converge on one. That convergence is the entire
 * reason to promote values to nodes — otherwise a property view is a starburst that tells you nothing
 * you could not read off a card.
 */
import type { Expander, GraphEdge, GraphNode } from '@we/graph-protocol';
import { literalAddress, parseAddress, propertyAddress } from '@we/graph-protocol';

import { edgeId, labelProperty } from './nodes';

export interface PropertyExpanderOptions {
  /** Registered id. Default `property`; a second instance with values on registers as `property-values`. */
  id?: string;
  /** Properties to show. Absent means all scalars the shape declares. */
  properties?: string[];
  exclude?: string[];
  /**
   * Promote each value to its own shared node, so instances converge on common values.
   * Off means properties are leaves labelled `field: value`.
   *
   * Off by default. Convergence — three tasks meeting at one `blocked` node — is what earns a value a
   * node of its own on a map of a vocabulary, and is clutter on a canvas of work, where a card's fields
   * are read rather than compared. A graph that wants it names the `property-values` expander.
   */
  valueNodes?: boolean;
  /** Skip empty values rather than drawing a field with nothing in it. */
  hideEmpty?: boolean;
}

export function propertyExpander(options: PropertyExpanderOptions = {}): Expander {
  const { valueNodes = false, hideEmpty = true } = options;
  const ID = options.id ?? 'property';

  return {
    id: ID,
    kinds: ['entity'],
    // Below the entity expander: opening an instance should reach its neighbours first, since that is
    // what a click means on a knowledge map. Properties are the deliberate second step.
    priority: -10,
    description: 'Opens an instance out into its own scalar properties, and optionally shared value nodes.',
    async expand(request, context) {
      const address = parseAddress(request.id);
      if (!address || address.kind !== 'entity' || !address.type || !address.id) {
        return { nodes: [], edges: [] };
      }

      const dataset = address.dataset ?? context.defaultDataset() ?? '';
      const shape = context.models(dataset).find((s) => s.name === address.type);
      if (!shape) return { nodes: [], edges: [] };

      const fields = shape.properties.filter((property) => {
        if (options.exclude?.includes(property.name)) return false;
        if (options.properties && !options.properties.includes(property.name)) return false;
        // The label is already drawn on the instance node; repeating it as a child is noise.
        return property.name !== labelProperty(shape);
      });
      if (!fields.length) return { nodes: [], edges: [] };

      const rows = await context.query({
        entity: shape.name,
        dataset,
        where: { id: address.id },
        limit: 1,
        signal: request.signal,
      });
      const row = rows[0];
      if (!row) return { nodes: [], edges: [] };

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      for (const field of fields) {
        const value = row[field.name];
        if (hideEmpty && (value === null || value === undefined || value === '')) continue;

        const propertyId = propertyAddress(dataset, address.type, address.id, field.name);
        nodes.push({
          id: propertyId,
          kind: 'property',
          type: field.name,
          label: valueNodes ? field.name : `${field.name}: ${format(value)}`,
          data: { value: asScalar(value) },
          source: ID,
        });
        edges.push({
          id: edgeId(request.id, field.name, propertyId),
          source: request.id,
          target: propertyId,
          type: 'property',
          // What the line is, for a graph that draws its lines' words.
          label: 'property',
        });

        if (!valueNodes || value === null || value === undefined) continue;
        const literalId = literalAddress(asScalar(value) ?? '');
        nodes.push({
          id: literalId,
          kind: 'literal',
          type: field.type,
          label: format(value),
          data: { value: asScalar(value) },
          source: ID,
        });
        edges.push({
          id: edgeId(propertyId, 'value', literalId),
          source: propertyId,
          target: literalId,
          type: 'value',
        });
      }

      return { nodes, edges, total: nodes.length };
    },
  };
}

function asScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) return value as string | number | boolean;
  return String(value);
}

function format(value: unknown): string {
  const text = value === null || value === undefined ? '—' : String(value);
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}
