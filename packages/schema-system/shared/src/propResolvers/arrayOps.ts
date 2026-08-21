import type { resolveProp } from './dispatcher';
import { REACTIVE_ACCESSOR } from './reactive';
import type { CountProp, FilterProp, FindProp, Memo, Props } from './types';

/**
 * Evaluate a `where` predicate record against a single item.
 *
 * Mirrors the AD4M model query `where` operator set so in-memory filtering
 * ($filter) uses the same vocabulary as SPARQL-backed $query filtering:
 *
 *   { field: value }              — strict equality
 *   { field: [a, b] }             — set membership; matches any of them
 *   { field: { not: value } }     — inequality (value or array of excluded values)
 *   { field: { contains: 'x' } }  — case-insensitive substring match
 *   { field: { exists: true } }   — non-null / non-undefined presence check
 *
 * Where-values are resolved through `resolvePropFn` so that context refs
 * (`$item.id`), `$store`, and `$local` all work as comparison values.
 */
function matchesWhere(
  item: unknown,
  where: Record<string, unknown>,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): boolean {
  const itemRecord = item as Record<string, unknown>;
  for (const [key, rawValue] of Object.entries(where)) {
    // Logical combinators, mirroring $query's where grammar: branches are full
    // where-clauses; siblings at the same level stay implicitly ANDed. Added
    // because $filter's lack of OR forced single-field searches (a member list
    // matching handle only while the spaces list beside it matched name OR
    // description).
    if (key === 'OR') {
      if (!Array.isArray(rawValue)) return false;
      if (
        !rawValue.some(
          (branch) =>
            branch !== null &&
            typeof branch === 'object' &&
            matchesWhere(item, branch as Record<string, unknown>, stores, context, memo, resolvePropFn),
        )
      )
        return false;
      continue;
    }
    if (key === 'AND') {
      if (!Array.isArray(rawValue)) return false;
      if (
        !rawValue.every(
          (branch) =>
            branch !== null &&
            typeof branch === 'object' &&
            matchesWhere(item, branch as Record<string, unknown>, stores, context, memo, resolvePropFn),
        )
      )
        return false;
      continue;
    }
    if (key === 'NOT') {
      if (rawValue === null || typeof rawValue !== 'object') return false;
      if (matchesWhere(item, rawValue as Record<string, unknown>, stores, context, memo, resolvePropFn)) return false;
      continue;
    }

    const actual = itemRecord?.[key];

    if (rawValue !== null && typeof rawValue === 'object') {
      const op = rawValue as Record<string, unknown>;

      // { exists: true/false }
      if ('exists' in op) {
        const shouldExist = !!op['exists'];
        const isPresent = actual !== undefined && actual !== null;
        if (isPresent !== shouldExist) return false;
        continue;
      }

      // { contains: <resolvable string> } — case-insensitive substring
      if ('contains' in op) {
        let needle = resolvePropFn(op['contains'], stores, context, memo);
        if (typeof needle === 'function' && REACTIVE_ACCESSOR in (needle as object))
          needle = (needle as () => unknown)();
        if (
          !String(actual ?? '')
            .toLowerCase()
            .includes(String(needle ?? '').toLowerCase())
        )
          return false;
        continue;
      }

      /*
        { startsWith: … } / { endsWith: … } — anchored, case-sensitive.

        Case-sensitive where `contains` above is not, because these two exist to match structured
        strings against a known prefix: an ISO date out of a datetime, an id out of a URI. Folding
        case there would be wrong in a way nobody would notice until it matched something it should
        not have. `contains` is a search over prose, which is a different question.

        Their absence is what made `$filter` and `$query` disagree despite the docs promising the
        same operator set — a day cell asking "any events here" through `$filter` matched nothing
        while the same clause pushed down to the backend worked.
      */
      for (const anchor of ['startsWith', 'endsWith'] as const) {
        if (!(anchor in op)) continue;
        let prefix = resolvePropFn(op[anchor], stores, context, memo);
        if (typeof prefix === 'function' && REACTIVE_ACCESSOR in (prefix as object))
          prefix = (prefix as () => unknown)();
        const haystack = String(actual ?? '');
        const needle = String(prefix ?? '');
        if (anchor === 'startsWith' ? !haystack.startsWith(needle) : !haystack.endsWith(needle)) return false;
      }
      if ('startsWith' in op || 'endsWith' in op) continue;

      // { not: <resolvable value | array> }
      if ('not' in op) {
        let notVal = resolvePropFn(op['not'], stores, context, memo);
        if (typeof notVal === 'function' && REACTIVE_ACCESSOR in (notVal as object))
          notVal = (notVal as () => unknown)();
        if (Array.isArray(notVal)) {
          if (notVal.includes(actual)) return false;
        } else {
          if (actual === notVal) return false;
        }
        continue;
      }
    }

    /*
      Default: strict equality — or set membership when the expected value is a list.

      A bare array is the positive form of `not: [...]`, and `$query` has always compiled one to the
      IR's `in` (see `queryCompiler`'s `fieldCondition`), which the AD4M adapter declares native and
      the executor pushes down as a SPARQL `VALUES` clause. `$filter` did not, so `where: { id: [a, b] }`
      compared a value against the array *object*, matched nothing, and did it silently.

      Exactly the divergence the anchored matchers above describe, for the same reason: the docs
      promise one operator set across `$filter` and `$query`, and every operator that exists on only
      one side is a clause that works until somebody moves it. Nothing is lost by treating an array
      this way — strict equality against one could never have matched, since arrays compare by
      reference.
    */
    let expected = resolvePropFn(rawValue, stores, context, memo);
    if (typeof expected === 'function' && REACTIVE_ACCESSOR in (expected as object)) {
      expected = (expected as () => unknown)();
    }
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

/**
 * Resolves `$filter`: returns the subset of `items` where all `where` conditions match.
 */
export function resolveFilterProp(
  token: FilterProp,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  let arr = resolvePropFn(token.items, stores, context, memo);
  if (typeof arr === 'function' && REACTIVE_ACCESSOR in (arr as object)) {
    arr = (arr as () => unknown)();
  }
  if (!Array.isArray(arr)) return [];
  const matched = (arr as unknown[]).filter((item) =>
    matchesWhere(item, token.where, stores, context, memo, resolvePropFn),
  );

  if (token.limit === undefined) return matched;
  let limit = resolvePropFn(token.limit, stores, context, memo);
  if (typeof limit === 'function' && REACTIVE_ACCESSOR in (limit as object)) limit = (limit as () => unknown)();
  // A limit that did not resolve to a number is a template bug, and silently returning nothing
  // would read as "no matches" — the failure this whole file's operators are prone to. Keep them
  // all instead, so the mistake is visible as too much rather than invisible as too little.
  return typeof limit === 'number' && limit >= 0 ? matched.slice(0, limit) : matched;
}

/**
 * Resolves `$count`: returns the length of the resolved `items` array.
 */
export function resolveCountProp(
  token: CountProp,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): number {
  let arr = resolvePropFn(token.items, stores, context, memo);
  if (typeof arr === 'function' && REACTIVE_ACCESSOR in (arr as object)) {
    arr = (arr as () => unknown)();
  }
  return Array.isArray(arr) ? arr.length : 0;
}

/**
 * Resolves `$find`: returns the first item matching `where`.
 * If `select` is specified, returns `item[select]` instead of the item itself.
 * Returns `undefined` if no match is found.
 */
export function resolveFindProp(
  token: FindProp,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  let arr = resolvePropFn(token.items, stores, context, memo);
  if (typeof arr === 'function' && REACTIVE_ACCESSOR in (arr as object)) {
    arr = (arr as () => unknown)();
  }
  if (!Array.isArray(arr)) return undefined;
  const match = token.where
    ? arr.find((item) => matchesWhere(item, token.where!, stores, context, memo, resolvePropFn))
    : arr[0];
  if (match === undefined) return undefined;
  return token.select ? (match as Record<string, unknown>)[token.select] : match;
}
