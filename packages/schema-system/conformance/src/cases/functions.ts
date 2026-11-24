/**
 * Function vector inputs: `{ id, name, args }` — `args` are already-encoded values, run through
 * the real built-in registry (`getFunction(name).impl(args, {context:{}, stores:{}})`), exactly
 * the path `env.call` takes inside an expression.
 *
 * Coverage: every function the bundle calls has at least three cases, one of them with an
 * `undefined` argument (the library's contract is totality — wrong input answers with the empty
 * value of its kind). The rest of the built-ins carry two each: a happy path and a bad-input one.
 * Host functions have their own file (`hostFunctions.ts`) and are excluded here even where the
 * bundle calls them — the coverage test checks either file.
 */
import type { EncodedValue } from '../encode';

export interface FunctionCase {
  id: string;
  name: string;
  /** Arguments in call order, encoded. `{$undefined:true}` is a deliberate operand. */
  args: EncodedValue[];
  /**
   * Call-time context (encoded). The form functions read `$localMeta` — a per-field map of
   * `{touched, errors}` that decodes to `touched()`/`errors()` accessors — and `$localScopeFields`.
   */
  context?: EncodedValue;
}

const U = { $undefined: true } as const;
const F = (name: string, ...args: EncodedValue[]): FunctionCase => ({ id: '', name, args });
const FC = (name: string, context: EncodedValue, ...args: EncodedValue[]): FunctionCase => ({
  id: '',
  name,
  args,
  context,
});
/** An encoded $localMeta entry: decodes to `{ touched(): boolean, errors(): string[] }`. */
const meta = (touched: boolean, errors: string[] = []) => ({
  $localMetaEntry: true,
  touched,
  errors,
});

let n = 0;
const numbered = (cases: Omit<FunctionCase, 'id'>[]): FunctionCase[] =>
  cases.map((c) => ({ ...c, id: `${c.name}.${++n}` }));

