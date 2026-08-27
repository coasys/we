/**
 * The functions this host lends to templates, beyond the schema language's built-in library.
 *
 * ## Why a table and not four exports
 *
 * These reach a template as functions in an expression — `calendarMonth({ month: local.month })` —
 * resolved against the `$sources` bag at paint.
 * What neither can do is tell an author the name exists. The graph plugins had exactly this
 * problem: a good protocol, no catalogue in the generated context, so an LLM could not write a
 * globe template. A host function that is not in the context is one an author has to already know.
 *
 * So each entry carries what the generated reference needs — the signature, a sentence, an
 * example — in the same shape `defineFunction` uses for the built-ins, and `@we/ai-context` reads
 * this file to list them beside those. The validator reads the same list, which is how a call to a
 * source stops being a warning and a typo in one starts being.
 *
 * A module that wants to lend a function contributes an entry here for now; when modules become
 * installable it becomes a declaration on the module contract, catalogued the same way.
 */
import { calendarMonth, calendarMonths, monthLabel, yearLabel } from './calendarMonth';

export interface HostSource {
  /** The name a template calls. */
  name: string;
  /** Parameter names, in the library's notation — `?` for optional. */
  params: readonly string[];
  /** One sentence for the generated context: what it answers, and with what. */
  doc: string;
  /** A call as an expression would write it. */
  example: string;
  fn: (options: never) => unknown;
}

/**
 * Every entry names its options as one object parameter, because that is how an expression calls
 * them: `monthLabel({ offset: local.offset })`.
 */
export const hostSources: readonly HostSource[] = [
  {
    name: 'calendarMonth',
    params: ['options?'],
    doc: 'The days of a month as rows — { date, day, inMonth, isToday, weekday } — padded to whole weeks. Options: month (YYYY-MM-DD, default today), offset (months from it), weekStartsOn (0 Sunday … 6), fixedWeeks (six rows, default on).',
    example: 'calendarMonth({ offset: local.monthOffset, weekStartsOn: 1 })',
    fn: calendarMonth,
  },
  {
    name: 'calendarMonths',
    params: ['options?'],
    doc: 'The twelve months of the year an offset lands in — { label, month, year, offset, isThisMonth, isShown } — each carrying its own offset from today, for a jump-to-month picker.',
    example: 'calendarMonths({ offset: local.monthOffset })',
    fn: calendarMonths,
  },
  {
    name: 'monthLabel',
    params: ['options?'],
    doc: 'The month a calendar is showing, as "August 2026" in the viewer’s language. Same options as calendarMonth.',
    example: 'monthLabel({ offset: local.monthOffset })',
    fn: monthLabel,
  },
  {
    name: 'yearLabel',
    params: ['options?'],
    doc: 'The year a calendar is showing, on its own. Same options as calendarMonth.',
    example: 'yearLabel({ offset: local.monthOffset })',
    fn: yearLabel,
  },
];

/** The registry as the renderer's `$sources` bag expects it: name to function. */
export function hostSourceBag(): Record<string, (options: unknown) => unknown> {
  return Object.fromEntries(hostSources.map((source) => [source.name, source.fn as (options: unknown) => unknown]));
}
