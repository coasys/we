/**
 * What a comparison means, evaluated in JavaScript — the one implementation behind every reader that
 * runs the where-object grammar itself: the reference query engine (and so the in-memory backend's
 * `$query`), `filter()` and `find()` in the expression language, and the fakes that stand in for a
 * backend in tests. Each used to carry its own copy, and they disagreed about the one case that
 * matters most: a record with no value for the field.
 *
 * **An absent value matches no comparison.** A field never written, or cleared, holds nothing, and
 * nothing is not equal to `'x'`, not unequal to it, not in a list, not out of one, not inside a range
 * and not a string that contains anything — as SQL's comparisons with NULL are not true. A production
 * backend answers this way natively, so an evaluator that answered `{ not: 'x' }` with "yes" for an
 * absent value made a template that worked in `filter()` and in tests come back short from a real
 * `$query`. `exists` is the one operator that asks about absence, and it is the way to include it:
 * `{ OR: [{ field: { not: 'x' } }, { field: { exists: false } }] }`.
 *
 * `''` is absent too. The contract never stores an empty string for a scalar — writing one clears the
 * field, at creation as at an edit — so a `''` seen here is a value that would not exist on a backend.
 */
import { leafFilter } from './queryCompiler';
import type { Filter, Op, Scalar } from './queryIR';
import { rangeCompare } from './rangeCompare';

/** No value: never written, or cleared. `''` is how a value is cleared, so it is no value either. */
export const isAbsent = (value: unknown): boolean => value == null || value === '';

/**
 * A field's value as the text operators search it: text as written, a number, boolean or list as it
 * prints. A record has no text to search; printed, it would be `[object Object]`, which `contains`
 * would find "object" in.
 */
function searchText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) return String(value);
  return '';
}

/** Whether `actual` satisfies one comparison. */
export function compareValue(actual: unknown, op: Op, value: Scalar | Scalar[], caseSensitive?: boolean): boolean {
  if (op === 'exists') return value === false ? isAbsent(actual) : !isAbsent(actual);
  if (isAbsent(actual)) return false;
  switch (op) {
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return rangeCompare(actual, op, value);
    case 'in':
      return Array.isArray(value) && value.includes(actual as Scalar);
    case 'nin':
      return Array.isArray(value) && !value.includes(actual as Scalar);
    case 'contains':
    case 'startsWith':
    case 'endsWith': {
      let a = searchText(actual);
      let v = searchText(value);
      if (!caseSensitive) {
        a = a.toLowerCase();
        v = v.toLowerCase();
      }
      return op === 'contains' ? a.includes(v) : op === 'startsWith' ? a.startsWith(v) : a.endsWith(v);
    }
    default:
      return false;
  }
}

/**
 * Whether a record satisfies a filter. `read` answers a field's value; `related` answers a relation
 * quantifier, and without one (a plain list has no relations to follow) a quantifier matches nothing.
 */
export function filterMatches(
  filter: Filter,
  read: (field: string) => unknown,
  related?: (rel: string, op: 'exists' | 'some' | 'none', where?: Filter) => boolean,
): boolean {
  if ('and' in filter) return filter.and.every((f) => filterMatches(f, read, related));
  if ('or' in filter) return filter.or.some((f) => filterMatches(f, read, related));
  if ('not' in filter) return !filterMatches(filter.not, read, related);
  if ('rel' in filter) return related ? related(filter.rel, filter.op, filter.where) : false;
  return compareValue(read(filter.field), filter.op, filter.value, filter.caseSensitive);
}

/**
 * Whether one item satisfies a where-object, with every value in it already resolved — the grammar
 * `$query` takes, read the way the query compiler reads it, so a where-object cannot mean one thing
 * in a `$query` and another in `filter()`.
 *
 * Malformed combinators match nothing rather than throw: a where-object built by an expression can
 * hold anything, and the expression language answers wrong-typed input with an empty result.
 * `read` is how a field is read off the item — a caller with its own rules about which fields may be
 * read passes them here.
 */
export function matchesWhere(
  item: unknown,
  where: Record<string, unknown>,
  read: (item: object, field: string) => unknown = (object, field) => (object as Record<string, unknown>)[field],
): boolean {
  const readOff = (field: string) => (item !== null && typeof item === 'object' ? read(item, field) : undefined);
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR' || key === 'AND') {
      if (!Array.isArray(expected)) return false;
      const branches = expected as unknown[];
      const holds = (branch: unknown) => isRecord(branch) && matchesWhere(item, branch, read);
      if (!(key === 'OR' ? branches.some(holds) : branches.every(holds))) return false;
      continue;
    }
    if (key === 'NOT') {
      if (!isRecord(expected) || matchesWhere(item, expected, read)) return false;
      continue;
    }
    if (!filterMatches(leafFilter(key, expected), readOff)) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
