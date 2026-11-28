/**
 * The function library — the open half of "grammar closed, library open".
 *
 * ## Why a registry and not more syntax
 *
 * Every value operator that was not a comparison or a connective was a *function* wearing the
 * costume of syntax: `$count`, `$find`, `$plural`, `$pick`. Each one cost a resolver, a zod entry, a
 * validator branch, a docs section and a line in every author's head, and there was no natural
 * stopping point — the next need would have been the next operator. Here a new capability is one
 * entry: a name, a signature, a line of documentation and an implementation. Nothing in the parser,
 * the validator or the renderer changes, and the generated context lists it from this table.
 *
 * Same rule as everything else that is code: a function is added on **three real uses**, not on
 * the first. `$source` already made this bargain for host-registered computation, and an expression
 * reaches those the same way — a name the host registered in `$sources` is callable here, after the
 * built-ins.
 *
 * ## What an implementation may assume
 *
 * Arguments arrive as plain values: reactive accessors have been read, macro variables substituted.
 * An implementation must be pure and total — no I/O, no throwing on bad input. Wrong-typed input
 * answers with the empty value of its kind (`[]`, `''`, `0`, `false`, `undefined`), because a
 * template that renders too little is recoverable and one that throws mid-paint takes the tree with
 * it.
 *
 * ## Core and host functions
 *
 * Every function defined in this file is **core**: it means the same wherever the language runs,
 * because its implementation ships with the language. A host adds its own through the same
 * `defineFunction` (the form-state readers are one host's), and those are the host's: another host
 * may not have them, or may answer differently. Something that has to evaluate identically
 * everywhere — a declared operation, run by whichever backend holds the data — is checked with
 * `functions: 'core'` (see `check.ts`), which refuses every name outside `CORE_FUNCTIONS`.
 */
import { DENIED_PROPERTIES } from './ast';
import { compareCodePoints, plainZero, toNumber } from './evaluate';
import { readField } from './reach';
import { asText, matchesWhere } from './where';

export type FunctionCategory = 'list' | 'text' | 'number' | 'object' | 'form';

export interface ExpressionCallEnv {
  /** The render context — `$local`, `$localMeta`, the `$each` variables. */
  context: Record<string, unknown>;
  /** The template's store bag. */
  stores: Record<string, unknown>;
}

export interface FunctionSpec {
  name: string;
  category: FunctionCategory;
  /** Parameter names, `?`-suffixed when optional, `...`-prefixed when variadic. */
  params: readonly string[];
  /** One sentence, for the generated context. Say what it answers and what it does with bad input. */
  doc: string;
  /** A call as a template would write it. */
  example: string;
  impl: (args: unknown[], env: ExpressionCallEnv) => unknown;
  /**
   * The first argument names a `local` field as a string, as the form-state readers' does. The
   * checker holds that name to the fields the scope declares, as it does `local.<name>`.
   */
  namesLocal?: boolean;
}

const registry = new Map<string, FunctionSpec>();

/** Filled in once every core function below has been defined; `null` until then. */
let core: ReadonlySet<string> | null = null;

/**
 * Register a function. Re-registering a host function replaces it. A core function cannot be
 * replaced: its meaning is the same on every host, which is the reason the core set exists.
 */
export function defineFunction(spec: FunctionSpec): void {
  if (core?.has(spec.name)) throw new Error(`"${spec.name}" is a core expression function and cannot be redefined`);
  registry.set(spec.name, spec);
}

export function getFunction(name: string): FunctionSpec | undefined {
  return registry.get(name);
}

export function hasFunction(name: string): boolean {
  return registry.has(name);
}

/** Every registered function, sorted by category then name — the order the docs list them in. */
export function listFunctions(): FunctionSpec[] {
  const order: FunctionCategory[] = ['list', 'text', 'number', 'object', 'form'];
  return [...registry.values()].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name),
  );
}

