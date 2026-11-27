import { describe, expect, it } from 'vitest';

import { compileQuery, type FlatQuery } from './queryCompiler';
import { executeQueryIR, type Row } from './queryEngine';
import { compareValue, matchesWhere } from './whereMatch';

const ROWS: Row[] = [
  { id: 'set', assignee: 'Ann', title: 'Report', points: 3 },
  { id: 'other', assignee: 'Bob', title: 'review', points: 8 },
  { id: 'never', title: 'Untouched' },
  { id: 'null', assignee: null, title: 'Nulled' },
  { id: 'empty', assignee: '', title: '' },
];

/** The ids `filter()` keeps, and the ids the reference engine's `$query` returns, for one where. */
function both(where: Record<string, unknown>) {
  const client = ROWS.filter((row) => matchesWhere(row, where)).map((row) => row.id);
  const { ir } = compileQuery({ entity: 'Task', where } as FlatQuery);
  const query = executeQueryIR(ir, { tables: { Task: ROWS } }).map((row) => row.id);
  return { client, query };
}

describe('an absent value matches no comparison', () => {
  const cases: [string, Record<string, unknown>, string[]][] = [
    ['equality', { assignee: 'Ann' }, ['set']],
    ["equality with ''", { assignee: '' }, []],
    ['inequality', { assignee: { not: 'Ann' } }, ['other']],
    ['exclusion from a list', { assignee: { not: ['Ann', 'Cy'] } }, ['other']],
    ['membership', { assignee: ['Ann', 'Bob'] }, ['set', 'other']],
    ['contains', { assignee: { contains: '' } }, ['set', 'other']],
    ['startsWith', { title: { startsWith: 'R' } }, ['set']],
    ['endsWith', { title: { endsWith: 'ed' } }, ['never', 'null']],
    ['a range', { points: { gte: 0 } }, ['set', 'other']],
    ['NOT around an equality', { NOT: { assignee: 'Ann' } }, ['other', 'never', 'null', 'empty']],
  ];

  for (const [name, where, expected] of cases) {
    it(`${name}, the same in filter() as in a $query`, () => {
      const { client, query } = both(where);
      expect(client).toEqual(expected);
      expect(query).toEqual(expected);
    });
  }

  it('asks about absence only through exists', () => {
    expect(both({ assignee: { exists: false } }).client).toEqual(['never', 'null', 'empty']);
    expect(both({ assignee: { exists: true } }).client).toEqual(['set', 'other']);
    // The spelling that includes the absent ones in an inequality.
    expect(both({ OR: [{ assignee: { not: 'Ann' } }, { assignee: { exists: false } }] }).client).toEqual([
      'other',
      'never',
      'null',
      'empty',
    ]);
  });

  it('answers a malformed combinator with nothing rather than throwing', () => {
    expect(matchesWhere(ROWS[0], { OR: 'no' })).toBe(false);
    expect(matchesWhere(ROWS[0], { NOT: [] })).toBe(false);
  });

  it('reads a field through the reader it is given', () => {
    expect(matchesWhere({ secret: 'x' }, { secret: 'x' }, () => undefined)).toBe(false);
  });

  it('compares an absent value with nothing, exists aside', () => {
    for (const absent of [undefined, null, '']) {
      expect(compareValue(absent, 'ne', 'x')).toBe(false);
      expect(compareValue(absent, 'nin', ['x'])).toBe(false);
      expect(compareValue(absent, 'eq', absent as null)).toBe(false);
      expect(compareValue(absent, 'exists', false)).toBe(true);
    }
  });
});
