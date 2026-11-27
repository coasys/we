import { describe, expect, it } from 'vitest';

import { referencedPaths, referencedRoots } from './ast';
import { checkExpression, isCallTime } from './check';
import { evaluateExpression, namespace } from './evaluate';
import { CORE_FUNCTIONS, defineFunction, getFunction, isCoreFunction, listFunctions } from './functions';
import { ExpressionSyntaxError, parseExpression } from './parser';
import { printExpression } from './printer';
import { markReactive } from './reactive';

const env = (roots: Record<string, unknown>, sources: Record<string, (options: unknown) => unknown> = {}) => ({
  root: (name: string) => ({ bound: name in roots, value: roots[name] }),
  call: (name: string, args: unknown[]) => {
    const fn = listFunctions().find((f) => f.name === name);
    if (fn) return fn.impl(args, { context: {}, stores: {} });
    return sources[name]?.(args[0]);
  },
});

const run = (source: string, roots: Record<string, unknown> = {}) =>
  evaluateExpression(parseExpression(source), env(roots));

describe('parsing and printing', () => {
  it.each([
    ["a.b == 'x'", "a.b == 'x'"],
    ['!a || b && c', '!a || b && c'],
    ['(a || b) && c', '(a || b) && c'],
    ['a ? b : c ? d : e', 'a ? b : c ? d : e'],
    ['(a ? b : c) == d', '(a ? b : c) == d'],
    ['a - (b - c)', 'a - (b - c)'],
    ['a - b - c', 'a - b - c'],
    ['-a * 2 + 1', '-a * 2 + 1'],
    ["count(items) > 0 && 'x' in list", "count(items) > 0 && 'x' in list"],
    ['items.filter(x, x.done).count()', 'items.filter(x, x.done).count()'],
    ["items.filter({ role: 'admin' }, 2)", "items.filter({ role: 'admin' }, 2)"],
    ['`hi ${me.handle}!`', '`hi ${me.handle}!`'],
    ['a[0].b["c-d"]', "a[0].b['c-d']"],
    ["{ 'a-b': 1, c: [1, 2] }", "{ 'a-b': 1, c: [1, 2] }"],
    ['a ?? b', 'a ?? b'],
    ['local.x != null', 'local.x != null'],
  ])('%s round-trips through the printer', (source, printed) => {
    const ast = parseExpression(source);
    expect(printExpression(ast)).toBe(printed);
    expect(printExpression(parseExpression(printed))).toBe(printed);
  });

  it('reports the column of a syntax error', () => {
    try {
      parseExpression('a.b == ');
      expect.fail('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionSyntaxError);
      expect((error as ExpressionSyntaxError).span[0]).toBe(7);
    }
  });

  it('positions an error inside a template hole against the whole source', () => {
    try {
      parseExpression('`x ${a +} y`');
      expect.fail('should throw');
    } catch (error) {
      expect((error as ExpressionSyntaxError).span[0]).toBe(8);
    }
  });

  it('refuses prototype access at parse time', () => {
    expect(() => parseExpression('a.__proto__')).toThrow(/not a readable property/);
    expect(() => parseExpression("a['constructor']")).toThrow(/not a readable property/);
    expect(() => parseExpression('{ __proto__: 1 }')).toThrow(/not a readable property/);
  });

  it('bounds nesting depth', () => {
    expect(() => parseExpression('('.repeat(60) + 'a' + ')'.repeat(60))).toThrow(/too deeply/);
  });
});

describe('evaluation', () => {
  it('reads context, store namespaces and locals through the tagging rule', () => {
    const store = namespace((member) =>
      member === 'members'
        ? markReactive(() => [{ role: 'admin' }, { role: 'member' }])
        : member === 'logout'
          ? () => 'CALLED'
          : undefined,
    );
    const roots = { spaceStore: store, item: { role: 'admin' } };
    expect(run("filter(spaceStore.members, { role: 'admin' }).count()", roots)).toBe(1);
    /*
      The arithmetic counterpart of `count`, and the reason it exists: a thread's caption counts the
      whole conversation, which is its replies plus each reply's own — and "how much" had no answer
      in a library that could already say "how many".
    */
    expect(run('sum(rows.map(r, count(r.kids)))', { rows: [{ kids: [1, 2] }, { kids: [] }, { kids: [3] }] })).toBe(3);
    /*
      A window anchored to the END of a list is the reason this exists: "the newest 200 lines" is a
      descending query, and a transcript is read oldest-first, so something has to turn one into the
      other. Nothing else in the grammar can — there is no sort and no index arithmetic — so without
      it a live feed cannot be bounded at all.
    */
    expect(run('reverse([1, 2, 3])', {})).toEqual([3, 2, 1]);
    // A new list: the one given is untouched, so reversing a query result does not disturb anything
    // else reading it.
    const original = [1, 2, 3];
    expect(run('reverse(rows)', { rows: original })).toEqual([3, 2, 1]);
    expect(original).toEqual([1, 2, 3]);
    // Total, like every other function here: not-a-list is the empty list, never a throw.
    expect(run('reverse(nothing)', {})).toEqual([]);
    expect(run("reverse('abc')", {})).toEqual([]);
    expect(run('spaceStore.members.count() > 1', roots)).toBe(true);
    expect(run('spaceStore.logout', roots)).toBeUndefined();
    expect(run('spaceStore', roots)).toBeUndefined();
    expect(run("item.role == 'admin'", roots)).toBe(true);
  });

  it('reaches a keyed namespace through an index, not only through a dot', () => {
    /*
      `a[b]` is `a.b` with the name computed, and for a while it was not: `readIndex` settled the
      object first, and settling turns a namespace into `undefined` — so a store keying its answers
      by an id it cannot enumerate was reachable one way and invisible the other.

      Invisible is the word. `modules.transcribe.interpretationFor[<call>].targets` came back undefined,
      `count(undefined)` is 0, and the interpretation panel said "No models are set up for AI interpretation
      here" — a sentence about the space, for a fault in the evaluator. Nothing warned, because a
      missing path is undefined by design.
    */
    const keyed = namespace((key) => ({ targets: [key], canInterpret: key !== 'empty' }));
    const roots = { store: namespace((member) => (member === 'byId' ? markReactive(() => keyed) : undefined)) };

    expect(run("store.byId['we://a-call'].targets", roots)).toEqual(['we://a-call']);
    expect(run("store.byId['we://a-call'].canInterpret", roots)).toBe(true);
    // The name is an expression, which is the whole reason an index is needed rather than a dot.
    expect(run('store.byId[item.id].targets', { ...roots, item: { id: 'we://another' } })).toEqual(['we://another']);
    expect(run("count(store.byId['we://a-call'].targets)", roots)).toBe(1);
  });

  it('splits a string into a list and joins it back, with no empty pieces', () => {
    expect(run("split('ImageBlock, TextBlock')")).toEqual(['ImageBlock', 'TextBlock']);
    expect(run("split('')")).toEqual([]);
    expect(run("split('a|b', '|')")).toEqual(['a', 'b']);
    expect(run("join(split('a,,b'), ',')")).toBe('a,b');
    expect(run("'b' in split('a,b')")).toBe(true);
  });

  it('is total on bad input', () => {
    expect(run('missing.deep.path')).toBeUndefined();
    expect(run('1 / 0')).toBe(0);
    expect(run("'a' + 1")).toBe('a1');
    expect(run('null + 1')).toBe(1);
    expect(run("'x' in 'xyz'")).toBe(false);
    expect(run('count(5)')).toBe(0);
    expect(run("sum('nonsense')")).toBe(0);
    expect(run('sum([1, "two", 3])')).toBe(4);
    expect(run('nothing.filter(x, x)')).toEqual([]);
    expect(run('nothing.map(x, x)')).toEqual([]);
    expect(run('nothing.all(x, x)')).toBe(true);
  });

  it('connectives answer with booleans; ?? picks a value', () => {
    expect(run("'' || 'fallback'")).toBe(true);
    expect(run("'x' && 'y'")).toBe(true);
    expect(run("'' && 'y'")).toBe(false);
    expect(run("'' ?? 'fallback'")).toBe('');
    expect(run("missing ?? 'fallback'")).toBe('fallback');
    expect(run('0 && missing.thing')).toBe(false);
  });

  it('interpolates templates', () => {
    expect(run('`${count(items)} ${plural(count(items), "one", "many")}`', { items: [1, 2] })).toBe('2 many');
    expect(run('`${missing}`')).toBe('');
  });

  it('binds macro variables without leaking them', () => {
    const roots = {
      items: [
        { n: 1, ok: true },
        { n: 2, ok: false },
      ],
      x: 'outer',
    };
    expect(run('items.filter(x, x.ok).map(x, x.n)', roots)).toEqual([1]);
    expect(run('items.map(y, x)', roots)).toEqual(['outer', 'outer']);
    expect(run('items.exists(x, x.n == 2)', roots)).toBe(true);
    expect(run('items.find(x, x.n == 2).n', roots)).toBe(2);
    expect(run('{ a: 1 }.map(x, x.a)', roots)).toBe(1);
  });

  it('lists each value once, across every list given', () => {
    // The key's question: the kinds interpretation wrote, and the kinds somebody placed, each once.
    const roots = {
      found: [{ __subjectClass: 'TaskBlock' }, { __subjectClass: 'EventBlock' }, { __subjectClass: 'TaskBlock' }],
      placements: [{ nodeType: 'NoteBlock' }, { nodeType: 'EventBlock' }],
    };
    expect(run('distinct(found.map(r, r.__subjectClass), placements.map(p, p.nodeType))', roots)).toEqual([
      'TaskBlock',
      'EventBlock',
      'NoteBlock',
    ]);
    // Records by id, so two reads of one record are one entry.
    expect(
      run('distinct(a, b).map(r, r.v)', {
        a: [{ id: 1, v: 'x' }],
        b: [
          { id: 1, v: 'y' },
          { id: 2, v: 'z' },
        ],
      }),
    ).toEqual(['x', 'z']);
    expect(run('distinct(nothing, [1, 1, 2])')).toEqual([1, 2]);
    expect(run('distinct()')).toEqual([]);
  });

  it('calls host sources after the built-ins', () => {
    const e = env({}, { calendarMonth: (options) => [(options as { month: number }).month] });
    expect(evaluateExpression(parseExpression('calendarMonth({ month: 8 })'), e)).toEqual([8]);
  });

  it('reads through the object-literal where grammar', () => {
    const items = [{ name: 'Anna', tags: ['a'] }, { name: 'Bob' }];
    expect(run("filter(items, { name: { contains: 'AN' } }).count()", { items })).toBe(1);
    expect(run("filter(items, { OR: [{ name: 'Bob' }, { name: 'Anna' }] }).count()", { items })).toBe(2);
    expect(run('find(items, { tags: { exists: false } }).name', { items })).toBe('Bob');
    expect(run("find(items, { name: 'Zed' }).name", { items })).toBeUndefined();
  });
  it('matches an absent value with no comparison but exists, as a $query does', () => {
    const items = [
      { name: 'Anna', role: 'admin' },
      { name: 'Bob', role: 'member' },
      { name: 'Cy' },
      { name: 'Di', role: '' },
    ];
    expect(run("filter(items, { role: { not: 'admin' } }).map(i, i.name)", { items })).toEqual(['Bob']);
    expect(run("filter(items, { role: { not: ['admin', 'owner'] } }).map(i, i.name)", { items })).toEqual(['Bob']);
    expect(run("filter(items, { role: { contains: '' } }).map(i, i.name)", { items })).toEqual(['Anna', 'Bob']);
    expect(run("filter(items, { role: '' }).map(i, i.name)", { items })).toEqual([]);
    expect(run('filter(items, { role: { exists: false } }).map(i, i.name)', { items })).toEqual(['Cy', 'Di']);
    expect(run("find(items, { role: { not: 'member' } }).name", { items })).toBe('Anna');
  });
  it('takes range bounds in a where-object, with the same meaning a $query gives them', () => {
    const roots = {
      events: [
        { id: 'a', startDate: '2026-09-14', seats: 4 },
        { id: 'b', startDate: '2026-09-30T18:00', seats: '12' },
        { id: 'c', startDate: '2026-10-02', seats: 20 },
      ],
    };
    expect(run("filter(events, { startDate: { gte: '2026-09-15', lt: '2026-10-01' } }).map(e, e.id)", roots)).toEqual([
      'b',
    ]);
    // A string stored where a number was meant matches no numeric bound, rather than being coerced.
    expect(run('filter(events, { seats: { gt: 5 } }).map(e, e.id)', roots)).toEqual(['c']);
  });
});

describe('the functions a declared operation builds its writes with', () => {
  const a = { id: 'a', n: 1 };
  const aAgain = { id: 'a', n: 99 };
  const b = { id: 'b', n: 2 };

  it('slug: the rule the stores name types by, to the character', () => {
    // The same steps as the app's slug derivation, so a converted store write stores the same slug.
    const stores = (name: string) =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
    const names = [
      'In Progress',
      '  Needs   review ',
      'Café au lait',
      'a - b',
      '-leading',
      'snake_case/and.dots',
      'Ünïcödé',
      'ALL CAPS 2026',
      'tab\tand\nnewline',
      '',
    ];
    for (const name of names) expect(run('slug(t)', { t: name })).toBe(stores(name));
    expect(run('slug(t)', { t: 'In Progress' })).toBe('in-progress');
    expect(run('slug(t)', { t: 'Café au lait' })).toBe('caf-au-lait');
    expect(run('slug(12)')).toBe('12');
    expect(run('slug(t)', { t: { name: 'x' } })).toBe('');
    expect(run('slug(t)', {})).toBe('');
  });

  it('concat: every list in order, repeats kept, non-lists contributing nothing', () => {
    expect(run('concat([1, 2], [2, 3], missing, 4, [])', {})).toEqual([1, 2, 2, 3]);
    expect(run('concat()', {})).toEqual([]);
    const list = [1];
    expect(run('concat(list, [2])', { list })).toEqual([1, 2]);
    expect(list).toEqual([1]);
  });

  it('without: every equal entry out, records by id', () => {
    expect(run('without([1, 2, 1, 3], 1, 3)', {})).toEqual([2]);
    expect(run('without(items, other)', { items: [a, b], other: aAgain })).toEqual([b]);
    // A record and its id name the same entry, as they do in distinct.
    expect(run("without(items, 'b')", { items: [a, b] })).toEqual([a]);
    expect(run("without(ids, 'a')", { ids: ['a', 'b', 'a'] })).toEqual(['b']);
    expect(run('without(items)', { items: [a] })).toEqual([a]);
    expect(run('without(missing, 1)', {})).toEqual([]);
    expect(run("without('abc', 'a')", {})).toEqual([]);
  });

  it('indexOf: the first equal entry, -1 when absent or not a list', () => {
    expect(run("indexOf(['x', 'y', 'y'], 'y')", {})).toBe(1);
    expect(run('indexOf(items, other)', { items: [b, a], other: aAgain })).toBe(1);
    expect(run("indexOf(items, 'z')", { items: [a, b] })).toBe(-1);
    expect(run('indexOf(missing, 1)', {})).toBe(-1);
    expect(run('indexOf([1, missing], missing)', {})).toBe(1);
  });

  it('insertAt: a new list, the index clamped', () => {
    const list = ['a', 'b'];
    expect(run("insertAt(list, 1, 'x')", { list })).toEqual(['a', 'x', 'b']);
    expect(list).toEqual(['a', 'b']);
    expect(run("insertAt(list, 0, 'x')", { list })).toEqual(['x', 'a', 'b']);
    expect(run("insertAt(list, -4, 'x')", { list })).toEqual(['x', 'a', 'b']);
    expect(run("insertAt(list, 99, 'x')", { list })).toEqual(['a', 'b', 'x']);
    expect(run("insertAt(list, 1.7, 'x')", { list })).toEqual(['a', 'x', 'b']);
    expect(run("insertAt(list, 'nope', 'x')", { list })).toEqual(['x', 'a', 'b']);
    expect(run('insertAt(list, 1, missing)', { list })).toEqual(['a', 'b']);
    // The record with no list yet is the first case of every one of these.
    expect(run("insertAt(missing, 3, 'x')", {})).toEqual(['x']);
  });

  it('insertAfter: straight after the anchor, appended when the anchor is not there', () => {
    const list = ['a', 'b', 'c'];
    expect(run("insertAfter(list, 'a', 'x')", { list })).toEqual(['a', 'x', 'b', 'c']);
    expect(run("insertAfter(list, 'c', 'x')", { list })).toEqual(['a', 'b', 'c', 'x']);
    expect(run("insertAfter(list, 'z', 'x')", { list })).toEqual(['a', 'b', 'c', 'x']);
    expect(run("insertAfter(list, missing, 'x')", { list })).toEqual(['a', 'b', 'c', 'x']);
    expect(run("insertAfter(list, 'a', missing)", { list })).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c']);
    expect(run('insertAfter(items, other, b)', { items: [a, { id: 'c' }], other: aAgain, b })).toEqual([
      a,
      b,
      { id: 'c' },
    ]);
    expect(run("insertAfter(missing, 'a', 'x')", {})).toEqual(['x']);
  });

  it('slice: as JavaScript slices, negative positions from the end', () => {
    const list = [1, 2, 3, 4, 5];
    expect(run('slice(list, 1, 3)', { list })).toEqual([2, 3]);
    expect(run('slice(list, -2)', { list })).toEqual([4, 5]);
    expect(run('slice(list, 1, -1)', { list })).toEqual([2, 3, 4]);
    expect(run('slice(list, 4, 2)', { list })).toEqual([]);
    expect(run('slice(list, 0, 99)', { list })).toEqual(list);
    expect(run("slice(list, 'x')", { list })).toEqual(list);
    expect(run('slice(missing, 0, 2)', {})).toEqual([]);
    expect(run("slice('abc', 0, 2)", {})).toEqual([]);
  });

  it('sortBy: stable, numbers as numbers, text by code point, absent last both ways', () => {
    const rows = [
      { id: 1, at: 10, name: 'b', meta: { rank: 2 } },
      { id: 2, name: 'B', meta: { rank: 1 } },
      { id: 3, at: 2, name: 'a', meta: {} },
      { id: 4, at: 10, name: 'é' },
      { id: 5, at: null, name: 'a' },
    ];
    const ids = (source: string) => (run(source, { rows }) as { id: number }[]).map((r) => r.id);
    expect(ids("sortBy(rows, 'at')")).toEqual([3, 1, 4, 2, 5]);
    expect(ids("sortBy(rows, 'at', 'asc')")).toEqual([3, 1, 4, 2, 5]);
    // Equal keys keep their order in either direction; absent stays last.
    expect(ids("sortBy(rows, 'at', 'desc')")).toEqual([1, 4, 3, 2, 5]);
    // Code point order: 'B' (U+0042) before 'a' before 'b' before 'é', whatever the locale says.
    expect(ids("sortBy(rows, 'name')")).toEqual([2, 3, 5, 1, 4]);
    expect(ids("sortBy(rows, 'meta.rank')")).toEqual([2, 1, 3, 4, 5]);
    expect(ids("sortBy(rows, 'meta.rank', 'desc')")).toEqual([1, 2, 3, 4, 5]);
    // Past U+FFFF, by code point rather than by UTF-16 unit: U+1F600 sorts after U+FF5E.
    expect(run("sortBy(rows, 'k').map(r, r.k)", { rows: [{ k: '\u{1F600}' }, { k: '～' }] })).toEqual([
      '～',
      '\u{1F600}',
    ]);
    // Numbers before text, so a mixed column has one order.
    expect(run("sortBy(rows, 'v').map(r, r.v)", { rows: [{ v: 'x' }, { v: 3 }, { v: 1 }] })).toEqual([1, 3, 'x']);
    // '' is no value, so it sorts with the absent ones rather than first among the text.
    expect(
      run("sortBy(rows, 'v').map(r, r.id)", {
        rows: [
          { id: 1, v: '' },
          { id: 2, v: 'a' },
        ],
      }),
    ).toEqual([2, 1]);
    expect(
      run("sortBy(rows, 'v', 'desc').map(r, r.id)", {
        rows: [
          { id: 1, v: '' },
          { id: 2, v: 1 },
        ],
      }),
    ).toEqual([2, 1]);
    expect(run("sortBy(rows, '').map(r, r.id)", { rows })).toEqual([1, 2, 3, 4, 5]);
    expect(run("sortBy(missing, 'at')", {})).toEqual([]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('put: one key set or removed, on a new object', () => {
    const settings = { feed: { open: true }, call: { open: false } };
    expect(run("put(settings, 'call', { open: true })", { settings })).toEqual({
      feed: { open: true },
      call: { open: true },
    });
    expect(settings.call.open).toBe(false);
    expect(run("put(settings, 'call', missing)", { settings })).toEqual({ feed: { open: true } });
    expect(run("put(missing, 'x', 1)", {})).toEqual({ x: 1 });
    expect(run('put(settings, 3, 1)', { settings: {} })).toEqual({ 3: 1 });
    expect(run('put(settings, missing, 1)', { settings })).toEqual(settings);
    // A key that would reach the prototype is refused, not written.
    const polluted = run("put({}, '__proto__', { bad: true })", {}) as Record<string, unknown>;
    expect(Object.getPrototypeOf(polluted)).toBe(Object.prototype);
    expect(polluted).toEqual({});
  });

  it('merge: shallow, later wins, absent never overrides', () => {
    expect(run('merge({ a: 1, b: { x: 1 } }, { b: { y: 2 }, c: 3 }, missing, [1])', {})).toEqual({
      a: 1,
      b: { y: 2 },
      c: 3,
    });
    expect(run('merge({ a: 1 }, { a: missing })', {})).toEqual({ a: 1 });
    expect(run('merge()', {})).toEqual({});
  });

  it('keys and values: in code point order, absent values left out', () => {
    const object = { b: 1, a: 2, 10: 'ten', 9: 'nine', gone: undefined };
    expect(run('keys(object)', { object })).toEqual(['10', '9', 'a', 'b']);
    expect(run('values(object)', { object })).toEqual(['ten', 'nine', 2, 1]);
    expect(run('keys(missing)', {})).toEqual([]);
    expect(run('values([1, 2])', {})).toEqual([]);
  });

  it('are core, so a declared operation may call them', () => {
    const scope = {
      storeNames: new Set<string>(),
      storeMembers: new Map<string, Set<string>>(),
      locals: null,
      contextNames: new Set(['input']),
      strict: true,
      functions: 'core' as const,
    };
    for (const name of [
      'slug',
      'concat',
      'without',
      'insertAt',
      'insertAfter',
      'slice',
      'sortBy',
      'put',
      'merge',
      'keys',
      'values',
      'indexOf',
    ]) {
      expect(isCoreFunction(name)).toBe(true);
    }
    expect(
      checkExpression(
        parseExpression(
          "sortBy(concat(without(input.a, 'x'), slice(input.b, 1)), 'k').map(r, slug(r.name)).count() + indexOf(insertAfter(insertAt(input.a, 0, 1), 1, 2), 2) + count(keys(merge(put(input.o, 'k', 1), input.p))) + count(values(input.o))",
        ),
        scope,
      ),
    ).toEqual([]);
  });
});

describe('references', () => {
  it('lists roots and paths, excluding macro variables', () => {
    const ast = parseExpression('spaceStore.members.filter(m, m.role == local.role).count() > item.n');
    expect([...referencedRoots(ast)].sort()).toEqual(['item', 'local', 'spaceStore']);
    expect(referencedPaths(ast).map((p) => [p.root, ...p.path].join('.'))).toEqual([
      'spaceStore.members',
      'local.role',
      'item.n',
    ]);
  });

  it('knows which expressions are call-time', () => {
    expect(isCallTime(parseExpression('event.detail'))).toBe(true);
    expect(isCallTime(parseExpression("arg.value == 'x'"))).toBe(true);
    expect(isCallTime(parseExpression('local.x'))).toBe(false);
  });
});

describe('checking', () => {
  const scope = {
    storeNames: new Set(['spaceStore', 'modules']),
    storeMembers: new Map([['spaceStore', new Set(['members', 'currentSpace'])]]),
    locals: new Set(['search']),
    contextNames: new Set(['post']),
    strict: true,
  };
  const check = (source: string) => checkExpression(parseExpression(source), scope);

  it('accepts what is in scope', () => {
    expect(check("spaceStore.members.count() > 0 && local.search != '' && post.title && modules.notes.open")).toEqual(
      [],
    );
  });

  it('names the mistake and the column', () => {
    const [issue] = check('spaceStore.membrs.count()');
    expect(issue.message).toMatch(/Unknown member "membrs".*did you mean spaceStore\.members/);
    expect(issue.span).toEqual([0, 17]);
    expect(check('local.serch')[0].message).toMatch(/did you mean local\.search/);
    expect(check('psot.title')[0].message).toMatch(/Unknown name "psot".*did you mean "post"/);
    expect(check('spaceStore')[0].message).toMatch(/is a store, not a value/);
    expect(check('cont(post.tags)')[0].message).toMatch(/did you mean count\(\)/);
    expect(check('count()')[0].message).toMatch(/takes 1 argument, given 0/);
    expect(check('post.tags.count(1)')[0].message).toMatch(/given 2/);
  });

  it('warns when text or a number sits beside && or ||, which answer true or false', () => {
    // The timeline that showed "true" where its date belonged.
    const [fallback] = check("post.title || 'Untitled'");
    expect(fallback.severity).toBe('warning');
    expect(fallback.message).toMatch(/never one of its sides.*a \? a : 'text'/);
    expect(check('local.search && `Searching ${local.search}`')[0].message).toMatch(/condition \? 'text' : ''/);
    expect(check('post.count || 0')).toHaveLength(1);
    // Conditions, booleans and the fallback operator that does answer with a side are left alone.
    expect(check("post.title || local.search != ''")).toEqual([]);
    expect(check('post.done || false')).toEqual([]);
    expect(check("post.title ?? 'Untitled'")).toEqual([]);
    expect(check("post.title ? post.title : 'Untitled'")).toEqual([]);
  });

  it('is lenient about unknown roots in a fragment', () => {
    expect(checkExpression(parseExpression('anything.at.all'), { ...scope, strict: false, locals: null })).toEqual([]);
  });

  it('refuses a member named under a store that keeps it but does not expose it, saying what to write', () => {
    const moved = { ...scope, movedMembers: new Map([['spaceStore.memberDids', 'identity.memberDids']]) };
    const [issue] = checkExpression(parseExpression('count(spaceStore.memberDids)'), moved);
    expect(issue.severity).toBe('error');
    expect(issue.message).toBe(
      'spaceStore.memberDids is not reachable under its store: it is a profile member, written identity.memberDids',
    );
  });

  it('warns when a bound name hides a namespace whose member it then reads', () => {
    const named = {
      ...scope,
      storeNames: new Set([...scope.storeNames, 'layout']),
      storeMembers: new Map([...scope.storeMembers, ['layout', new Set(['collapsedLanes'])]]),
      contextNames: new Set(['layout']),
    };
    const [issue] = checkExpression(parseExpression("'left' in layout.collapsedLanes"), named);
    expect(issue.severity).toBe('warning');
    expect(issue.message).toMatch(/"layout" here is the name an enclosing node bound/);
    // The row's own fields are the row's.
    expect(checkExpression(parseExpression('layout.name'), named)).toEqual([]);
  });
});

describe('the core subset', () => {
  // A host's function, registered the way a host registers one: after the core library has loaded.
  defineFunction({
    name: 'hostGreeting',
    category: 'text',
    params: ['name', 'field?'],
    namesLocal: true,
    doc: 'A host function, for the test.',
    example: "hostGreeting('search')",
    impl: ([name]) => `hello ${String(name)}`,
  });

  const scope = {
    storeNames: new Set<string>(),
    storeMembers: new Map<string, Set<string>>(),
    locals: new Set(['search']),
    contextNames: new Set(['input']),
    strict: true,
    hostFunctions: new Set(['calendarMonth']),
  };
  const check = (source: string, functions?: 'all' | 'core') =>
    checkExpression(parseExpression(source), { ...scope, functions });

  it('is every function the language defines, and none a host adds', () => {
    for (const name of ['count', 'filter', 'find', 'distinct', 'join', 'plural', 'round', 'pick']) {
      expect(isCoreFunction(name)).toBe(true);
    }
    expect(CORE_FUNCTIONS.has('hostGreeting')).toBe(false);
    expect(getFunction('hostGreeting')).toBeDefined();
    expect([...CORE_FUNCTIONS].every((name) => getFunction(name) !== undefined)).toBe(true);
  });

  it('cannot be redefined by a host', () => {
    expect(() =>
      defineFunction({ name: 'count', category: 'list', params: ['items'], doc: '', example: '', impl: () => 0 }),
    ).toThrow(/core expression function/);
    expect(getFunction('count')?.impl([[1, 2]], { context: {}, stores: {} })).toBe(2);
  });

  it("refuses a host function under functions: 'core', however it was registered", () => {
    expect(check("count(input.items) > 0 && join(input.tags, ', ') != ''", 'core')).toEqual([]);

    const [registered] = check("hostGreeting('search')", 'core');
    expect(registered.severity).toBe('error');
    expect(registered.message).toMatch(/"hostGreeting" is not a core function/);

    const [source] = check('calendarMonth({})', 'core');
    expect(source.severity).toBe('error');
    expect(source.message).toMatch(/"calendarMonth" is not a core function/);

    // The nearest name offered is a core one.
    expect(check('cont(input.items)', 'core')[0].message).toMatch(/did you mean count\(\)/);
  });

  it('admits host functions by default', () => {
    expect(check("hostGreeting('search')")).toEqual([]);
    expect(check('calendarMonth({})', 'all')).toEqual([]);
  });

  it('holds a namesLocal argument to the declared locals', () => {
    expect(check("hostGreeting('serch')")[0].message).toMatch(/names a field \$localState does not declare.*'search'/);
  });
});
