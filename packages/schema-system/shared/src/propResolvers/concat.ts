import type { resolveProp } from './dispatcher';
import { markReactive } from './reactive';
import type { Memo, Props } from './types';

/** Resolves $concat tokens: { $concat: ["/space/", "$item.uuid"] } → "/space/abc123" */
export function resolveConcatProp(
  parts: unknown[],
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  return markReactive(
    memo(() => {
      return parts
        .map((part) => {
          const resolved = resolvePropFn(part, stores, context, memo);
          const val = typeof resolved === 'function' ? resolved() : resolved;
          return val == null ? '' : String(val);
        })
        .join('');
    }),
  );
}
