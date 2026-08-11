/**
 * Seed sources — where a graph starts.
 *
 * `query` is the workhorse: point it at an entity type and you have a knowledge map over real data
 * with no exploration vocabulary in the template at all. `schema` is the one that answers "lots of
 * model types" directly — it maps the *shapes* rather than the instances, so a class installed by an
 * interpretation run appears on the map without anyone editing a template.
 */
import type { EntityShape, GraphEdge, GraphNode, SeedSource } from '@we/graph-protocol';
import { datasetAddress, entityAddress } from '@we/graph-protocol';

import { edgeId, rowToNode } from './nodes';
import { endpointRelations, isReified, reifiedEdgeFrom, type ReifiedEdgeMap } from './reified';
import { SCHEMA_TYPE } from './schema';

export interface QuerySeedOptions {
  /** Entity type to load. */
  entity: string;
  dataset?: string;
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  /**
   * Relations to hydrate and draw as edges immediately, before any expansion.
   * A map with `defaultDepth: 0` and one relation here is the cheapest useful graph there is.
   */
  relations?: string[];
  /**
   * Entities that are really edges — see `reified.ts`.
   *
   * Seeding one directly is how you draw "every tagged message in this space" in a single query: the
   * relationships come back as edges with their endpoints attached, rather than as a field of dots.
   */
  reified?: ReifiedEdgeMap;
}

/** Instances of one entity type, optionally with some relations already drawn. */
export function querySeed(defaults: { reified?: ReifiedEdgeMap } = {}): SeedSource {
  return {
    id: 'query',
    description: 'Loads instances of an entity type as nodes, optionally drawing named relations.',
    async seed(rawOptions, context, signal) {
      const options = rawOptions as QuerySeedOptions;
      if (!options?.entity) {
        context.warn('query seed needs an "entity"');
        return { nodes: [], edges: [] };
      }
      const dataset = options.dataset ?? context.defaultDataset() ?? '';
      const shapes = context.models(dataset);
      const shape = shapes.find((s) => s.name === options.entity);
      const reified = options.reified ?? defaults.reified;
      const seedingAnEdge = isReified(options.entity, reified);

      const include: Record<string, unknown> = {};
      for (const relation of options.relations ?? []) include[relation] = true;
      // Seeding a reified class means seeding *edges*: both endpoints have to come back with it, or
      // there is nothing to attach them to.
      if (seedingAnEdge) for (const name of endpointRelations(options.entity, reified!)) include[name] = true;

      const rows = await context.query({
        entity: options.entity,
        dataset,
        where: options.where,
        order: options.order,
        limit: options.limit ?? 100,
        include: Object.keys(include).length ? include : undefined,
        signal,
      });

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      if (seedingAnEdge) {
        for (const row of rows) {
          const resolved = reifiedEdgeFrom(row, options.entity, reified![options.entity], dataset, shapes, 'query');
          if (!resolved) {
            context.warn(`${options.entity} ${String(row.id)} is missing an endpoint — skipped`);
            continue;
          }
          nodes.push(...resolved.nodes);
          edges.push(resolved.edge);
        }
        return { nodes, edges, total: rows.length };
      }

      for (const row of rows) {
        const node = rowToNode(row, options.entity, dataset, shape, 'query');
        if (!node) continue;
        nodes.push(node);

        for (const relationName of options.relations ?? []) {
          const relation = shape?.relations.find((r) => r.name === relationName);
          if (!relation) continue;
          const value = row[relationName];
          const targets = Array.isArray(value) ? value : value == null ? [] : [value];
          for (const target of targets) {
            const targetId =
              typeof target === 'string'
                ? target
                : typeof target === 'object' && target !== null && typeof (target as { id?: unknown }).id === 'string'
                  ? (target as { id: string }).id
                  : undefined;
            if (!targetId) continue;
            const targetShape = context.models(dataset).find((s) => s.name === relation.target);
            const targetNode =
              typeof target === 'object' && target !== null
                ? rowToNode(target as Record<string, unknown>, relation.target, dataset, targetShape, 'query')
                : {
                    id: entityAddress(dataset, relation.target, targetId),
                    kind: 'entity' as const,
                    type: relation.target,
                    label: relation.target,
                    unresolved: true,
                    source: 'query',
                  };
            if (!targetNode) continue;
            nodes.push(targetNode);
            edges.push({
              id: edgeId(node.id, relationName, targetNode.id),
              source: node.id,
              target: targetNode.id,
              type: relationName,
            });
          }
        }
      }

      return { nodes, edges, total: rows.length };
    },
  };
}

