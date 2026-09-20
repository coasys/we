/**
 * The number a record's reactions are read as, lent to templates.
 *
 * The rules are the type's, not the caller's — which is the whole reason this is one function
 * rather than an averaging somebody writes in a template. A community that sets `median` gets a
 * median; one that leaves the manifest's default `count` on a rating does not get a headcount where
 * the stars say a score.
 */
import { describe, expect, it } from 'vitest';

import { reactions, signalTally } from '../src/shared/sources/signalTally';

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

describe('a reaction drawn before it is stored', () => {
  const me = 'did:me';
  const held = (value: number) => [{ record: 'post-1', type: 'st-like', value }];
  const call = (signals: unknown[], pending: unknown) =>
    reactions({ signals, record: 'post-1', type: 'st-like', me, pending });

  it('puts this agent’s reaction in before the subscription has carried it back', () => {
    // The press-and-see case: without this the glyph stays unfilled and the count stays put for a
    // round trip, and the press reads as having failed.
    const rows = call([{ author: 'did:them', signalTypeId: 'st-like', value: 1 }], held(1));
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => (row as { author?: string }).author === me)).toBe(true);
  });

  it('replaces this agent’s stored reaction rather than adding to it', () => {
    /*
      A rating moved from three stars to four leaves the three in the query result for a round trip.
      Added on top, one person counts twice — the average is drawn from a number nobody gave, and
      the stars under it disagree with the figure beside them.
    */
    const rows = call(
      [
        { author: me, signalTypeId: 'st-like', value: 3 },
        { author: 'did:them', signalTypeId: 'st-like', value: 5 },
      ],
      held(4),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => (row as { author?: string }).author === me)).toMatchObject({ value: 4 });
  });

  it('takes it out again on a withdrawal, which is what a zero means', () => {
    // `upsertSignal` deletes rather than storing a nought, so the overlay has to spell a withdrawal
    // the same way or an un-pressed heart would keep its fill until the data caught up.
    const rows = call([{ author: me, signalTypeId: 'st-like', value: 1 }], held(0));
    expect(rows).toEqual([]);
  });

  it('leaves everybody else’s alone', () => {
    const others = [
      { author: 'did:a', signalTypeId: 'st-like', value: 1 },
      { author: 'did:b', signalTypeId: 'st-like', value: 1 },
    ];
    expect(call(others, held(1)).filter((row) => (row as { author?: string }).author !== me)).toHaveLength(2);
  });

  it('hands back the same array when nothing is held', () => {
    // The ordinary case on every frame. A fresh array per call would defeat every identity check
    // downstream and re-render each mark on every push.
    const rows = [{ author: 'did:a', signalTypeId: 'st-like', value: 1 }];
    expect(call(rows, [])).toBe(rows);
    expect(
      call(
        rows,
        held(1).map((entry) => ({ ...entry, type: 'st-star' })),
      ),
    ).toBe(rows);
  });

  it('is total — anything that is not a list of signals counts as none of them', () => {
    expect(reactions(undefined)).toEqual([]);
    // And a hold still draws over that. A record whose signals have not arrived is the frame right
    // after a press on a freshly-opened card; dropping the hold there is the flash this exists to
    // remove, and the list it is drawn over is empty either way.
    expect(reactions({ signals: 'nonsense', record: 'post-1', type: 'st-like', me, pending: held(1) })).toEqual([
      { author: me, signalTypeId: 'st-like', value: 1 },
    ]);
  });
});
