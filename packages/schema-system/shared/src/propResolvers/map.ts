import type { resolveProp } from './dispatcher';
import { markReactive, REACTIVE_ACCESSOR } from './reactive';
import type { MapProp, Memo, Props } from './types';

/**
 * Resolve `$item.*` references in a value tree, replacing them with concrete values from `item`.
 * Handles strings, arrays, and nested objects recursively.
 */
function resolveItemRefs(value: unknown, item: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('$item.')) {
    const path = value.slice(6).split('.');
    let current = item;
    for (const p of path) current = (current as Record<string, unknown>)?.[p];
    return current;
  }
  if (Array.isArray(value)) return value.map((v) => resolveItemRefs(v, item));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) result[k] = resolveItemRefs(v, item);
    return result;
  }
  return value;
}

/**
 * Process a single select entry: fast path for `$item.*` strings, otherwise resolve item refs
 * then delegate to the full prop resolver for token support ($if, $action, $expr, etc.).
 */
function resolveSelectValue(
  value: unknown,
  item: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  // Fast path: simple $item.foo string → direct property access
  if (typeof value === 'string' && value.startsWith('$item.')) {
    const path = value.slice(6).split('.');
    let current = item;
    for (const p of path) current = (current as Record<string, unknown>)?.[p];
    return current;
  }
  // Literal primitives (strings without $item, numbers, booleans, null)
  if (typeof value !== 'object' || value === null) return value;
  // Object/array: resolve $item refs first, then run through prop resolver for tokens
  // Inject `item` into context so $expr can reference it (e.g. { "$expr": "'/space/' + item.id" })
  const itemContext = { ...context, item };
  const withItemsResolved = resolveItemRefs(value, item);
  return resolvePropFn(withItemsResolved, stores, itemContext, memo);
}

// Resolves $map props: { $map: { items: <source>, select: { <key>: '<value>' | '$item.<path>' | <token> } } }
export function resolveMapProp(
  map: MapProp,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  return markReactive(
    memo(() => {
      const items = resolvePropFn(map.items, stores, context, memo);
      const resolvedItems = typeof items === 'function' ? items() : items;

      const mapItem = (item: unknown) => {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(map.select)) {
          const resolved = resolveSelectValue(value, item, stores, context, memo, resolvePropFn);
          // Unwrap reactive accessors (signals/memos from $if, $eq, etc.) but leave
          // plain functions (e.g. $action handlers) intact so they remain callable.
          const unwrapped = typeof resolved === 'function' && REACTIVE_ACCESSOR in resolved ? resolved() : resolved;
          // Compose event handler arrays (e.g. onClick: [fn1, fn2]) into a single callable,
          // matching the same behaviour as SchemaRenderer and the dispatcher's on* handling.
          if (Array.isArray(unwrapped) && key.length > 2 && key.startsWith('on') && key[2] === key[2].toUpperCase()) {
            result[key] = (...args: unknown[]) => {
              for (const fn of unwrapped) {
                if (typeof fn === 'function') fn(...args);
              }
            };
          } else {
            result[key] = unwrapped;
          }
        }
        return result;
      };

      // Handle arrays - map over each item
      if (Array.isArray(resolvedItems)) return resolvedItems.map(mapItem);

      // Handle single object - transform it
      if (resolvedItems && typeof resolvedItems === 'object') return mapItem(resolvedItems);

      // Return empty array for null/undefined
      return [];
    }),
  );
}
