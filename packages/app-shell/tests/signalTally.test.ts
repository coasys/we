/**
 * The number a record's reactions are read as, lent to templates.
 *
 * The rules are the type's, not the caller's — which is the whole reason this is one function
 * rather than an averaging somebody writes in a template. A community that sets `median` gets a
 * median; one that leaves the manifest's default `count` on a rating does not get a headcount where
 * the stars say a score.
 */
import { describe, expect, it } from 'vitest';

import { signalTally } from '../src/shared/sources/signalTally';

const like = { icon: 'heart', mode: 'toggle', rangeMin: 0, rangeMax: 1 } as const;
const vote = { icon: 'arrow-fat-up', mode: 'vote', rangeMin: -1, rangeMax: 1 } as const;
const stars = { icon: 'star', mode: 'rating', rangeMin: 0, rangeMax: 5 } as const;

const of = (...values: number[]) => values.map((value, i) => ({ signalTypeId: 't', value, author: `did:${i}` }));

describe('signalTally', () => {
  it('counts a toggle, and a withdrawal is not a reaction', () => {
    expect(signalTally({ signals: of(1, 1, 0, 1), type: like })).toBe(3);
  });

  it('nets a vote out, so agreement and disagreement do not add up', () => {
    // Three for and three against is 0, not 6 — the trap that makes `count` wrong for this mode.
    expect(signalTally({ signals: of(1, 1, 1, -1, -1, -1), type: vote })).toBe(0);
  });

  it('averages a rating to one decimal place', () => {
    expect(signalTally({ signals: of(5, 4, 3), type: stars })).toBe(4);
    expect(signalTally({ signals: of(5, 4), type: stars })).toBe(4.5);
  });

  it('ignores an aggregate the mode cannot express, rather than obeying it', () => {
    /*
      `aggregate` defaults to `count` in the manifest and no form has ever asked for it, so every
      type a community has made so far carries `count` whatever its mode. Obeyed literally, every
      existing rating would have become a headcount on upgrade.
    */
    expect(signalTally({ signals: of(5, 4, 3), type: { ...stars, aggregate: 'count' } })).toBe(4);
    // A median IS expressible by a rating, so the community's choice wins.
    expect(signalTally({ signals: of(1, 4, 5), type: { ...stars, aggregate: 'median' } })).toBe(4);
  });

  it('counts people, not values, when no type is named', () => {
    // Seven likes plus three stars plus two downvotes is not a number; twelve people reacted is.
    const mixed = [...of(1, 1), ...of(5), ...of(-1), ...of(0)];
    expect(signalTally({ signals: mixed })).toBe(4);
  });

  it('answers 0 for anything that is not a list of signals, rather than throwing', () => {
    // Total, like every function an expression can call.
    expect(signalTally({})).toBe(0);
    expect(signalTally({ signals: 'nonsense' })).toBe(0);
    expect(signalTally(undefined)).toBe(0);
    expect(signalTally({ signals: [], type: like })).toBe(0);
  });
});