/** How many arguments a signature allows: `[min, max]`, with `Infinity` for variadic. */
export function arityOf(spec: FunctionSpec): [number, number] {
  let min = 0;
  let max = 0;
  for (const param of spec.params) {
    if (param.startsWith('...')) return [min, Infinity];
    max++;
    if (!param.endsWith('?')) min++;
  }
  return [min, max];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** A value as a number, by the evaluator's one reading: what is not a number is 0. */
const asNumber = toNumber;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isAbsent = (value: unknown): boolean => value === undefined || value === null;

/**
 * What a list entry is compared by: a record by its `id`, because two reads of one record are
 * different objects, and anything else by its value. `distinct`, `without`, `indexOf` and
 * `insertAfter` all ask this, so "the same entry" means one thing across the library.
 */
const identity = (entry: unknown): unknown => (isRecord(entry) && entry.id !== undefined ? entry.id : entry);
/** Equality of two identities as a `Set` judges it, so `NaN` matches itself here as it does in `distinct`. */
const sameIdentity = (a: unknown, b: unknown): boolean => {
  const x = identity(a);
  const y = identity(b);
  return x === y || (x !== x && y !== y);
};
const indexIn = (list: unknown[], value: unknown): number => list.findIndex((entry) => sameIdentity(entry, value));

/**
 * The fields of an object a template may read, sorted by name. Through `readField`, like `pick`, so
 * listing an object's keys reads no more of it than naming them would. Sorted rather than in the
 * order the object holds them because JavaScript moves integer-like keys to the front and other
 * languages do not: a declared operation that walks an object has to see the same order on every
 * host.
 *
 * A key holding `null` is a key: it is what JSON writes for "nothing here", and a declared
 * operation's field set says "clear this field" with it, so dropping it would turn a clear into no
 * change. A key holding `undefined` is left out, as JSON leaves it out — it is how an expression says
 * a value is missing (an optional param nobody passed, a read that found nothing). Functions are left
 * out; a function is not a field's value.
 */
function fieldsOf(object: unknown): [string, unknown][] {
  if (!isRecord(object)) return [];
  let names: string[];
  try {
    names = Object.keys(object);
  } catch {
    return [];
  }
  const out: [string, unknown][] = [];
  for (const name of names.sort(compareCodePoints)) {
    const value = readField(object, name);
    if (value !== undefined && typeof value !== 'function') out.push([name, value]);
  }
  return out;
}

/** An object key as text, or `undefined` for anything that cannot name one safely. */
const asKey = (key: unknown): string | undefined => {
  const name =
    typeof key === 'string' ? key : typeof key === 'number' && Number.isFinite(key) ? String(key) : undefined;
  return name === undefined || DENIED_PROPERTIES.has(name) ? undefined : name;
};

/** A dot path read field by field, through `readField`. */
function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const name of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = readField(current, name);
  }
  return current;
}

/** Where a sort places a value of each kind: numbers, then text, then false and true; anything else last of the present. */
function sortRank(value: unknown): number {
  if (typeof value === 'number') return 0;
  if (typeof value === 'string') return 1;
  if (typeof value === 'boolean') return 2;
  return 3;
}

function compareSortValues(a: unknown, b: unknown): number {
  const rank = sortRank(a) - sortRank(b);
  if (rank !== 0) return rank;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return compareCodePoints(a, b);
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return 0;
}

/** A list position from an index argument: truncated, and held between 0 and the list's length. */
const clampIndex = (index: unknown, length: number): number =>
  Math.min(Math.max(Math.trunc(asNumber(index)), 0), length);

// ── Lists ───────────────────────────────────────────────────────────────────

defineFunction({
  name: 'count',
  category: 'list',
  params: ['items'],
  doc: 'How many entries a list has. Anything that is not a list counts as 0.',
  example: 'count(identity.memberDids)',
  impl: ([items]) => asList(items).length,
});

/*
  `sum` exists for the same reason `count` does, one question along: "how many" has an answer in this
  library and "how much" did not, so anything totalling a list — a thread's replies across its
  levels, votes, a column of numbers a model wrote — had to be a host function or a number the
  template could not say. It is deliberately the only arithmetic over a list: an `average` is
  `sum(xs) / count(xs)`, and a `reduce` would be the grammar growing, which is the thing this layer
  refuses.
*/
defineFunction({
  name: 'sum',
  category: 'list',
  params: ['items'],
  doc: 'The numbers in a list added together. Anything that is not a number counts as 0, and anything that is not a list sums to 0.',
  example: 'sum(local.replies.map(r, count(r.responses)))',
  impl: ([items]) => plainZero(asList(items).reduce((total: number, value) => total + asNumber(value), 0)),
});

