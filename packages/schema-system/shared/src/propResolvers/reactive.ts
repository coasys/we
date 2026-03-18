/** Symbol used to tag reactive accessors (signals, memos) so the renderer can distinguish them from event handlers */
export const REACTIVE_ACCESSOR = Symbol('schema-reactive-accessor');

export function markReactive<T>(value: T): T {
  if (typeof value === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (value as any)[REACTIVE_ACCESSOR] = true;
  }
  return value;
}
