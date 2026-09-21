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
import { arrangedBoard } from './arrangedBoard';
import { calendarMonth, calendarMonths, monthLabel, yearLabel } from './calendarMonth';
import { formatJson } from './formatJson';
import { involvement } from './involvement';
import { involvementMenu } from './involvementMenu';
import { reactors } from './reactors';
import { reactions, signalTally } from './signalTally';
import { signalTypesByUse } from './signalTypesByUse';

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
  {
    name: 'arrangedBoard',
    params: ['options'],
    doc: 'A board worked out from its three subscriptions — { ready, gathers, columns, contents, unplaced, unplacedStates, available, total, involved, filtering, show, dimmed, cardCount, matchedCount, unplacedTotal, rows, cells, rowCounts }. columns are the caller’s own column records in the board’s order; contents[columnId] is { label, icon, color, lane, arranged, unarranged, count, shown, matched, order }; unplaced is work no column here shows. Options: board (the record with children hydrated), columns (its kind: "column" children), records (everything in scope), states (spaceStore.taskStates). To read it by who is on the work, also pass involvements (an Involvement query), kinds (spaceStore.involvementTypes), people (the chosen DIDs), me (me.did — involved is everyone on a card here, the viewer first) and show: "dim" lists the others in dimmed and moves nothing; "hide" drops them from arranged, unarranged and unplaced while count stays true and shown says how many are drawn; "rows" adds a row per person plus "nobody" — rows are keys, cells[row][columnId] is { arranged, unarranged, count }. A drag in a column showing only part of itself passes contents[columnId].order to arrangeColumn, so the hidden cards keep their places.',
    example:
      'arrangedBoard({ board: first(local.board), columns: local.columns, records: local.pool, states: spaceStore.taskStates }).columns',
    fn: arrangedBoard,
  },
  {
    name: 'involvement',
    params: ['options'],
    doc: 'Who is on each record, from the Involvement rows — { byNode, answers, dids }. byNode[recordId] is { people, dids, responsible, reviewing, committed, interested, declined, pairs }: people are { did, kind, name, semantic, reflexive, icon, color, tone }, assignees first then reviewers and so on, and tone is the avatar ring the part wears ("warning" for reviewing, empty otherwise) — pass it as an AvatarStack avatar\u2019s tone; the five lists are DIDs grouped by what each kind means, so a renamed or added kind still lands in the right one; dids is everyone not declined; pairs is every "did|kind" present, for a menu tick with `in`. answers[recordId] is the viewer\u2019s own reflexive answer (going, maybe, …). Options: rows (an Involvement query), types (spaceStore.involvementTypes), me (me.did, who then leads the top-level dids), nodes (record ids the top-level dids is limited to).',
    example:
      'involvement({ rows: local.involvements, types: spaceStore.involvementTypes, me: me.did }).byNode[card.id].responsible',
    fn: involvement,
  },
  {
    name: 'involvementMenu',
    params: ['options'],
    doc: 'The entries of a "who is on this" DropdownMenu for one record: the member a conversation named, when `said` matches exactly one and nobody is doing it yet; "Assign to me" while the viewer is not already on it, then a group per kind the entity is offered that anybody may give (the first open, the rest closed unless somebody holds them), each listing members with their faces — current holders ticked and first, then the viewer, then everyone by name. Every entry carries `kind`, and a toggle `checked`, so one handler serves all: setInvolvement(record, arg.id, arg.kind, !arg.checked). Options: node, entity, rows (an Involvement query), types (spaceStore.offeredInvolvementTypes), members (spaceStore.members), profiles (profileStore.profiles), me (me.did), said (a name somebody said — TaskBlock.assignee).',
    example:
      "involvementMenu({ node: card.id, entity: 'TaskBlock', rows: local.involvements, types: spaceStore.offeredInvolvementTypes, members: spaceStore.members, profiles: profileStore.profiles, me: me.did })",
    fn: involvementMenu,
  },
  {
    name: 'signalTally',
    params: ['options'],
    doc: "What a record's reactions say, as one number. With `type`, the number THAT type is read as — a toggle counts, a vote nets out, a rating averages, and a community's own `aggregate` wins unless the mode cannot express it. Without a type, how many people reacted at all: records, never values, since a total summing likes and stars and downvotes is not a number. Retired types still count — somebody reacted, and a total that fell when a vocabulary was tidied would be reporting the tidying. Options: signals (the record's `signals`, hydrated), type (a SignalType row).",
    example: 'signalTally({ signals: row.signals, type: sig })',
    fn: signalTally,
  },
  {
    name: 'reactions',
    params: ['options'],
    doc: "A record's reactions with this agent's own newest answer in place, whether or not it has been read back yet. Every reaction surface draws through it: a press writes a record and the subscription answers about a second later, so without it the glyph stays unfilled and the count stays put and the press reads as having failed. The LIST rather than the count, because the tally, the mark and the control all read it — overlay the count alone and the heart sits unfilled beside a number that moved. Options: signals (the record's `signals`, hydrated), record (its id), type (the SignalType's id), me (me.did).",
    example:
      'reactions({ signals: filter(row.signals, { signalTypeId: sig.id }), record: row.id, type: sig.id, me: me.did })',
    fn: reactions,
  },
  {
    name: 'reactors',
    params: ['options'],
    doc: 'Who reacted with one type and what each gave — { people, total, unresolved }. `people` are { did, name, avatar, value, mine }, the reader first and then by name; `total` counts everybody before any search, which is what "12 people" says. The record already carries this — `include: { signals: true }` hydrates each Signal\'s author and value — so nothing is fetched; what a schema cannot do is join a DID to a face and a name. `search` narrows by name, and `unresolved` says how many could not be judged because their profile has not arrived. Options: signals (one type\'s signals, hydrated), profiles (profileStore.profiles), me (me.did), search.',
    example:
      'reactors({ signals: filter(row.signals, { signalTypeId: sig.id }), profiles: profileStore.profiles, me: me.did })',
    fn: reactors,
  },
  {
    name: 'signalTypesByUse',
    params: ['options'],
    doc: "Reaction types ordered by how many PEOPLE reacted with each, most first — never by what they said, since a total of values cannot compare a rating with a vote and a downvoted type would sort below one nobody has used. Ties keep the order they arrived in, so a panel does not reshuffle as reactions come in. Muted authors are left out of the count. It orders and nothing else: which types a surface draws is a filter, and stays in the schema — which is what keeps an overflow count evaluable, since reordering a list cannot change how long it is. Sorting is here because the expression language has no sort, the grammar is closed, and these types come from a subscription rather than a query that could carry an `order`. A display settles the order ONCE at mount and passes it back as `order` — a list of ids — so a reaction somebody withdraws does not slide down the column under their cursor, and a row that would have moved keeps the index `$each` gave it. Ids `order` names keep that order; anything it does not name is appended by use, so a type defined since still appears. Options: types (the rows to order), signals (the record's `signals`, hydrated), muted (spaceStore.mutedDids), order (ids settled earlier), limit (keep the first N of that order).",
    example:
      'signalTypesByUse({ types: filter(local.signalTypes, { retired: { not: true } }), signals: row.signals, muted: spaceStore.mutedDids, limit: 4 })',
    fn: signalTypesByUse,
  },
  {
    name: 'formatJson',
    params: ['options'],
    doc: 'A JSON string indented for reading, or the text unchanged when it will not parse — which is the case worth showing rather than swallowing. Options: text. For displaying a stored blob (an extraction pass\u2019s prompt and response); a schema has no JSON.stringify of its own.',
    example: 'formatJson({ text: pass.prompt })',
    fn: formatJson,
  },
];

/** The registry as the renderer's `$sources` bag expects it: name to function. */
export function hostSourceBag(): Record<string, (options: unknown) => unknown> {
  return Object.fromEntries(hostSources.map((source) => [source.name, source.fn as (options: unknown) => unknown]));
}
