import type { resolveProp } from './dispatcher';
import { markReactive } from './reactive';
import type { Memo, PickProp, Props } from './types';

// Resolves $pick props: { $pick: { from: { "$store": "userStore.profile" }, props: ["name", "email"] } }
export function resolvePickProp(
  pick: PickProp,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  return markReactive(
    memo(() => {
      // Resolve the source object
      const source = resolvePropFn(pick.from, stores, context, memo);
      // If source is an accessor, call it
      const resolvedSource = typeof source === 'function' ? source() : source;
      if (typeof resolvedSource !== 'object' || resolvedSource === null) return {};
      // Pick the specified props, wrapping each in a memo accessor
      const result: Record<string, unknown> = {};
      for (const key of pick.props) result[key] = (resolvedSource as Record<string, unknown>)[key];
      return result;
    }),
  );
}
