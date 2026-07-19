import type { QueryDescriptor } from '../types';

/**
 * Resolve a $query token into a QueryDescriptor.
 * Pure function — no framework effects, no subscriptions.
 * The framework layer (e.g. SchemaRenderer) uses the descriptor to set up
 * the subscription lifecycle with its native primitives.
 *
 * Model class lookup is deferred to the framework layer which has access
 * to the model registry (avoids schema-system → app-framework dependency).
 */
export function resolveQueryProp(value: unknown): QueryDescriptor {
  const { $query } = value as { $query: Record<string, unknown> };
  // Neutral authoring grammar all the way through: `entity` + `dataset`. `where`/`order`/`include`/
  // `limit` flow through in `params`, compiled to the IR downstream.
  const { entity, subscribe: sub, dataset, include, ...params } = $query;
  return {
    entity: entity as string,
    params,
    subscribe: sub !== false,
    dataset: dataset as string | undefined,
    ...(include !== undefined && { include: include as Record<string, boolean | Record<string, unknown>> }),
  };
}
