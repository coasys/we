import type { resolveProp } from './dispatcher';
import { REACTIVE_ACCESSOR } from './reactive';
import type { Memo, PluralProp, Props } from './types';

/**
 * Resolves `$plural`: returns `one` when count === 1, otherwise `other`.
 * Example: { $plural: { count: { $count: { items: { $store: 'spaceStore.members' } } }, one: 'Member', other: 'Members' } }
 */
export function resolvePluralProp(
  token: PluralProp,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): string {
  let count = resolvePropFn(token.count, stores, context, memo);
  if (typeof count === 'function' && REACTIVE_ACCESSOR in (count as object)) {
    count = (count as () => unknown)();
  }
  return Number(count) === 1 ? token.one : token.other;
}
