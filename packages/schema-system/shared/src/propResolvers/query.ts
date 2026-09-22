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
  const { entity, subscribe: sub, dataset, include, when, ...params } = $query;
  return {
    // Left as authored. A name goes through untouched; an expression is resolved by the framework
    // layer, which is the only place a row's bindings exist — see `QueryDescriptor.entity`.
    entity,
    params,
    subscribe: sub !== false,
    dataset: dataset as string | undefined,
    ...(include !== undefined && { include: include as Record<string, boolean | Record<string, unknown>> }),
    // Not a param: the backend never sees it. The framework layer reads it before asking.
    ...(when !== undefined && { when }),
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
 * **Only `undefined` is unresolved.** An empty string is a value, and it stays — which is not what
 * {@link scopeIsAnchored} does one field along, and the asymmetry is deliberate. Widening a scope is
 * what an unanchored view wants; widening an *identity* is never what anybody wants, so a template
 * asking about a record it has no id for must be gated rather than quietly answered with whichever
 * record the backend happened to return first.
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

/**
 * Whether a resolved `scope` still names an anchor.
 *
 * The counterpart to {@link pruneUnresolvedWhere}, and the same rule one field along: an operand
 * that has not resolved means "do not narrow by this", never "narrow by nothing". The difference is
 * which way the failure falls, and it is the whole reason this exists — a `where` with a hole in it
 * is rejected by the backend and is therefore loud, whereas a scope whose `anchorId` is `undefined`
 * is a perfectly valid query for the children of no record, which returns nothing at all. Silently.
 *
 * That distinction is what lets a view carry an anchor unconditionally. A shipped view reads its
 * anchor from a URL parameter that is usually absent — `{ $: 'routeStore.params.anchor' }` — and
 * absent has to mean *the whole space*, which is what an unanchored view has always shown. Without
 * this the view would need two copies of every query behind an `$if`, or would go blank the moment
 * nobody had named a container.
 *
 * A literal empty string counts as absent too: that is what a `$localState` field holding "nothing
 * chosen yet" resolves to, and a template should not have to know the difference.
 */
export function scopeIsAnchored(scope: unknown): boolean {
  if (!scope || typeof scope !== 'object') return false;
  const anchorId = (scope as { anchorId?: unknown }).anchorId;
  // A LIST of anchors is anchored even when empty, which is the opposite of the rule above and
  // deliberately so. An empty list is a resolved answer — "the children of these zero records" —
  // where an absent anchor is an unresolved one. It arises the moment a level of a tree reads the
  // level above it (`local.replies.map(r, r.id)`) and that level is empty or has not arrived, and
  // in both readings the right answer is no rows. Widening there would draw the entire space under
  // a comment.
  if (Array.isArray(anchorId)) return true;
  return anchorId !== undefined && anchorId !== null && anchorId !== '';
}
