/** Symbol used to tag reactive accessors (signals, memos) so the renderer can distinguish them from event handlers */
export const REACTIVE_ACCESSOR = Symbol('schema-reactive-accessor');

export function markReactive<T>(value: T): T {
  if (typeof value === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (value as any)[REACTIVE_ACCESSOR] = true;
  }
  return value;
}

/**
 * A cyclic structure would otherwise recurse forever; ten levels is deeper than any
 * real schema value while still bounding the walk.
 */
const MAX_UNWRAP_DEPTH = 10;

/**
 * Recursively unwrap reactive accessors (marked with REACTIVE_ACCESSOR) inside
 * complex values so consumers receive plain data instead of leaked signal
 * functions. Event handlers and other plain functions pass through untouched.
 *
 * When called inside a tracked computation (the renderer's createMemo /
 * createEffect), calling accessors here registers them as dependencies — so
 * reactivity is preserved without wrapping each value in its own memo. The
 * action dispatcher calls it untracked, which is equally correct: it wants the
 * current plain value at call time.
 *
 * Non-plain objects (File, Blob, Date, DOM nodes, class instances) are passed
 * through without deconstruction; `Object.create(null)` objects count as plain.
 * This was previously implemented twice — here and in the Solid renderer — with
 * the copies disagreeing on exactly those two points (the depth guard and the
 * plain-object test), which is why there is now one implementation.
 */
export function deepUnwrap(value: unknown, depth = 0): unknown {
  if (depth > MAX_UNWRAP_DEPTH) return value;
  if (typeof value === 'function' && REACTIVE_ACCESSOR in value) {
    return deepUnwrap((value as unknown as () => unknown)(), depth + 1);
  }
  if (typeof value === 'function') return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepUnwrap(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deepUnwrap(v, depth + 1);
    }
    return result;
  }
  return value;
}
