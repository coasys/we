/**
 * Indented JSON for a person to read, with any array of plain numbers kept on one line.
 *
 * `JSON.stringify(value, null, 2)` puts every element of an array on a line of its own, so a byte
 * array — a key, a bitfield, a DHT arc — becomes a column of numbers taller than the screen. What
 * these diagnostics are shown in folds on structure, and a list of numbers is not structure.
 */
export function toReadableJson(value: unknown): string {
  return render(value, '');
}

function render(value: unknown, indent: string): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => typeof item === 'number')) return `[${value.join(', ')}]`;
    return `[\n${value.map((item) => inner + render(item, inner)).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, inner)}`);
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
