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

  it("names a voice through its person entry, and counts my other computer's voice as mine", () => {
    const persons = [
      { did: 'did:scid:ana', name: 'Ana', avatar: 'ana.png', devices: ['did:key:ana', 'did:key:ana-laptop'] },
    ];
    const rows = voices({ summary, profiles: persons, me: ['did:key:ana-laptop', 'did:key:ana', 'did:scid:ana'] });
    expect(rows[0]).toMatchObject({ name: 'Ana', mine: true });
    expect(rows.filter((row) => row.mine)).toHaveLength(1);
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

describe('my own voice across my computers', () => {
  // My laptop, my desktop and me: `me.dids` puts whichever computer is reading first.
  const L = 'did:key:ana-laptop';
  const D = 'did:key:ana-desktop';
  const P = 'did:scid:ana';
  const mine = { type: 'rate', voices: [{ author: P, cards: 3, mean: 4 }] };
  const orders = [
    ['the laptop', [L, D, P]],
    ['the desktop', [D, L, P]],
  ] as const;

  it.each(orders)('writes my weight under my person, and reads it back the same on %s', (_, me) => {
    // Set on the laptop, over an entry the desktop left under its own key.
    const param = voicesParam({ param: `${D}=10`, did: P, weight: 40, me: [L, D, P] });
    expect(param).toBe(`${P}=40`);
    expect(voices({ summary: mine, param, me })[0]).toMatchObject({ did: P, weight: 40, mine: true });
  });

  it.each(orders)('reads a weight left under one of my computers the same on %s', (_, me) => {
    // From before voices were kept under the person: the laptop's key turned down.
    expect(voices({ summary: mine, param: `${L}=0`, me })[0].weight).toBe(0);
    // Two computers' entries: the same one wins whichever is reading.
    expect(voices({ summary: mine, param: `${L}=20,${D}=60`, me })[0].weight).toBe(
      voices({ summary: mine, param: `${L}=20,${D}=60`, me: [L, D, P] })[0].weight,
    );
  });

  it('puts my voice back to full however many of my computers had turned it down', () => {
    expect(voicesParam({ param: `${L}=0,${D}=30,did:key:ben=50`, did: P, weight: 100, me: [D, L, P] })).toBe(
      'did:key:ben=50',
    );
  });

  it('"only me" clears what my other computers left, and turns everyone else to nothing', () => {
    const listed = [P, 'did:key:ben'];
    expect(voicesParam({ param: `${L}=0`, only: P, voices: listed, me: [D, L, P] })).toBe('did:key:ben=0');
  });
});