defineFunction({
  name: 'first',
  category: 'list',
  params: ['items'],
  doc: 'The first entry of a list, or undefined when it is empty.',
  example: 'first(local.posts).title',
  impl: ([items]) => asList(items)[0],
});

defineFunction({
  name: 'last',
  category: 'list',
  params: ['items'],
  doc: 'The last entry of a list, or undefined when it is empty.',
  example: 'last(item.messages).text',
  impl: ([items]) => {
    const list = asList(items);
    return list[list.length - 1];
  },
});

defineFunction({
  name: 'reverse',
  category: 'list',
  params: ['items'],
  doc:
    'The entries of a list, back to front. A new list — the one given is untouched, so a store array ' +
    'or a query result can be reversed without disturbing anything else reading it.',
  example: 'reverse(local.utterances)',
  impl: ([items]) => [...asList(items)].reverse(),
});

defineFunction({
  name: 'filter',
  category: 'list',
  params: ['items', 'where', 'limit?'],
  doc: 'The entries matching a where-object — the same grammar $query takes. `limit` keeps the first N. Prefer the comprehension `items.filter(x, …)` when the test is not a where-object.',
  example: "filter(local.tasks, { status: 'done' }, 5)",
  impl: ([items, where, limit]) => {
    const matched = isRecord(where) ? asList(items).filter((entry) => matchesWhere(entry, where)) : asList(items);
    return typeof limit === 'number' && limit >= 0 ? matched.slice(0, limit) : matched;
  },
});

defineFunction({
  name: 'find',
  category: 'list',
  params: ['items', 'where?'],
  doc: 'The first entry matching a where-object, or undefined. Without `where`, the first entry. Read a field off the result directly: `find(…).id` is undefined when nothing matched.',
  example: "find(local.signalTypes, { slug: 'like' }).id",
  impl: ([items, where]) => {
    const list = asList(items);
    return isRecord(where) ? list.find((entry) => matchesWhere(entry, where)) : list[0];
  },
});

/*
  Each value once — the question `$each`'s `prev` grouping was standing in for.

  "Which kinds are on this canvas" used to be written as a list ordered by kind with a row rendered
  only where it differed from the one before, which works for one sorted list and cannot be written
  across two: the key lists kinds from what extraction wrote *and* from what somebody placed, and
  the canvas legend and the key both carried the trick with a comment apologising for it.

  Variadic, so two sources are one call rather than a concatenation the grammar has no operator for.
  Records compare by `id` (two reads of one record are different objects), everything else by value.
*/
defineFunction({
  name: 'distinct',
  category: 'list',
  params: ['...lists'],
  doc: 'The entries of every list given, each once, in the order first seen. Records compare by `id`, other values by value. Anything that is not a list contributes nothing.',
  example: 'distinct(local.found.map(r, r.__subjectClass), local.placements.map(p, p.nodeType))',
  impl: (lists) => {
    const seen = new Set<unknown>();
    const out: unknown[] = [];
    for (const list of lists) {
      for (const entry of asList(list)) {
        const key = identity(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entry);
      }
    }
    return out;
  },
});

defineFunction({
  name: 'join',
  category: 'list',
  params: ['items', 'separator?'],
  doc: "The entries of a list as one string, separated by `separator` (default ', ').",
  example: "join(item.tags, ' · ')",
  impl: ([items, separator]) =>
    asList(items)
      .map(asText)
      .join(separator === undefined ? ', ' : asText(separator)),
});

defineFunction({
  name: 'split',
  category: 'list',
  params: ['text', 'separator?'],
  doc: "The text cut into a list at each `separator` (default ','), each piece trimmed, empty pieces left out — so an empty string is an empty list. The inverse of `join`, for a list held in one string, such as a URL parameter.",
  example: 'split(navigation.params.hide).filter(k, k != kind)',
  impl: ([text, separator]) =>
    asText(text)
      .split(separator === undefined ? ',' : asText(separator))
      .map((piece) => piece.trim())
      .filter(Boolean),
});

/*
  The list-building functions below exist for declared operations, which write a relation's whole
  ordered list (`setRelation`) or a json field's whole value, and so have to compute the new list
  from the old one: a column added after another, an id taken out, a section moved. Every one
  answers with a new list and leaves the one given untouched, and every one treats a missing list
  as an empty one, because "the record has no children yet" is the ordinary first case of each.
*/

