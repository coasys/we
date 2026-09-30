/**
 * What "most used first" has to mean when the types are not comparable.
 *
 * A vocabulary can hold a like, a five-star rating, an up/down vote and a 0–100 slider at once, and
 * the obvious ordering — by what the reactions add up to — is wrong for every pair of them: three
 * five-star ratings would outrank fifteen likes, and a type people had voted down would sort below
 * one nobody had touched at all, so the busiest thing on the record would be pushed furthest down
 * it. Head count is the only reading that compares across modes, and these pin that.
 */
import { describe, expect, it } from 'vitest';

import { signalTypesByUse } from '../src/shared/sources/signalTypesByUse';

const types = [{ id: 'like' }, { id: 'stars' }, { id: 'vote' }];
const ids = (rows: unknown[]) => rows.map((row) => (row as { id: string }).id);

describe('reaction types, most used first', () => {
  it('orders by how many people reacted, not by what they said', () => {
    const signals = [
      // One five-star rating, which on any total of values is worth five likes.
      { signalTypeId: 'stars', value: 5, author: 'did:a' },
      { signalTypeId: 'like', value: 1, author: 'did:b' },
      { signalTypeId: 'like', value: 1, author: 'did:c' },
    ];
    expect(ids(signalTypesByUse({ types, signals }))).toEqual(['like', 'stars', 'vote']);
  });

  it('does not push a downvoted type below one nobody has used', () => {
    // Two people cared enough to vote it down. Summing values puts that at -2, behind an untouched
    // type's 0 — the reaction people are actually using, drawn last.
    const signals = [
      { signalTypeId: 'vote', value: -1, author: 'did:a' },
      { signalTypeId: 'vote', value: -1, author: 'did:b' },
    ];
    expect(ids(signalTypesByUse({ types, signals }))).toEqual(['vote', 'like', 'stars']);
  });

  it('keeps the vocabulary’s own order between types used the same amount', () => {
    /*
      A stable sort, so a panel does not reshuffle itself as reactions arrive one at a time — and so
      two surfaces showing the same record show it in the same order.
    */
    const signals = [
      { signalTypeId: 'like', value: 1, author: 'did:a' },
      { signalTypeId: 'stars', value: 3, author: 'did:b' },
      { signalTypeId: 'vote', value: 1, author: 'did:c' },
    ];
    expect(ids(signalTypesByUse({ types, signals }))).toEqual(['like', 'stars', 'vote']);
  });

  it('gives a muted author no say in the order', () => {
    const signals = [
      { signalTypeId: 'stars', value: 5, author: 'did:loud' },
      { signalTypeId: 'stars', value: 5, author: 'did:loud2' },
      { signalTypeId: 'like', value: 1, author: 'did:b' },
    ];
    const muted = ['did:loud', 'did:loud2'];
    expect(ids(signalTypesByUse({ types, signals, muted }))).toEqual(['like', 'stars', 'vote']);
  });

  it('keeps the first N of the order, not of the vocabulary', () => {
    // The point of ordering before limiting: a row with space for one mark shows the reaction being
    // used, not whichever was defined first.
    const signals = [{ signalTypeId: 'vote', value: 1, author: 'did:a' }];
    expect(ids(signalTypesByUse({ types, signals, limit: 1 }))).toEqual(['vote']);
    expect(signalTypesByUse({ types, signals, limit: 0 })).toEqual([]);
  });

  it('leaves the list it was given alone', () => {
    // It is handed a reactive array off a subscription; sorting in place would reorder what every
    // other reader sees, from a function whose whole job is to answer a question.
    const given = [...types];
    signalTypesByUse({ types: given, signals: [{ signalTypeId: 'vote', value: 1, author: 'did:a' }] });
    expect(ids(given)).toEqual(['like', 'stars', 'vote']);
  });

  it('holds an order somebody settled, whatever the counts do afterwards', () => {
    /*
      The bug this exists for: a reaction you have just WITHDRAWN slides down the column under your
      cursor. Worse than odd — `$each` gives a row its index as a value captured when the row
      rendered, so a row that moves keeps the index it was born with, and the line drawn between one
      type and the next went missing on exactly the row that moved.
    */
    const settled = ['like', 'stars', 'vote'];
    // Nobody likes it any more; stars is now the busiest. Nothing moves.
    const signals = [
      { signalTypeId: 'stars', value: 4, author: 'did:a' },
      { signalTypeId: 'stars', value: 5, author: 'did:b' },
      { signalTypeId: 'vote', value: 1, author: 'did:c' },
    ];
    expect(ids(signalTypesByUse({ types, signals, order: settled }))).toEqual(settled);
  });

  it('appends a type the settled order never saw, rather than dropping it', () => {
    // A community can define a reaction while somebody is looking at the panel. It appears — at the
    // end, because the whole point is not to move the rows they are reading.
    const order = ['vote'];
    const signals = [
      { signalTypeId: 'like', value: 1, author: 'did:a' },
      { signalTypeId: 'like', value: 1, author: 'did:b' },
      { signalTypeId: 'stars', value: 5, author: 'did:c' },
    ];
    expect(ids(signalTypesByUse({ types, signals, order }))).toEqual(['vote', 'like', 'stars']);
  });

  it('falls back to the live order when nothing has been settled', () => {
    // What a display shows before it has an order of its own — and what every surface that does not
    // keep one gets.
    const signals = [{ signalTypeId: 'vote', value: 1, author: 'did:a' }];
    expect(ids(signalTypesByUse({ types, signals, order: [] }))).toEqual(['vote', 'like', 'stars']);
  });

  it('drops an id from the settled order that is no longer offered', () => {
    // A retired type leaves the list it was ranked in; the ranking of the rest is unaffected.
    const order = ['stars', 'gone', 'like', 'vote'];
    expect(ids(signalTypesByUse({ types, signals: [], order }))).toEqual(['stars', 'like', 'vote']);
  });

  it('answers with a list for anything that is not one', () => {
    // Total, like every function an expression can call: a subscription that has not arrived yet is
    // undefined, and a display that threw on its first frame would never reach its second.
    expect(signalTypesByUse(undefined)).toEqual([]);
    expect(signalTypesByUse({ types: 'nonsense', signals: 3 })).toEqual([]);
    expect(ids(signalTypesByUse({ types, signals: undefined }))).toEqual(['like', 'stars', 'vote']);
  });
});
