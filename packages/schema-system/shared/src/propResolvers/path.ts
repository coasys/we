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
    current = typeof val === 'function' ? (val as () => unknown)() : val;
  }
  return current;
}
