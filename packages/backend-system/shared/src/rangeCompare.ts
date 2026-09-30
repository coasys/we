/**
 * What `lt`, `lte`, `gt` and `gte` mean, in one place, for every evaluator that runs them in JS — the
 * reference engine and the where-object grammar `filter()` and `find()` read.
 *
 * **A number against a number compares numerically; a string against a string compares as text.**
 * Anything else — a string field against a number bound, an absent field — matches nothing.
 *
 * Text order is the point for dates. WE stores a day as `YYYY-MM-DD` and a moment as
 * `YYYY-MM-DDTHH:mm`, with no zone, and strings in that shape sort in time order character by
 * character. So `{ dueDate: { lt: '2026-10-01' } }` is "due before October" without parsing
 * anything, and a bound that is a day is compared sensibly against a value that carries a time:
 * `'2026-09-30T18:00' < '2026-10-01'`. Parsing both into instants would have to pick a zone for a
 * value that has none, and whichever it picked would be wrong for somebody.
 *
 * Mixed types refuse rather than coerce. JavaScript would compare `'10' < 9` numerically and
 * `'abc' < 9` as false, and a query that answers differently depending on what a stranger typed into
 * a text field is worse than one that answers nothing.
 */
export type RangeOp = 'lt' | 'lte' | 'gt' | 'gte';

export const RANGE_OPS: readonly RangeOp[] = ['lt', 'lte', 'gt', 'gte'];

export function isRangeOp(op: string): op is RangeOp {
  return (RANGE_OPS as readonly string[]).includes(op);
}

export function rangeCompare(actual: unknown, op: RangeOp, bound: unknown): boolean {
  const comparable =
    (typeof actual === 'number' && typeof bound === 'number' && !Number.isNaN(actual) && !Number.isNaN(bound)) ||
    (typeof actual === 'string' && typeof bound === 'string');
  if (!comparable) return false;
  const a = actual as number | string;
  const b = bound as number | string;
  switch (op) {
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
  }
}
