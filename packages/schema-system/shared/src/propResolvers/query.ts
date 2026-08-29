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
    // Left as authored. A name goes through untouched; an expression is resolved by the framework
    // layer, which is the only place a row's bindings exist — see `QueryDescriptor.entity`.
    entity,
    params,
    subscribe: sub !== false,
    dataset: dataset as string | undefined,
    ...(include !== undefined && { include: include as Record<string, boolean | Record<string, unknown>> }),
  };
}

/**
 * Drop where-conditions whose operands did not resolve.
 *
 * A reactive reference in a where clause — `url: { not: { $store:
 * 'datasetStore.currentDatasetCid' } }` — legitimately resolves to `undefined`
 * for a frame (boot, dataset switch) or permanently (a store the host doesn't
 * carry). Serialized, `{ not: undefined }` becomes the empty condition `{}`,
 * which a backend's parser rightly refuses ("data did not match any variant of
 * untagged enum WhereCondition"). An unresolved input means "don't filter on
 * this yet", not "send a filter with a hole in it" — the effect re-runs and
 * applies the real filter once the value exists.
 *
 * Returns the pruned clause, or `undefined` when nothing survives.
 */
export function pruneUnresolvedWhere(where: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;

    // Logical combinators hold whole clauses — prune each branch, keep survivors.
    if (key === 'OR' || key === 'AND') {
      if (!Array.isArray(value)) continue;
      const branches = value
        .map((branch) =>
          branch && typeof branch === 'object' ? pruneUnresolvedWhere(branch as Record<string, unknown>) : undefined,
        )
        .filter((branch): branch is Record<string, unknown> => branch !== undefined);
      if (branches.length) out[key] = branches;
      continue;
    }
    if (key === 'NOT') {
      const pruned =
        value && typeof value === 'object' ? pruneUnresolvedWhere(value as Record<string, unknown>) : undefined;
      if (pruned !== undefined) out[key] = pruned;
      continue;
    }

    // Operator objects ({ not, contains, exists, … }) — keep only resolved operands.
    // `null` stays: it is a value ("equals null"), only `undefined` means unresolved.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ops = Object.entries(value as Record<string, unknown>).filter(([, operand]) => operand !== undefined);
      if (ops.length) out[key] = Object.fromEntries(ops);
      continue;
    }

    out[key] = value;
  }

  return Object.keys(out).length ? out : undefined;
}
