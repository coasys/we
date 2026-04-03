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
  const { model, subscribe: sub, perspectiveStore, ...params } = $query;
  return {
    model: model as string,
    params,
    subscribe: sub !== false,
    perspectiveStore: perspectiveStore as string | undefined,
  };
}
