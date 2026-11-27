/**
 * The where-object grammar, evaluated against one item, with every value already resolved.
 *
 * One vocabulary in two places — `$query`'s `where` and the `filter`/`find` library functions — and
 * the docs promise it means the same in both. So the library carries no copy of its own: what each
 * operator means is the backend contract's `matchesWhere`, the evaluation the reference query engine
 * runs.
 */
import { matchesWhere as matchesWhereOn } from '@we/backend-shared';

import { readField } from './reach';

/**
 * A value as the expression language turns it into text: nothing for an absent value, and otherwise
 * what JavaScript's `String` prints. Template interpolation, `+` with a string side, the text
 * functions all share it, so they cannot disagree about what
 * a value reads as — a record or list included, which prints as JavaScript prints it.
 */
export function asText(value: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the language's defined conversion of any value to text; see above.
  return value == null ? '' : String(value);
}

/**
 * Whether one item satisfies a where-object. The grammar is evaluated by the backend contract's own
 * matcher, so `filter()` and `find()` answer exactly what a `$query` with the same where would —
 * including that an absent value matches no comparison but `exists`.
 *
 * Fields are read through `readField`: the field names are the template's, and a test against a
 * value it may not read is a way of reading it a character at a time.
 */
export function matchesWhere(item: unknown, where: Record<string, unknown>): boolean {
  return matchesWhereOn(item, where, readField);
}
