// Check if a value is a non-array object
export function isObject(v: unknown): boolean {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Check if a value is a primitive (null, string, number, boolean, undefined)
export function isPrimitive(v: unknown): boolean {
  return v === null || (typeof v !== 'object' && typeof v !== 'function');
}

// Deep equality check between two values
export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isPrimitive(a) || isPrimitive(b)) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (
        !(b as object).hasOwnProperty(k) ||
        !isDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
      )
        return false;
    }
    return true;
  }
  return false;
}

// Type guard & check for the presence of schema tokens
export function hasToken<T extends string>(
  value: unknown,
  token: T,
  type: 'string' | 'object' | 'array',
): value is Record<T, unknown> {
  const tokenExists = value != null && typeof value === 'object' && token in value;
  if (!tokenExists) return false;
  const tokenValue = (value as Record<T, unknown>)[token];
  if (type === 'array') return Array.isArray(tokenValue);
  return typeof tokenValue === type;
}