defineFunction({
  name: 'concat',
  category: 'list',
  params: ['...lists'],
  doc: 'The entries of every list given, one after another, in order and duplicates kept — `distinct` is the one that drops repeats. Anything that is not a list contributes nothing.',
  example: 'concat(board.children, [column.id])',
  impl: (lists) => lists.flatMap((list) => asList(list)),
});

defineFunction({
  name: 'without',
  category: 'list',
  params: ['items', '...values'],
  doc: 'The list with every entry equal to any of `values` taken out. Records compare by `id`, as in `distinct`, so a record and its id both name it. Anything that is not a list gives [].',
  example: 'without(board.children, column.id)',
  impl: ([items, ...values]) => asList(items).filter((entry) => !values.some((value) => sameIdentity(entry, value))),
});

defineFunction({
  name: 'indexOf',
  category: 'list',
  params: ['items', 'value'],
  doc: 'The position of the first entry equal to `value`, counting from 0, or -1 when there is none. Records compare by `id`, as in `distinct`. Anything that is not a list gives -1.',
  example: 'indexOf(board.children, column.id)',
  impl: ([items, value]) => indexIn(asList(items), value),
});

defineFunction({
  name: 'insertAt',
  category: 'list',
  params: ['items', 'index', 'value'],
  doc: 'A new list with `value` put at position `index`, counting from 0. An index below 0 puts it first and one past the end puts it last; an absent `value` leaves the list as it was. Anything that is not a list is read as [].',
  example: 'insertAt(space.enabledViews, 0, view)',
  impl: ([items, index, value]) => {
    const list = [...asList(items)];
    if (isAbsent(value)) return list;
    list.splice(clampIndex(index, list.length), 0, value);
    return list;
  },
});

defineFunction({
  name: 'insertAfter',
  category: 'list',
  params: ['items', 'anchor', 'value'],
  doc: 'A new list with `value` put straight after the first entry equal to `anchor`, or at the end when `anchor` is not in it. Records compare by `id`. An absent `value` leaves the list as it was; anything that is not a list is read as [].',
  example: 'insertAfter(board.children, previous.id, column.id)',
  impl: ([items, anchor, value]) => {
    const list = [...asList(items)];
    if (isAbsent(value)) return list;
    const at = indexIn(list, anchor);
    list.splice(at === -1 ? list.length : at + 1, 0, value);
    return list;
  },
});

defineFunction({
  name: 'slice',
  category: 'list',
  params: ['items', 'start', 'end?'],
  doc: 'The entries from position `start` up to, not including, `end` (default: the end). A negative position counts back from the end, so slice(items, -3) is the last three. Anything that is not a list gives [].',
  example: 'slice(local.posts, 0, 5)',
  impl: ([items, start, end]) => {
    const list = asList(items);
    return list.slice(Math.trunc(asNumber(start)), isAbsent(end) ? list.length : Math.trunc(asNumber(end)));
  },
});

/*
  A sort exists here, where the grammar has none, because an operation that orders a list it then
  stores cannot ask the backend for the order: what it sorts is a value it computed. Text is compared
  by code point rather than by the reader's locale for the same reason a declared operation is
  restricted to core functions: the order it stores has to be the order every host computes.
*/
defineFunction({
  name: 'sortBy',
  category: 'list',
  params: ['items', 'key', 'direction?'],
  doc: "A new list ordered by the field `key` names, a dot path such as 'createdAt' or 'author.name'; `direction` is 'asc' (the default) or 'desc'. Numbers compare as numbers, text by Unicode code point (so 'B' before 'a', and not the reader's alphabet), numbers before text; entries without the field (or holding '') go last either way, and equal entries keep their order. Anything that is not a list gives [].",
  example: "sortBy(local.columns, 'position')",
  impl: ([items, key, direction]) => {
    const list = asList(items);
    if (typeof key !== 'string' || key === '') return [...list];
    const sign = direction === 'desc' ? -1 : 1;
    const keyed = list.map((entry) => {
      const value = readPath(entry, key);
      // A field holding '' has no value, as `filter()` and every backend read it: the contract
      // stores no empty string, so sorting one as text would order a list no backend could return.
      const absent = isAbsent(value) || value === '' || (typeof value === 'number' && Number.isNaN(value));
      return { entry, value, absent };
    });
    // Array.prototype.sort is stable, so entries the comparison calls equal keep their order.
    keyed.sort((a, b) => {
      if (a.absent || b.absent) return Number(a.absent) - Number(b.absent);
      return sign * compareSortValues(a.value, b.value);
    });
    return keyed.map(({ entry }) => entry);
  },
});