export const FUNCTION_CASES: FunctionCase[] = numbered([
  /* ---- the bundle's functions, three each, one with undefined ---- */
  F('count', [1, 2, 3]),
  F('count', 'a string'),
  F('count', U),
  F('count', 5),
  F('filter', [{ role: 'a' }, { role: 'b' }], { role: 'a' }),
  F('filter', [1, 2, 3, 4], { gt: 2 }),
  F('filter', U, { role: 'a' }),
  F('filter', 'notalist', { x: 1 }),
  F('find', [{ id: 1 }, { id: 2 }], { id: 2 }),
  F('find', [1, 2], { gt: 9 }),
  F('find', U, { id: 1 }),
  F('split', 'a,b,c'),
  F('split', 'a|b', '|'),
  F('split', ''),
  F('split', U),
  F('contains', 'Hello World', 'world'),
  F('contains', 'abc', 'd'),
  F('contains', U, 'x'),
  F('first', [1, 2, 3]),
  F('first', [{ id: 1 }], { id: 1 }),
  F('first', U),
  F('startsWith', 'prefix-body', 'prefix'),
  F('startsWith', 'body', 'pre'),
  F('startsWith', U, 'x'),
  F('distinct', [1, 1, 2], [2, 3]),
  F('distinct', [{ id: 1 }, { id: 1 }, { id: 2 }]),
  F('distinct', U),
  F('plural', 1, 'one', 'many'),
  F('plural', 3, 'one', 'many'),
  F('plural', U, 'one', 'many'),
  F('trim', '  padded  '),
  F('trim', 'clean'),
  F('trim', U),
  F('lower', 'MiXeD Case'),
  F('lower', 'already'),
  F('lower', U),
  F('join', ['a', 'b'], '-'),
  F('join', [1, 2], ', '),
  F('join', U, ','),

  /* ---- the remaining built-ins ---- */
  F('sum', [1, 2, 3]),
  F('sum', 'nonsense'),
  F('sum', U),
  F('last', [1, 2, 3]),
  F('last', U),
  F('reverse', [1, 2, 3]),
  F('reverse', U),
  F('upper', 'mixed'),
  F('upper', U),
  F('endsWith', 'body-suffix', 'suffix'),
  F('endsWith', 'body', 'x'),
  F('endsWith', U, 'x'),
  F('round', 3.7),
  F('round', 3.14159, 2),
  F('round', U),
  F('min', [3, 1, 2]),
  F('min', U),
  F('max', [3, 1, 2]),
  F('max', U),
  F('pick', { a: 1, b: 2, c: 3 }, ['a', 'c']),
  F('pick', { a: 1 }, 'a'),
  F('pick', U, ['a']),
  F('error', 'name'),
  F('error', U),
  F('valid', 'name'),
  F('valid', U),
  F('touched', 'name'),
  F('touched', U),
  F('formValid'),
  F('formValid', U),

  /* ---- semantics worth pinning down ---- */
  // count/first/last/reverse on non-lists and empties
  F('count', { a: 1 }),
  F('count', []),
  F('first', []),
  F('first', 'abc'),
  F('last', []),
  F('last', 'abc'),
  F('reverse', []),
  F('reverse', 'abc'),
  // sum coerces numerics, drops the rest
  F('sum', ['3', 2, 'x', null]),
  F('sum', []),
  // filter: non-record where passes the list through; limit slices (0 keeps nothing)
  F('filter', [1, 2, 3], 'notawhere'),
  F('filter', [1, 2, 3, 4], U, 2),
  F('filter', [{ role: 'a' }, { role: 'b' }, { role: 'a' }], { role: 'a' }, 1),
  F('filter', [1, 2, 3], U, 0),
  F('find', [{ id: 1 }, { id: 2 }], U),
  F('find', [], { id: 1 }),
  // distinct: records key on id, variadic merges, non-list contributes nothing
  F('distinct', [
    { id: 1, v: 'x' },
    { id: 1, v: 'y' },
  ]),
  F('distinct', [1, 2], 'notalist', [2, 3], { id: 9 }),
  F('distinct', [{ id: 1 }, { id: '1' }]),
  // join/split: defaults, coercion, empty-piece dropping
  F('join', ['a', 'b']),
  F('join', [1, true, null], '-'),
  F('join', [], '-'),
  F('split', 'a , b,, c', ','),
  F('split', 'a;b;c', ';'),
  F('split', U, ';'),
  // text: contains is case-insensitive, startsWith/endsWith are not
  F('contains', 'Prefix Body', 'PREFIX'),
  F('startsWith', 'Body', 'body'),
  F('endsWith', 'File.PNG', '.png'),
  F('lower', 'ÜNICODE ß'),
  F('upper', 'unicode ß'),
  F('trim', '\t\n spaced \r\n'),
  // plural is Number(n) === 1 — a numeric string counts
  F('plural', '1', 'one', 'many'),
  F('plural', 0, 'one', 'many'),
  // round: digits coerced, half-up via Math.round, float edges stay exact
  F('round', 2.5),
  F('round', -2.5),
  F('round', 2.675, 2),
  F('round', 'x'),
  // min/max are variadic over args, not over one list arg
  F('min', 3, 1, 2),
  F('min'),
  F('min', '5', 2),
  F('max', 3, 1, 2),
  F('max'),
  F('max', 'x', 2),
  // pick: missing keys skipped, denied names never read
  F('pick', { a: 1 }, ['a', 'missing']),
  F('pick', { constructor: 1, a: 2 }, ['constructor', 'a']),
  F('pick', [], ['a']),
  F('pick', { a: 1 }, U),
  // form state with $localMeta populated
  FC('error', { $localMeta: { email: meta(true, ['required']) } }, 'email'),
  FC('error', { $localMeta: { email: meta(false, ['required']) } }, 'email'),
  FC('error', { $localMeta: { email: meta(true, []) } }, 'email'),
  FC('valid', { $localMeta: { email: meta(true, ['required']) } }, 'email'),
  FC('valid', { $localMeta: { email: meta(true, []) } }, 'email'),
  FC('touched', { $localMeta: { email: meta(true) } }, 'email'),
  FC('formValid', {
    $localMeta: { a: meta(true, []), b: meta(false, ['bad']) },
    $localScopeFields: ['a', 'b'],
  }),
  FC('formValid', {
    $localMeta: { a: meta(true, []), b: meta(false, ['bad']) },
    $localScopeFields: ['a'],
  }),

  /*
    Everything below was added after the cases above were first recorded. It goes at the end because
    an id is its position, and a case inserted earlier would renumber every case after it.
  */

  /* ---- an absent value matches no comparison, `not` included; '' is absent ---- */
  F('filter', [{ role: 'a' }, { role: 'b' }, {}], { role: { not: 'a' } }),
  F('filter', [{ role: 'a' }, { role: '' }, { role: null }], { role: { not: 'a' } }),
  F('filter', [{ role: 'a' }, { role: 'c' }, {}], { role: { not: ['a', 'b'] } }),
  F('filter', [{ role: 'a' }, {}], { role: ['a', 'b'] }),
  F('filter', [{ n: 1 }, { n: 5 }, {}, { n: '' }], { n: { gt: 0 } }),
  F('filter', [{ n: 1 }, {}], { n: { lt: 9 } }),
  F('filter', [{ name: 'Ada' }, {}, { name: '' }], { name: { contains: '' } }),
  F('filter', [{ role: 'a' }, {}, { role: '' }], { role: '' }),
  F('filter', [{ role: 'a' }, {}, { role: '' }, { role: null }], { role: { exists: false } }),
  F('filter', [{ role: 'a' }, {}, { role: '' }], { role: { exists: true } }),
  // The way to include the absent ones is to ask for them; the NOT combinator negates the whole match.
  F('filter', [{ role: 'a' }, { role: 'b' }, {}], { OR: [{ role: { not: 'a' } }, { role: { exists: false } }] }),
  F('filter', [{ role: 'a' }, { role: 'b' }, {}], { NOT: { role: 'a' } }),
  F('find', [{ id: 1 }, { id: 2, role: 'b' }], { role: { not: 'a' } }),
  F('find', [{ id: 1, role: '' }], { role: { not: 'a' } }),

  /* ---- list functions ---- */
  F('concat', [1, 2], [2, 3]),
  F('concat', [1], 'notalist', [{ id: 'x' }]),
  F('concat', U, [1]),
  F('concat'),
  F('without', [1, 2, 3, 2], 2),
  F('without', [{ id: 'a' }, { id: 'b' }], 'a', { id: 'b' }),
  F('without', U, 1),
  F('without', [1, 2]),
  F('indexOf', ['a', 'b', 'a'], 'a'),
  F('indexOf', [{ id: 'a' }, { id: 'b' }], 'b'),
  F('indexOf', [1, 2], 9),
  F('indexOf', U, 1),
  F('insertAt', ['a', 'c'], 1, 'b'),
  F('insertAt', ['a'], -5, 'z'),
  F('insertAt', ['a'], 99, 'z'),
  F('insertAt', ['a'], 0, U),
  F('insertAt', U, 0, 'a'),
  F('insertAfter', ['a', 'c'], 'a', 'b'),
  F('insertAfter', [{ id: 'a' }, { id: 'c' }], 'a', { id: 'b' }),
  F('insertAfter', ['a'], 'missing', 'z'),
  F('insertAfter', ['a'], 'a', U),
  F('insertAfter', U, 'a', 'b'),
  F('slice', [1, 2, 3, 4, 5], 1, 3),
  F('slice', [1, 2, 3, 4, 5], -2),
  F('slice', [1, 2, 3], 'x'),
  F('slice', U, 0, 1),
  F('sortBy', [{ p: 3 }, { p: 1 }, { p: 2 }], 'p'),
  F('sortBy', [{ p: 1 }, { p: 3 }, { p: 2 }], 'p', 'desc'),
  F('sortBy', [{ n: 'b' }, { n: 'B' }, { n: 'a' }, { n: 2 }], 'n'),
  F('sortBy', [{ p: 2 }, {}, { p: '' }, { p: 1 }], 'p', 'desc'),
  F('sortBy', [{ a: { b: 2 } }, { a: { b: 1 } }], 'a.b'),
  F('sortBy', [{ p: 2 }, { p: 1 }], ''),
  F('sortBy', U, 'p'),

  /* ---- text ---- */
  F('slug', 'Hello  World'),
  F('slug', 'Café au lait!'),
  F('slug', '  --Mixed-Case  '),
  F('slug', 42),
  F('slug', { a: 1 }),
  F('slug', U),

  /* ---- objects ---- */
  F('put', { a: 1 }, 'b', 2),
  F('put', { a: 1, b: 2 }, 'b', U),
  F('put', { a: 1 }, 'a', ''),
  F('put', { a: 1 }, 7, 'x'),
  F('put', { a: 1 }, { not: 'a key' }, 'x'),
  F('put', U, 'a', 1),
  F('merge', { a: 1, b: 2 }, { b: 3, c: 4 }),
  F('merge', { a: { x: 1 } }, { a: { y: 2 } }),
  F('merge', { a: 1 }, { a: null }, 'notanobject'),
  F('merge', U, { a: 1 }),
  F('keys', { b: 1, a: 2, B: 3 }),
  F('keys', { a: 1, gone: null, empty: '' }),
  F('keys', [1, 2]),
  F('keys', U),
  F('values', { b: 1, a: 2 }),
  F('values', { a: 1, gone: null }),
  F('values', 'text'),
  F('values', U),

  /* ---- appended: new cases go here, so the ids above keep their positions ---- */
  // min/max over a list given as the only argument; a list beside other arguments is a non-number
  F('min', [4, 'x', 9]),
  F('min', []),
  F('min', [5], 2),
  F('max', [4, 'x', 9]),
  F('max', []),
  F('max', [-3, -1]),
  // no numeric result is -0
  F('round', -0.4),
  F('min', 0, { $number: '-0' }),
  F('max', [{ $number: '-0' }]),
  F('round', -0.004, 2),
]);
