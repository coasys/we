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
 */
import type { LocalMetaMap } from '../propResolvers/local';
import { matchesWhere } from './where';

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
}

const registry = new Map<string, FunctionSpec>();

/** Register a function. Re-registering a name replaces it — a host may refine a built-in. */
export function defineFunction(spec: FunctionSpec): void {
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
const asText = (value: unknown): string => (value == null ? '' : String(value));
const asNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function meta(env: ExpressionCallEnv): LocalMetaMap | undefined {
  return env.context.$localMeta as LocalMetaMap | undefined;
}

// ── Lists ───────────────────────────────────────────────────────────────────

defineFunction({
  name: 'count',
  category: 'list',
  params: ['items'],
  doc: 'How many entries a list has. Anything that is not a list counts as 0.',
  example: 'count(spaceStore.members)',
  impl: ([items]) => asList(items).length,
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
  name: 'filter',
  category: 'list',
  params: ['items', 'where', 'limit?'],
  doc: 'The entries matching a where-object — the same grammar $query takes. `limit` keeps the first N. Prefer the comprehension `items.filter(x, …)` when the test is not a where-object.',
  example: "filter(spaceStore.members, { role: 'admin' }, 5)",
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

// ── Text ────────────────────────────────────────────────────────────────────

defineFunction({
  name: 'plural',
  category: 'text',
  params: ['count', 'one', 'other'],
  doc: '`one` when count is exactly 1, otherwise `other`.',
  example: "plural(count(spaceStore.members), 'Member', 'Members')",
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
  doc: 'Whether the text contains `needle`, ignoring case — the same test the where-object `contains` makes.',
  example: 'contains(item.name, local.search)',
  impl: ([text, needle]) => asText(text).toLowerCase().includes(asText(needle).toLowerCase()),
});

defineFunction({
  name: 'startsWith',
  category: 'text',
  params: ['text', 'prefix'],
  doc: 'Whether the text starts with `prefix`, case-sensitively — for structured strings such as an ISO date or a URI.',
  example: "startsWith(item.startDate, '2026-08')",
  impl: ([text, prefix]) => asText(text).startsWith(asText(prefix)),
});

defineFunction({
  name: 'endsWith',
  category: 'text',
  params: ['text', 'suffix'],
  doc: 'Whether the text ends with `suffix`, case-sensitively.',
  example: "endsWith(item.url, '.png')",
  impl: ([text, suffix]) => asText(text).endsWith(asText(suffix)),
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
    return Math.round(asNumber(value) * factor) / factor;
  },
});

defineFunction({
  name: 'min',
  category: 'number',
  params: ['...values'],
  doc: 'The smallest of the numbers given. Non-numbers count as 0.',
  example: 'min(count(local.rows), 20)',
  impl: (values) => (values.length ? Math.min(...values.map(asNumber)) : 0),
});

defineFunction({
  name: 'max',
  category: 'number',
  params: ['...values'],
  doc: 'The largest of the numbers given. Non-numbers count as 0.',
  example: 'max(local.page - 1, 0)',
  impl: (values) => (values.length ? Math.max(...values.map(asNumber)) : 0),
});

// ── Objects ─────────────────────────────────────────────────────────────────

defineFunction({
  name: 'pick',
  category: 'object',
  params: ['object', 'keys'],
  doc: 'A new object holding only the named keys of `object`. Anything that is not an object gives `{}`.',
  example: "pick(profileStore.ownProfile, ['handle', 'avatar'])",
  impl: ([object, keys]) => {
    if (!isRecord(object)) return {};
    const out: Record<string, unknown> = {};
    for (const key of asList(keys)) {
      const name = asText(key);
      if (name in object) out[name] = object[name];
    }
    return out;
  },
});

// ── Form state ──────────────────────────────────────────────────────────────

defineFunction({
  name: 'error',
  category: 'form',
  params: ['field'],
  doc: "A field's first validation message, once it has been touched; empty otherwise. The field is named as a string.",
  example: "error('email')",
  impl: ([field], env) => {
    const entry = meta(env)?.[asText(field)];
    return entry && entry.touched() ? (entry.errors()[0] ?? '') : '';
  },
});

defineFunction({
  name: 'valid',
  category: 'form',
  params: ['field'],
  doc: 'Whether every validation rule on the field passes, touched or not. True for a field with no rules.',
  example: "valid('email')",
  impl: ([field], env) => {
    const entry = meta(env)?.[asText(field)];
    return entry ? entry.errors().length === 0 : true;
  },
});

defineFunction({
  name: 'touched',
  category: 'form',
  params: ['field'],
  doc: 'Whether the field has been blurred or marked with $touch.',
  example: "touched('email')",
  impl: ([field], env) => meta(env)?.[asText(field)]?.touched() ?? false,
});

defineFunction({
  name: 'formValid',
  category: 'form',
  params: [],
  doc: 'Whether every validated field in the enclosing $localState scope passes.',
  example: 'formValid()',
  impl: (_args, env) => {
    const map = meta(env);
    const fields = env.context.$localScopeFields as string[] | undefined;
    if (!map || !fields) return true;
    return fields.every((name) => (map[name]?.errors().length ?? 0) === 0);
  },
});