// ── Text ────────────────────────────────────────────────────────────────────

defineFunction({
  name: 'plural',
  category: 'text',
  params: ['count', 'one', 'other'],
  doc: '`one` when count is exactly 1, otherwise `other`.',
  example: "plural(count(identity.memberDids), 'Member', 'Members')",
  impl: ([n, one, other]) => (Number(n) === 1 ? one : other),
});

defineFunction({
  name: 'lower',
  category: 'text',
  params: ['text'],
  doc: 'The text in lower case.',
  example: 'lower(item.handle)',
  impl: ([text]) => asText(text).toLowerCase(),
});

defineFunction({
  name: 'upper',
  category: 'text',
  params: ['text'],
  doc: 'The text in upper case.',
  example: 'upper(item.code)',
  impl: ([text]) => asText(text).toUpperCase(),
});

defineFunction({
  name: 'trim',
  category: 'text',
  params: ['text'],
  doc: 'The text without leading and trailing whitespace.',
  example: "trim(local.search) != ''",
  impl: ([text]) => asText(text).trim(),
});

defineFunction({
  name: 'contains',
  category: 'text',
  params: ['text', 'needle'],
  doc: "Whether the text contains `needle`, ignoring case: contains('Anna', 'ann') is true. The same test the where-object `contains` makes, and what a search box wants; `startsWith` and `endsWith` compare exactly.",
  example: 'contains(item.name, local.search)',
  impl: ([text, needle]) => asText(text).toLowerCase().includes(asText(needle).toLowerCase()),
});

defineFunction({
  name: 'startsWith',
  category: 'text',
  params: ['text', 'prefix'],
  doc: "Whether the text starts with `prefix`, comparing exactly — case counts, so startsWith('Anna', 'an') is false. For structured strings such as an ISO date or a URI; `contains` is the one that ignores case.",
  example: "startsWith(item.startDate, '2026-08')",
  impl: ([text, prefix]) => asText(text).startsWith(asText(prefix)),
});

defineFunction({
  name: 'endsWith',
  category: 'text',
  params: ['text', 'suffix'],
  doc: "Whether the text ends with `suffix`, comparing exactly — case counts, so endsWith('photo.PNG', '.png') is false.",
  example: "endsWith(item.url, '.png')",
  impl: ([text, suffix]) => asText(text).endsWith(asText(suffix)),
});

/*
  The rule is the one WE's stores have always used to name a signal type, a task state, a role or a
  kind of involvement from what somebody typed, kept to the character: those slugs are stored, and a
  template finds the type by them, so a declared operation that names one has to arrive at the slug
  the store would have. That is why it drops a character it does not keep rather than folding it
  ('Café' is 'caf') and why a hyphen typed between spaces stays three hyphens.
*/
defineFunction({
  name: 'slug',
  category: 'text',
  params: ['text'],
  doc: "The text as a slug: lower case, every character but a–z, 0–9, whitespace and '-' dropped, the ends trimmed, and each run of whitespace one '-'. A character outside a–z is dropped, not converted, so 'Café au lait' is 'caf-au-lait'. A number is read as its digits; anything else gives ''.",
  example: 'slug(name)',
  impl: ([text]) => {
    const source =
      typeof text === 'string' ? text : typeof text === 'number' && Number.isFinite(text) ? String(text) : '';
    return source
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
  },
});

// ── Numbers ─────────────────────────────────────────────────────────────────

defineFunction({
  name: 'round',
  category: 'number',
  params: ['value', 'digits?'],
  doc: 'The number rounded to `digits` decimal places (default 0). Non-numbers round to 0.',
  example: 'round(item.progress * 100)',
  impl: ([value, digits]) => {
    const factor = 10 ** Math.max(0, Math.floor(asNumber(digits)));
    return plainZero(Math.round(asNumber(value) * factor) / factor);
  },
});

/*
  Variadic, and also over one list: `min(a, b)` for two numbers a template has, `min(xs)` for a
  column of them. One argument that is a list is the list's entries; anything else is the numbers
  given. An empty list, like no arguments, answers 0 — the empty value of a number.
*/
const extremeOf = (values: unknown[], pick: (...n: number[]) => number): number => {
  const numbers = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  return numbers.length ? plainZero(pick(...numbers.map(asNumber))) : 0;
};

