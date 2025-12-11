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

export function deepClone<T>(val: T): T {
  // if (typeof (globalThis as any).structuredClone === 'function') return (globalThis as any).structuredClone(val);
  return JSON.parse(JSON.stringify(val));
}
