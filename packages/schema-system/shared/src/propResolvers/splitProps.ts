// Splits props into safe (primitive) and complex (object/array) props for web component handling
export function splitProps(all: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  const complex: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(all)) {
    if (v === null || ['boolean', 'string', 'number', 'function'].includes(typeof v)) safe[k] = v;
    else complex[k] = v;
  }
  return { safeProps: safe, complexProps: complex };
}
