/**
 * The where-object grammar, evaluated against one item, with every value already resolved.
 *
 * One vocabulary in three places — `$query`'s `where`, the `$filter`/`$find` operators, and the
 * `filter`/`find` library functions — and the docs promise it is the same set everywhere. The
 * operator resolvers used to carry their own copy, resolving each value lazily per item; this is the
 * pure half, shared, so the expression library and the operators cannot disagree about what
 * `{ contains: … }` means.
 *
 *   { field: value }                 — strict equality
 *   { field: [a, b] }                — set membership
 *   { field: { not: value | [] } }   — inequality, or exclusion from a set
 *   { field: { contains: 'x' } }     — case-insensitive substring
 *   { field: { startsWith: 'x' } }   — anchored, case-sensitive
 *   { field: { endsWith: 'x' } }     — anchored, case-sensitive
 *   { field: { exists: true } }      — non-null presence
 *   { OR: [ … ] } / { AND: [ … ] } / { NOT: { … } }
 */
export function matchesWhere(item: unknown, where: Record<string, unknown>): boolean {
  const record = item as Record<string, unknown> | null | undefined;

  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR') {
      if (!Array.isArray(expected)) return false;
      if (!expected.some((branch) => isRecord(branch) && matchesWhere(item, branch))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!Array.isArray(expected)) return false;
      if (!expected.every((branch) => isRecord(branch) && matchesWhere(item, branch))) return false;
      continue;
    }
    if (key === 'NOT') {
      if (!isRecord(expected)) return false;
      if (matchesWhere(item, expected)) return false;
      continue;
    }

    const actual = record?.[key];

    if (isRecord(expected)) {
      if ('exists' in expected) {
        const present = actual !== undefined && actual !== null;
        if (present !== !!expected.exists) return false;
        continue;
      }
      if ('contains' in expected) {
        if (
          !String(actual ?? '')
            .toLowerCase()
            .includes(String(expected.contains ?? '').toLowerCase())
        )
          return false;
        continue;
      }
      let anchored = false;
      if ('startsWith' in expected) {
        anchored = true;
        if (!String(actual ?? '').startsWith(String(expected.startsWith ?? ''))) return false;
      }
      if ('endsWith' in expected) {
        anchored = true;
        if (!String(actual ?? '').endsWith(String(expected.endsWith ?? ''))) return false;
      }
      if (anchored) continue;
      if ('not' in expected) {
        const excluded = expected.not;
        if (Array.isArray(excluded) ? excluded.includes(actual) : actual === excluded) return false;
        continue;
      }
    }

    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