export interface SchemaSeedOptions {
  dataset?: string;
  /** Restrict to these entity types. Absent means every shape the dataset declares. */
  entities?: string[];
  /** Draw a node per relation count, so the map shows how populated each type is. */
  withCounts?: boolean;
}

/**
 * The dataset's *shape*, as a graph: one node per entity type, one edge per declared relation.
 *
 * This is the answer to a space whose vocabulary is open-ended. Interpretation installs classes as
 * data, so the set of things a community talks about is not knowable when a template is written — and
 * a map built from the schema rather than from a fixed list simply shows whatever is there, including
 * classes added after the template was authored.
 */
export function schemaSeed(): SeedSource {
  return {
    id: 'schema',
    description: "Maps the dataset's own entity types and the relations between them.",
    async seed(rawOptions, context) {
      const options = (rawOptions ?? {}) as SchemaSeedOptions;
      const dataset = options.dataset ?? context.defaultDataset() ?? '';
      const shapes = context
        .models(dataset)
        .filter((shape) => !options.entities || options.entities.includes(shape.name));

      const nodes: GraphNode[] = shapes.map((shape) => ({
        // A type is addressed as an instance of the meta-level: `entity/<dataset>/$schema/<Name>`.
        // Reusing the entity address keeps one addressing scheme rather than minting a parallel one
        // that everything downstream would have to learn.
        id: entityAddress(dataset, SCHEMA_TYPE, shape.name),
        kind: 'entity' as const,
        type: SCHEMA_TYPE,
        label: shape.name,
        data: {
          entity: shape.name,
          properties: shape.properties.length,
          relations: shape.relations.length,
          description: shape.description ?? null,
        },
        source: 'schema',
      }));

      const known = new Set(shapes.map((s) => s.name));
      const edges: GraphEdge[] = [];
      for (const shape of shapes) {
        for (const relation of shape.relations) {
          if (!known.has(relation.target)) continue;
          const source = entityAddress(dataset, SCHEMA_TYPE, shape.name);
          const target = entityAddress(dataset, SCHEMA_TYPE, relation.target);
          edges.push({
            id: edgeId(source, relation.name, target),
            source,
            target,
            type: relation.name,
            label: relation.name,
            data: { cardinality: relation.cardinality },
          });
        }
      }

      return { nodes, edges, total: nodes.length };
    },
  };
}

/** The current space as a single node — the seed a holonic explorer starts from. */
export function datasetSeed(): SeedSource {
  return {
    id: 'dataset',
    description: 'Seeds the graph with a dataset node, as the starting point for exploring spaces.',
    async seed(rawOptions, context) {
      const options = (rawOptions ?? {}) as { dataset?: string; label?: string };
      const dataset = options.dataset ?? context.defaultDataset();
      if (!dataset) {
        context.warn('dataset seed: no dataset in scope');
        return { nodes: [], edges: [] };
      }
      return {
        nodes: [
          {
            id: datasetAddress(dataset),
            kind: 'dataset',
            type: 'dataset',
            label: options.label ?? 'This space',
            source: 'dataset',
          },
        ],
        edges: [],
        total: 1,
      };
    },
  };
}

/** Shapes as the engine sees them — re-exported so hosts can build the context without the protocol. */
export type { EntityShape };
