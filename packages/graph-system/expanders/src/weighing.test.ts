/**
 * Each person's voice weighted as the reader chooses.
 *
 * With every voice in full the answer is the plain aggregate the reactions already had; turning a voice
 * down makes it count for its share of a person, and turning it to nothing leaves it out as a muted one
 * is. The example the feature was asked for is the last case below: every voice but one at nothing, and
 * the order is that one person's.
 */
import { describe, expect, it } from 'vitest';

import { parseWeights, pretendVotes, readVotes, voicesOf, type Vote, weighVotes } from './weighing';

const votes: Vote[] = [
  ['did:a', 5],
  ['did:b', 1],
  ['did:c', 3],
];
const as = (mode: string, weights?: unknown) => ({ signalTypeId: 't', mode, ...(weights ? { weights } : {}) });

describe('weighVotes', () => {
  it('is the plain aggregate with every voice in full', () => {
    expect(weighVotes(votes, as('rating')).weight).toBe(3);
    expect(weighVotes(votes, as('vote')).weight).toBe(9);
    expect(weighVotes(votes, as('toggle')).weight).toBe(3);
  });

  it('counts a voice turned down for its share of a person', () => {
    // Half of did:a's say: (0.5·5 + 1 + 3) / 2.5 for an average; half a like for a count.
    expect(weighVotes(votes, as('rating', 'did:a=50')).weight).toBeCloseTo(2.6);
    expect(weighVotes(votes, as('toggle', 'did:a=50')).weight).toBe(2.5);
    expect(weighVotes(votes, as('vote', { 'did:a': 0.5 })).weight).toBe(6.5);
  });

  it('leaves a voice at nothing out altogether, as a muted one is', () => {
    const quieted = weighVotes(votes, as('rating', 'did:a=0'));
    expect(quieted).toMatchObject({ weight: 2, weightCount: 2 });
  });

  it('says a card is weighted only where somebody who answered it is turned down', () => {
    expect(weighVotes(votes, as('rating', 'did:a=50')).weightAdjusted).toBe(true);
    expect(weighVotes(votes, as('rating', 'did:z=0')).weightAdjusted).toBeUndefined();
    expect(weighVotes(votes, as('rating')).weightAdjusted).toBeUndefined();
  });

  it('is only the one person heard when every other voice is at nothing', () => {
    expect(weighVotes(votes, as('rating', 'did:a=0,did:b=100,did:c=0')).weight).toBe(1);
  });

  it('has no score where nobody the reader is listening to answered — except a count, which is zero', () => {
    const silent = 'did:a=0,did:b=0,did:c=0';
    expect(weighVotes(votes, as('rating', silent)).weight).toBeUndefined();
    expect(weighVotes(votes, as('toggle', silent))).toMatchObject({ weight: 0, weightCount: 0 });
  });

  it('takes a weighted median — the value half the say lies at', () => {
    const settings = { signalTypeId: 't', aggregate: 'median', mode: 'rating' };
    expect(weighVotes(votes, settings).weight).toBe(3);
    // did:a's 5 counted three times over the others: the say's midpoint moves to 5.
    expect(weighVotes([...votes, ['did:d', 5]], { ...settings, weights: 'did:b=10,did:c=10' }).weight).toBe(5);
  });

  it('reports the reader’s own answer whatever their voice is set to', () => {
    expect(weighVotes(votes, { ...as('rating', 'did:b=0'), me: 'did:b' }).weightMine).toBe(1);
  });
});

describe('parseWeights', () => {
  it('reads the address form — whole percent, DIDs with their colons — and clamps', () => {
    const weights = parseWeights('did:key:z6Mk=50, did:key:abc=0,did:key:x=250');
    expect(weights.get('did:key:z6Mk')).toBe(0.5);
    expect(weights.get('did:key:abc')).toBe(0);
    expect(weights.get('did:key:x')).toBe(1);
  });

  it('ignores what it cannot read rather than muting somebody by accident', () => {
    expect(parseWeights('nonsense,=40,did:a=').size).toBe(0);
    expect(parseWeights(undefined).size).toBe(0);
  });
});

describe('readVotes', () => {
  it('keeps each person’s newest answer of the type, and nothing unattributed', () => {
    const rows = [
      { signalTypeId: 't', value: 1, author: 'did:a', createdAt: '2026-01-01' },
      { signalTypeId: 't', value: 4, author: 'did:a', createdAt: '2026-02-01' },
      { signalTypeId: 'other', value: 9, author: 'did:b' },
      { signalTypeId: 't', value: 2 },
    ];
    expect(readVotes(rows, 't')).toEqual([['did:a', 4]]);
    // Rows that were never read are not the same as nobody having answered.
    expect(readVotes(undefined, 't')).toBeNull();
  });
});

describe('pretend people', () => {
  const pretend = {
    people: [
      { id: 'pretend:1', name: 'Pretend 1' },
      { id: 'pretend:2', name: 'Pretend 2' },
    ],
  };
  const rating = { mode: 'rating', rangeMin: 1, rangeMax: 5 };

  it('answer the same way on every load, within the reaction’s range', () => {
    const first = pretendVotes('card-1', pretend, rating);
    expect(pretendVotes('card-1', pretend, rating)).toEqual(first);
    for (const [, value] of first) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(5);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('take the answer somebody gave while acting as them, or none where it was taken back', () => {
    const acted = {
      ...pretend,
      answers: { 'pretend:1|card-1': 4, 'pretend:2|card-1': null },
    };
    expect(pretendVotes('card-1', acted, rating)).toEqual([['pretend:1', 4]]);
  });

  it('are listed among the voices under their names, the busiest first', () => {
    const voices = voicesOf(
      [
        [
          ['did:a', 5],
          ['pretend:1', 1],
        ],
        [['pretend:1', 3]],
      ],
      [],
      pretend,
    );
    expect(voices).toEqual([
      { author: 'pretend:1', cards: 2, mean: 2, name: 'Pretend 1' },
      { author: 'did:a', cards: 1, mean: 5 },
    ]);
  });

  it('leave a muted person out of the voices', () => {
    expect(voicesOf([[['did:m', 1]]], ['did:m'])).toEqual([]);
  });
});
