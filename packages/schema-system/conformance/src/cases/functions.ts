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
]);
