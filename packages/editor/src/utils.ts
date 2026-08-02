/** Structural deep clone. Local so the editor carries no dependency on the host's utilities. */
export function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
