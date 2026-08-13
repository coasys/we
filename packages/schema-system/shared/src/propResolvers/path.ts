import { REACTIVE_ACCESSOR } from './reactive';

/**
 * Walk a dot-separated property path starting from `root`, calling signal
 * accessors (functions) at each step so reactive values are unwrapped.
 *
 * Used by both $store and $local resolvers so nested-path traversal stays
 * in one place.
 *
 * @example
 * // $store: 'spaceStore.selectedPin.kind'
 * walkPath(stores['spaceStore'], ['selectedPin', 'kind'])
 *
 * // $local: 'selectedPin.kind'  (root = localState['selectedPin'])
 * walkPath(localState['selectedPin'](), ['kind'])
 */
export function walkPath(root: unknown, segments: string[]): unknown {
  let current = root;
  for (const prop of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    if (!(prop in (current as object))) return undefined;
    const val = (current as Record<string, unknown>)[prop];

    /*
      Call **tagged** accessors only.

      This used to invoke any function it walked past, which made `$store` an execution channel: a
      template naming a zero-argument store method resolved it by *calling* it, during paint, with
      no click and no user intent. `{ $store: 'sessionStore.logout' }` on any prop logged you out
      while the page was drawing.

      `markReactive` already existed as the way a value says "I am a signal, read me" — the host
      tags state accessors when it builds a template's bag, and nothing else. So an action in the
      bag is a function the resolver walks past without touching, and a hostile path resolves to
      nothing rather than to a side effect.

      Untagged functions resolve to `undefined` rather than to themselves: a bare function reaching
      a component prop is a callable a template has no legitimate way to have produced, and handing
      one over would put back the channel this closes.
    */
    if (typeof val === 'function') {
      if (!(REACTIVE_ACCESSOR in val)) return undefined;
      current = (val as unknown as () => unknown)();
      continue;
    }
    current = val;
  }
  return current;
}
