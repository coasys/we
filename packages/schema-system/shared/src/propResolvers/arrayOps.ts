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

    // Default: strict equality
    let expected = resolvePropFn(rawValue, stores, context, memo);
    if (typeof expected === 'function' && REACTIVE_ACCESSOR in (expected as object)) {
      expected = (expected as () => unknown)();
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
  return (arr as unknown[]).filter((item) => matchesWhere(item, token.where, stores, context, memo, resolvePropFn));
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
  const arr = resolvePropFn(token.items, stores, context, memo) as unknown[];
  if (!Array.isArray(arr)) return undefined;
  const match = token.where
    ? arr.find((item) => matchesWhere(item, token.where!, stores, context, memo, resolvePropFn))
    : arr[0];
  if (match === undefined) return undefined;
  return token.select ? (match as Record<string, unknown>)[token.select] : match;
}
