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

/*
  `startsWith` / `endsWith` — anchored matches, which `$filter` was documented as supporting and did
  not. A clause it did not recognise fell through to equality against the operator *object*, so it
  matched nothing and reported that as "no results": a calendar cell asking whether any event's
  `startDate` began with its own date drew no marker on a month full of events.
*/
describe('$filter anchored string matches', () => {
  const events = [
    { title: 'Standup', startDate: '2026-08-15T09:00' },
    { title: 'Review', startDate: '2026-08-15T14:30' },
    { title: 'Retro', startDate: '2026-08-16T11:00' },
  ];

  it('matches a date prefix out of a datetime', () => {
    expect(filter({ startDate: { startsWith: '2026-08-15' } }, events)).toEqual([events[0], events[1]]);
    expect(filter({ startDate: { startsWith: '2026-08-17' } }, events)).toEqual([]);
  });

  it('matches a suffix', () => {
    expect(filter({ startDate: { endsWith: '09:00' } }, events)).toEqual([events[0]]);
  });

  it('is case-sensitive, unlike contains', () => {
    // These two exist to match structured strings against a known prefix — an ISO date, an id out
    // of a URI — where folding case would match things it should not. `contains` searches prose,
    // which is a different question and stays insensitive.
    const rows = [{ id: 'we://Task' }];
    expect(filter({ id: { startsWith: 'we://task' } }, rows)).toEqual([]);
    expect(filter({ id: { contains: 'WE://TASK' } }, rows)).toEqual(rows);
  });

  it('still ANDs with a sibling condition', () => {
    expect(filter({ startDate: { startsWith: '2026-08-15' }, title: 'Retro' }, events)).toEqual([]);
    expect(filter({ startDate: { startsWith: '2026-08-15' }, title: 'Review' }, events)).toEqual([events[1]]);
  });
});
