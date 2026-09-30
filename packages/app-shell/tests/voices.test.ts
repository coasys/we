/**
 * The list a reader turns voices up and down in, and the address it writes back to.
 */
import { describe, expect, it } from 'vitest';

import { voices, voicesParam } from '../src/shared/sources/voices';

const summary = {
  type: 'rate',
  voices: [
    { author: 'did:key:ana', cards: 4, mean: 3.5 },
    { author: 'did:key:ben', cards: 2, mean: 1 },
    { author: 'pretend:1', cards: 1, mean: 5, name: 'Pretend 1' },
  ],
};
const profiles = [{ did: 'did:key:ana', name: 'Ana', avatar: 'ana.png' }];

describe('voices', () => {
  it('joins each voice to a face and a name, with its weight and its share of the say', () => {
    const rows = voices({ summary, param: 'did:key:ben=50', profiles, me: 'did:key:ana' });
    expect(rows.map((row) => [row.name, row.weight, row.share, row.mine, row.pretend])).toEqual([
      ['Ana', 100, 40, true, false],
      [expect.stringContaining('did:key:ben'), 50, 20, false, false],
      ['Pretend 1', 100, 40, false, true],
    ]);
  });

  it('says nobody has a share when every voice is at nothing, rather than dividing by it', () => {
    const rows = voices({ summary, param: 'did:key:ana=0,did:key:ben=0,pretend:1=0' });
    expect(rows.every((row) => row.share === 0)).toBe(true);
  });

  it('is an empty list before the seed has said anything', () => {
    expect(voices({})).toEqual([]);
  });
});

describe('voicesParam', () => {
  it('writes one voice, and leaves a voice back at full out of the address', () => {
    expect(voicesParam({ param: '', did: 'did:key:ana', weight: 35 })).toBe('did:key:ana=35');
    expect(voicesParam({ param: 'did:key:ana=35,did:key:ben=0', did: 'did:key:ana', weight: 100 })).toBe(
      'did:key:ben=0',
    );
  });

  it('turns every other voice to nothing for "only this person"', () => {
    const rows = voices({ summary, profiles });
    expect(voicesParam({ param: 'did:key:ana=20', only: 'did:key:ben', voices: rows })).toBe(
      'did:key:ana=0,pretend:1=0',
    );
  });
});
