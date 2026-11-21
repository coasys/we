/**
 * Who reacted, joined to who they are.
 *
 * The join is the whole job: a signal names a DID, and a face and a name live in a profile cache,
 * and an expression pairing them would be a `find()` inside a `map()` inside a `filter()` at every
 * call site. What the tests pin is the part that is a judgement rather than a lookup — what happens
 * to somebody whose profile has not arrived.
 */
import { describe, expect, it } from 'vitest';

import { reactors } from '../src/shared/sources/reactors';

const profiles = [
  { did: 'did:anna', name: 'Anna', avatar: 'anna.png' },
  { did: 'did:ben', name: 'Ben', avatar: '' },
  { did: 'did:me', name: 'Me', avatar: '' },
];

const signals = [
  { author: 'did:ben', value: 4 },
  { author: 'did:anna', value: 5 },
  { author: 'did:me', value: 3 },
  { author: 'did:stranger', value: 2 },
];

describe('the roster behind a reaction', () => {
  it('leads with the reader, then everybody by name', () => {
    // Their own reaction is the one they are most likely to be looking for, and the only row they
    // can act on from here.
    const { people } = reactors({ signals, profiles, me: 'did:me' });
    expect(people.map((p) => p.did)).toEqual(['did:me', 'did:stranger', 'did:anna', 'did:ben']);
  });

  it("counts a reaction from any of the reader's devices as theirs", () => {
    // `me.dids` is every device key that writes as this person; a reaction from the other computer
    // leads too, and is the one they can act on.
    const fromOtherComputer = [{ author: 'did:me-laptop', value: 1 }, ...signals.filter((s) => s.author !== 'did:me')];
    const { people } = reactors({ signals: fromOtherComputer, profiles, me: ['did:me', 'did:me-laptop'] });
    expect(people[0]).toMatchObject({ did: 'did:me-laptop', mine: true });
    expect(people.filter((p) => p.mine)).toHaveLength(1);
  });

  it("finds a reactor's face through their person entry when the signal names a device", () => {
    // `profileStore.profiles` holds one entry per person; the signal names the computer that signed.
    const persons = [{ did: 'did:scid:anna', name: 'Anna', avatar: 'anna.png', devices: ['did:anna-phone'] }];
    const { people } = reactors({ signals: [{ author: 'did:anna-phone', value: 5 }], profiles: persons, me: 'did:me' });
    expect(people[0]).toMatchObject({ did: 'did:anna-phone', name: 'Anna', avatar: 'anna.png' });
  });

  it('keeps somebody whose profile has not arrived, with their DID to draw a face from', () => {
    /*
      A cache miss is not an absence: they reacted. Dropping them would make the list disagree with
      the count beside it, and the DID is what draws a stable identicon — two unresolved peers must
      not be two identical blank discs.
    */
    const { people, total } = reactors({ signals, profiles, me: 'did:me' });
    expect(total).toBe(4);
    expect(people.find((p) => p.did === 'did:stranger')).toMatchObject({ name: '', value: 2 });
  });

  it('carries what each person gave', () => {
    const { people } = reactors({ signals, profiles, me: 'did:me' });
    expect(people.find((p) => p.did === 'did:anna')?.value).toBe(5);
  });

  it('narrows by name, and counts what it could not judge', () => {
    /*
      A name nobody has fetched yet is not a name that fails to match. The row is out of a narrowed
      list — there is nothing to match it against — but the list says how many it could not speak
      for, so a search that finds nothing can say why rather than asserting nobody reacted.
    */
    const { people, total, unresolved } = reactors({ signals, profiles, me: 'did:me', search: 'an' });
    expect(people.map((p) => p.name)).toEqual(['Anna']);
    expect(total).toBe(4);
    expect(unresolved).toBe(1);
  });

  it('says nothing about unresolved people when nobody is searching', () => {
    // There is no question for them to be missing from.
    expect(reactors({ signals, profiles, me: 'did:me' }).unresolved).toBe(0);
  });

  it('ignores case, so a search is what somebody typed rather than what they remembered', () => {
    expect(reactors({ signals, profiles, search: 'ANNA' }).people.map((p) => p.name)).toEqual(['Anna']);
  });

  it('is total — anything that is not a list of signals is nobody', () => {
    expect(reactors(undefined)).toEqual({ people: [], total: 0, unresolved: 0 });
    expect(reactors({ signals: 'nonsense', profiles }).people).toEqual([]);
  });
});
