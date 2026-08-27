import { describe, expect, it } from 'vitest';

import { markReactive } from '../propResolvers/reactive';
import { referencedPaths, referencedRoots } from './ast';
import { checkExpression, isCallTime } from './check';
import { exprToOperator, operatorToExpr } from './convert';
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

describe('conversion from operators', () => {
  const convert = (token: unknown) => {
    const ast = operatorToExpr(token);
    return ast ? printExpression(ast) : null;
  };

  it.each([
    [{ $store: 'spaceStore.members' }, 'spaceStore.members'],
    [{ $store: 'routeStore.segments.1' }, 'routeStore.segments[1]'],
    [{ $local: 'search' }, 'local.search'],
    [{ $eq: ['$item.role', 'admin'] }, "item.role == 'admin'"],
    [{ $not: { $store: 'a.b' } }, '!a.b'],
    [{ $and: [{ $local: 'a' }, { $local: 'b' }, '$c'] }, 'local.a && local.b && c'],
    [
      { $or: [{ $eq: ['$x', 1] }, { $gt: [{ $count: { items: { $local: 'rows' } } }, 0] }] },
      'x == 1 || count(local.rows) > 0',
    ],
    [{ $in: ['$item.role', ['admin', 'mod']] }, "item.role in ['admin', 'mod']"],
    [{ $concat: ['/space/', '$space.uuid', '/posts'] }, '`/space/${space.uuid}/posts`'],
    [{ $if: { condition: { $local: 'open' }, then: 'a', else: 'b' } }, "local.open ? 'a' : 'b'"],
    [{ $if: { condition: { $local: 'open' }, then: 'a' } }, "local.open ? 'a' : null"],
    [{ $count: { items: { $store: 'spaceStore.members' } } }, 'count(spaceStore.members)'],
    [
      {
        $filter: {
          items: { $store: 'spaceStore.members' },
          where: { role: 'admin', name: { contains: { $local: 's' } } },
          limit: 2,
        },
      },
      "filter(spaceStore.members, { role: 'admin', name: { contains: local.s } }, 2)",
    ],
    [
      { $find: { items: { $local: 'signalTypes' }, where: { slug: 'like' }, select: 'id' } },
      "find(local.signalTypes, { slug: 'like' }).id",
    ],
    [
      { $plural: { count: { $count: { items: '$x' } }, one: 'Member', other: 'Members' } },
      "plural(count(x), 'Member', 'Members')",
    ],
    [{ $pick: { from: { $store: 'a.b' }, props: ['c', '$likeCount'] } }, "pick(a.b, ['c', '$likeCount'])"],
    [
      { $map: { items: { $store: 'a.list' }, select: { name: '$item.meta.name', tag: '$literal', n: 1 } } },
      "a.list.map(item, { name: item.meta.name, tag: '$literal', n: 1 })",
    ],
    [
      { $source: { name: 'calendarMonth', options: { month: { $local: 'month' } } } },
      'calendarMonth({ month: local.month })',
    ],
    [{ $error: 'email' }, "error('email')"],
    [{ $formValid: '$scope' }, 'formValid()'],
  ])('%j', (token, printed) => {
    expect(convert(token)).toBe(printed);
  });

  it('refuses anything outside the value layer', () => {
    expect(convert({ $action: 'a.b' })).toBeNull();
    expect(convert({ $if: { condition: '$x', then: { type: 'we-text' } } })).toBeNull();
    expect(convert({ $if: { condition: '$x', then: [{ $action: 'a.b' }] } })).toBeNull();
    expect(convert({ $if: { condition: '$x', then: 'a', enterTransition: { type: 'fade' } } })).toBeNull();
    expect(convert({ $count: { items: { $query: { entity: 'Post' } } } })).toBeNull();
    expect(convert({ $store: 'wholeStore' })).toBeNull();
  });

  it('evaluates a converted tree exactly as the operator did', () => {
    const roots = { item: { role: 'admin', n: 3 }, list: ['admin'] };
    const ast = operatorToExpr({ $and: [{ $in: ['$item.role', '$list'] }, { $gt: ['$item.n', 2] }] })!;
    expect(evaluateExpression(ast, env(roots))).toBe(true);
  });
});

describe('conversion to operators, for the condition editor', () => {
  it.each([
    ['spaceStore.members.count() > 0', { $gt: [{ $count: { items: { $store: 'spaceStore.members' } } }, 0] }],
    ["local.a && item.b == 'x'", { $and: [{ $local: 'a' }, { $eq: ['$item.b', 'x'] }] }],
    ['!local.open', { $not: { $local: 'open' } }],
    ["item.role in ['a', 'b']", { $in: ['$item.role', ['a', 'b']] }],
    ["error('email')", { $error: 'email' }],
    ['formValid()', { $formValid: '$scope' }],
    ['modules.notes.open', { $store: 'modules.notes.open' }],
  ])('%s', (source, token) => {
    expect(exprToOperator(parseExpression(source))).toEqual(token);
  });

  it('returns null outside the editor subset', () => {
    expect(exprToOperator(parseExpression('a + b'))).toBeNull();
    expect(exprToOperator(parseExpression('items.filter(x, x.ok)'))).toBeNull();
  });
});
