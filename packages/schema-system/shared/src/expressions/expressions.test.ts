import { describe, expect, it } from 'vitest';

import { markReactive } from '../propResolvers/reactive';
import { referencedPaths, referencedRoots } from './ast';
import { checkExpression, isCallTime } from './check';
import { evaluateExpression, namespace } from './evaluate';
import { listFunctions } from './functions';
import { ExpressionSyntaxError, parseExpression } from './parser';
import { printExpression } from './printer';

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
    expect(run('spaceStore.members.count() > 1', roots)).toBe(true);
    expect(run('spaceStore.logout', roots)).toBeUndefined();
    expect(run('spaceStore', roots)).toBeUndefined();
    expect(run("item.role == 'admin'", roots)).toBe(true);
  });

  it('is total on bad input', () => {
    expect(run('missing.deep.path')).toBeUndefined();
    expect(run('1 / 0')).toBe(0);
    expect(run("'a' + 1")).toBe('a1');
    expect(run('null + 1')).toBe(1);
    expect(run("'x' in 'xyz'")).toBe(false);
    expect(run('count(5)')).toBe(0);
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

  it('is lenient about unknown roots in a fragment', () => {
    expect(checkExpression(parseExpression('anything.at.all'), { ...scope, strict: false, locals: null })).toEqual([]);
  });
});
