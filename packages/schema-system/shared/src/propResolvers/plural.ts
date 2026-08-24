import type { resolveProp } from './dispatcher';
import { markReactive, REACTIVE_ACCESSOR } from './reactive';
import type { Memo, PluralProp, Props } from './types';

/**
 * Resolves `$plural`: returns `one` when count === 1, otherwise `other`.
 *
 * Example: `{ $plural: { count: { $count: { items: { $store: 'spaceStore.members' } } }, one: 'Member', other: 'Members' } }`
 *
 * Reactive, like `$concat` beside it, and that is a correction rather than a refinement. This used
 * to resolve its count once and return a plain string, so the word was chosen on first render and
 * never revisited — while a sibling `{ $store: … }` printing the same count updated normally. The
 * result was "2 extraction processed" and "2 Member": the number right, the noun frozen at whatever
 * it was when the row first appeared.
 *
 * Anything reading a live count is affected, which is most uses of this token — a plural exists to
 * agree with a number, and a number worth pluralising is usually one that changes.
 */
export function resolvePluralProp(
  token: PluralProp,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): string | (() => string) {
  /*
    Always wrapped in the memo, exactly as `$concat` does it — what comes back depends on the memo.

    Under a framework memo (Solid's `createMemo`) this is an accessor, which is the whole point.
    Under the default eager `noMemo` it is a plain string, and `markReactive` passes a non-function
    through untouched, so a non-reactive consumer sees exactly what it saw before.

    Reactivity does not come from the count resolving to an accessor — `$store` walks its path and
    returns a *value*. It comes from re-resolving the count inside the memo, so the word is
    re-picked whenever anything it read has changed. An earlier attempt tried to detect a "live"
    count up front and skip the wrapper otherwise; it was reading its own resolution wrong and never
    took the reactive branch at all.
  */
  return markReactive(
    memo(() => {
      let count = resolvePropFn(token.count, stores, context, memo);
      if (typeof count === 'function' && REACTIVE_ACCESSOR in (count as object)) {
        count = (count as () => unknown)();
      }
      return Number(count) === 1 ? token.one : token.other;
    }),
  );
}
