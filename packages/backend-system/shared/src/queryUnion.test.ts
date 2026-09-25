import { describe, expect, it } from 'vitest';

import { combineEntityRows, entityNamesOf } from './queryUnion';
import { RECORD_TYPE_KEY } from './recordContract';

describe('which entities a query names', () => {
  it('reads a name as one entity, not a union', () => {
    expect(entityNamesOf('TaskBlock')).toEqual({ names: ['TaskBlock'], union: false });
  });

  it('reads a list as a union, even a list of one', () => {
    // A template computing its kinds from data does not know how many there will be, and the rows
    // it reads must say what they are whether one kind came back or five.
    expect(entityNamesOf(['TaskBlock'])).toEqual({ names: ['TaskBlock'], union: true });
  });

  it('answers an empty list, rather than waiting on it', () => {
    // "No kinds" is a result: the query has nothing to ask, so it is loaded and empty.
    expect(entityNamesOf([])).toEqual({ names: [], union: true });
  });

  it('drops blank and repeated names, keeping the order written', () => {
    expect(entityNamesOf(['EventBlock', '', 'TaskBlock', 'EventBlock', 3])).toEqual({
      names: ['EventBlock', 'TaskBlock'],
      union: true,
    });
  });

  it('has not answered while the name has not resolved', () => {
    expect(entityNamesOf('')).toBeUndefined();
    expect(entityNamesOf(undefined)).toBeUndefined();
  });
});

describe('putting several entities’ answers back together', () => {
  it('says what each row is', () => {
    const rows = combineEntityRows([
      { entity: 'TaskBlock', rows: [{ id: 't1' }] },
      { entity: 'EventBlock', rows: [{ id: 'e1' }] },
    ]);
    expect(rows.map((row) => row[RECORD_TYPE_KEY])).toEqual(['TaskBlock', 'EventBlock']);
  });

  it('keeps a concrete class the backend already reported', () => {
    const rows = combineEntityRows([{ entity: 'Block', rows: [{ id: 'n1', [RECORD_TYPE_KEY]: 'NoteBlock' }] }]);
    expect(rows[0][RECORD_TYPE_KEY]).toBe('NoteBlock');
  });

  it('copies an id that lives on the prototype', () => {
    class Instance {
      get id() {
        return 'r1';
      }
    }
    const rows = combineEntityRows([{ entity: 'TaskBlock', rows: [new Instance()] }]);
    expect(rows[0].id).toBe('r1');
  });

  it('lists a record two entities answered with once, as the first', () => {
    const rows = combineEntityRows([
      { entity: 'TaskBlock', rows: [{ id: 'r1' }] },
      { entity: 'Block', rows: [{ id: 'r1' }, { id: 'r2' }] },
    ]);
    expect(rows.map((row) => [row.id, row[RECORD_TYPE_KEY]])).toEqual([
      ['r1', 'TaskBlock'],
      ['r2', 'Block'],
    ]);
  });

  it('orders and limits the whole list, not each part', () => {
    const rows = combineEntityRows(
      [
        {
          entity: 'TaskBlock',
          rows: [
            { id: 't1', at: 3 },
            { id: 't2', at: 1 },
          ],
        },
        { entity: 'EventBlock', rows: [{ id: 'e1', at: 2 }, { id: 'e2' }] },
      ],
      { order: { at: 'asc' }, limit: 3 },
    );
    expect(rows.map((row) => row.id)).toEqual(['t2', 'e1', 't1']);
  });

  it('sorts a missing value last in either direction', () => {
    const rows = combineEntityRows(
      [
        { entity: 'A', rows: [{ id: 'a', at: null }] },
        {
          entity: 'B',
          rows: [
            { id: 'b', at: 1 },
            { id: 'c', at: 2 },
          ],
        },
      ],
      { order: { at: 'desc' } },
    );
    expect(rows.map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('leaves the order alone when none was asked for', () => {
    const rows = combineEntityRows([
      { entity: 'A', rows: [{ id: 'z' }] },
      { entity: 'B', rows: [{ id: 'a' }] },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['z', 'a']);
  });
});
