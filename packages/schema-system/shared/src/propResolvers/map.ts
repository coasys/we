import type { resolveProp } from './dispatcher';
import { markReactive } from './reactive';
import type { MapProp, Memo, Props } from './types';

// Resolves $map props: { $map: { items: { "$store": "templateStore.templates" }, select: { "name": "$item.meta.name", "icon": "$item.meta.icon" } } }
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

      // Handle arrays - map over each item
      if (Array.isArray(resolvedItems)) {
        return resolvedItems.map((item) => {
          const result: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(map.select)) {
            if (typeof value === 'string' && value.startsWith('$item.')) {
              const path = value.slice(6).split('.');
              let current = item;
              for (const p of path) current = current?.[p];
              result[key] = current;
            } else {
              result[key] = value;
            }
          }
          return result;
        });
      }

      // Handle single object - transform it
      if (resolvedItems && typeof resolvedItems === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(map.select)) {
          if (typeof value === 'string' && value.startsWith('$item.')) {
            const path = value.slice(6).split('.');
            let current = resolvedItems;
            for (const p of path) current = current?.[p];
            result[key] = current;
          } else {
            result[key] = value;
          }
        }
        return result;
      }

      // Return empty array for null/undefined
      return [];
    }),
  );
}