defineFunction({
  name: 'min',
  category: 'number',
  params: ['...values'],
  doc: 'The smallest of the numbers given, or of the entries of a list when it is the only argument. Non-numbers count as 0; no numbers at all (or an empty list) gives 0.',
  example: 'min(count(local.rows), 20)',
  impl: (values) => extremeOf(values, Math.min),
});

defineFunction({
  name: 'max',
  category: 'number',
  params: ['...values'],
  doc: 'The largest of the numbers given, or of the entries of a list when it is the only argument. Non-numbers count as 0; no numbers at all (or an empty list) gives 0.',
  example: 'max(local.page - 1, 0)',
  impl: (values) => extremeOf(values, Math.max),
});

// ── Objects ─────────────────────────────────────────────────────────────────

defineFunction({
  name: 'pick',
  category: 'object',
  params: ['object', 'keys'],
  doc: 'A new object holding only the named keys of `object`. Anything that is not an object gives `{}`.',
  example: "pick(identity.ownProfile, ['handle', 'avatar'])",
  impl: ([object, keys]) => {
    if (!isRecord(object)) return {};
    const out: Record<string, unknown> = {};
    for (const key of asList(keys)) {
      const name = asText(key);
      // `readField`, not `name in object`: the keys are the template's, so this is a property read
      // like `a.b` and stops at the page the same way.
      const value = readField(object, name);
      if (value !== undefined) out[name] = value;
    }
    return out;
  },
});

/*
  `put`, `merge`, `keys` and `values` are for a field whose value is one json object — module
  settings keyed by module id, say — which an operation can only write whole, and so has to build
  from the stored one with one key changed.
*/
defineFunction({
  name: 'put',
  category: 'object',
  params: ['object', 'key', 'value'],
  doc: 'A new object: `object` with `key` set to `value` — null included, which is how a field set says "clear this field" — or with `key` removed when `value` is missing (an unset param, a read that found nothing). The object given is untouched. Anything that is not an object is read as {}; a key that is not text or a number leaves the object as it was.',
  example: 'put(space.moduleSettings, moduleId, settings)',
  impl: ([object, key, value]) => {
    const out: Record<string, unknown> = Object.fromEntries(fieldsOf(object));
    const name = asKey(key);
    if (name === undefined) return out;
    if (value === undefined) delete out[name];
    else out[name] = value;
    return out;
  },
});

defineFunction({
  name: 'merge',
  category: 'object',
  params: ['...objects'],
  doc: 'One new object holding the keys of every object given, a later one winning where two share a key. Shallow: a key holding an object is replaced, not merged into. A key holding null overrides — null is a clear, and survives into the result — while a missing value does not; anything that is not an object contributes nothing.',
  example: 'merge(space.moduleSettings[moduleId], { open: true })',
  impl: (objects) => {
    const out: Record<string, unknown> = {};
    for (const object of objects) for (const [name, value] of fieldsOf(object)) out[name] = value;
    return out;
  },
});

defineFunction({
  name: 'keys',
  category: 'object',
  params: ['object'],
  doc: "The names of an object's keys, sorted by Unicode code point so the order is the same on every host. A key holding null or '' is listed (it is a clear); a missing value is not. Anything that is not an object gives [].",
  example: 'keys(space.moduleSettings)',
  impl: ([object]) => fieldsOf(object).map(([name]) => name),
});

defineFunction({
  name: 'values',
  category: 'object',
  params: ['object'],
  doc: "The values of an object's keys, in the order `keys` lists them, null included; missing values are left out. Anything that is not an object gives [].",
  example: 'values(space.moduleSettings).filter(s, s.open)',
  impl: ([object]) => fieldsOf(object).map(([, value]) => value),
});

// ── The core set ────────────────────────────────────────────────────────────

/**
 * The names of the core library: every function this file defines, and nothing a host registers.
 * Taken here, after the last definition above and before any host can have added one.
 */
export const CORE_FUNCTIONS: ReadonlySet<string> = (core = new Set(registry.keys()));

/** Whether `name` is one of the core library's functions rather than a host's. */
export function isCoreFunction(name: string): boolean {
  return CORE_FUNCTIONS.has(name);
}
