export function asVoid<T extends unknown[]>(fn: (...args: T) => unknown): (...args: T) => void {
  // Wraps a function to ensure it returns void
  // Useful for SolidJS setters that expect a void return type
  return (...args: T) => {
    fn(...args);
    return;
  };
}

export function clone<T>(value: T): T {
  // Shallowly clones an object or array
  // Useful for ensuring reactivity in SolidJS setter by creating new references
  if (Array.isArray(value)) {
    // Clone each item in the array (shallow clone for objects)
    return value.map((item) => (typeof item === 'object' && item !== null ? { ...item } : item)) as T;
  }
  if (typeof value === 'object' && value !== null) {
    return { ...value };
  }
  return value;
}

/**
 * Deep clone, via JSON round-trip.
 *
 * `structuredClone` was tried here and reverted, and the reason is worth stating rather than leaving
 * as a commented-out line: callers clone Solid stores, which are proxies, and `structuredClone`
 * throws `DataCloneError` on a proxy. The caller then aborts and the mutation silently does not
 * happen. See `@we/editor`'s copy, which reintroduced the same bug and produced exactly that symptom.
 */
export function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
