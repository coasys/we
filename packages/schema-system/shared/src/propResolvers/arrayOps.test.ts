/**
 * $filter's where grammar — in particular the OR/AND/NOT combinators, which
 * mirror $query's. Their absence forced single-field searches (a member list
 * matching handle only while the spaces list beside it matched name OR
 * description).
 */
import { describe, expect, it } from 'vitest';

import { resolveProp } from './index';

const members = [
  { name: 'Ada Lovelace', handle: 'ada', role: 'admin' },
  { name: 'Grace Hopper', handle: 'ghopper', role: 'member' },
  { name: 'Alan Turing', handle: 'alan', role: 'member' },
];

function filter(where: Record<string, unknown>, items: unknown[] = members): unknown[] {
  return resolveProp({ $filter: { items, where } }, {}, {}) as unknown[];
}

describe('$filter where combinators', () => {
  it('OR matches when any branch matches — the two-field search shape', () => {
    // "ada" appears in Ada's handle and in nobody's name but hers; "hopper"
    // only in Grace's handle; "turing" only in Alan's name.
    expect(filter({ OR: [{ name: { contains: 'turing' } }, { handle: { contains: 'turing' } }] })).toEqual([
      members[2],
    ]);
    expect(filter({ OR: [{ name: { contains: 'hopper' } }, { handle: { contains: 'hopper' } }] })).toEqual([
      members[1],
    ]);
  });

  it('siblings beside OR stay implicitly ANDed', () => {
    expect(filter({ role: 'member', OR: [{ name: { contains: 'a' } }, { handle: { contains: 'a' } }] })).toEqual([
      members[1],
      members[2],
    ]);
  });

  it('AND requires every branch; NOT inverts its clause', () => {
    expect(filter({ AND: [{ role: 'member' }, { name: { contains: 'grace' } }] })).toEqual([members[1]]);
    expect(filter({ NOT: { role: 'admin' } })).toEqual([members[1], members[2]]);
  });

  it('combinators nest', () => {
    expect(filter({ NOT: { OR: [{ handle: 'ada' }, { handle: 'alan' }] } })).toEqual([members[1]]);
  });

  it('malformed combinator shapes match nothing rather than everything', () => {
    expect(filter({ OR: 'not-an-array' as never })).toEqual([]);
    expect(filter({ NOT: 'not-a-clause' as never })).toEqual([]);
  });

  it('plain field conditions are untouched', () => {
    expect(filter({ role: 'admin' })).toEqual([members[0]]);
    expect(filter({ name: { contains: 'ADA' } })).toEqual([members[0]]);
  });
});
