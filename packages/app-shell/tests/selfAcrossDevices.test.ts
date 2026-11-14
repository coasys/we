/**
 * "Me" across devices: the person this computer speaks for, and every device key that writes as
 * them, so a post from my other computer is mine.
 */
import { evaluateExpression, parseExpression } from '@we/schema-shared';
import { describe, expect, it, vi } from 'vitest';

import { deviceDid, selfAcrossDevices } from '../src/shared/selfAcrossDevices';

const PERSON = 'did:scid:coasys:1:QmTestPerson';
const DESKTOP_KEY = 'z6MkTestDesktop';
const LAPTOP_KEY = 'z6MkTestLaptop';
const DESKTOP = `did:key:${DESKTOP_KEY}`;
const LAPTOP = `did:key:${LAPTOP_KEY}`;

const device = (sign: string, thisDevice: boolean, revokedSeq: number | null = null) => ({
  keyId: sign,
  sign,
  thisDevice,
  addedSeq: 0,
  revokedSeq,
});

describe('deviceDid', () => {
  it('writes a key-log multikey as the DID a record carries in author', () => {
    expect(deviceDid(LAPTOP_KEY)).toBe(LAPTOP);
    expect(deviceDid(LAPTOP)).toBe(LAPTOP);
  });
});

describe('selfAcrossDevices', () => {
  it('answers the person and every device the log lists, this device first, revoked ones kept', async () => {
    const identity = {
      status: vi.fn(async () => ({ did: PERSON }) as never),
      devices: vi.fn(async () => [
        device(LAPTOP_KEY, false),
        device(DESKTOP_KEY, true),
        device('z6MkTestOld', false, 3),
      ]),
    };
    expect(await selfAcrossDevices(DESKTOP, identity)).toEqual({
      person: PERSON,
      // The person last: a member or a profile, listed one per person, is "me" by the same test.
      dids: [DESKTOP, LAPTOP, 'did:key:z6MkTestOld', PERSON],
    });
  });

  it('is this device alone without a key log, a person, or an answer', async () => {
    const alone = { person: DESKTOP, dids: [DESKTOP] };
    expect(await selfAcrossDevices(DESKTOP, null)).toEqual(alone);
    expect(await selfAcrossDevices(DESKTOP, { status: async () => ({ did: null }) as never })).toEqual(alone);
    const failing = {
      status: async () => {
        throw new Error('executor gone');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await selfAcrossDevices(DESKTOP, failing)).toEqual(alone);
    warn.mockRestore();
  });

  it('answers what it last knew when the key log cannot be read now', async () => {
    const known = { person: PERSON, dids: [DESKTOP, LAPTOP, PERSON] };
    const failing = {
      status: async () => {
        throw new Error('identity store unavailable');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await selfAcrossDevices(DESKTOP, failing, known)).toEqual(known);
    // Another device's answer is not this one's.
    expect(await selfAcrossDevices('did:key:z6MkTestElsewhere', failing, known)).toEqual({
      person: 'did:key:z6MkTestElsewhere',
      dids: ['did:key:z6MkTestElsewhere'],
    });
    warn.mockRestore();
    // A log that answers "no person" is an answer, not a failure: it is not overridden.
    expect(await selfAcrossDevices(DESKTOP, { status: async () => ({ did: null }) as never }, known)).toEqual({
      person: DESKTOP,
      dids: [DESKTOP],
    });
  });

  it("makes a post from my other computer mine, as a template's ownership check reads it", async () => {
    const identity = {
      status: async () => ({ did: PERSON }) as never,
      devices: async () => [device(DESKTOP_KEY, true), device(LAPTOP_KEY, false)],
    };
    const me = { did: DESKTOP, ...(await selfAcrossDevices(DESKTOP, identity)) };
    const mine = (author: string) => {
      const roots: Record<string, unknown> = { me, post: { author } };
      return evaluateExpression(parseExpression('post.author in me.dids'), {
        root: (name) => ({ bound: name in roots, value: roots[name] }),
        call: () => undefined,
      });
    };

    expect(mine(LAPTOP)).toBe(true);
    expect(mine(DESKTOP)).toBe(true);
    expect(mine('did:key:z6MkTestSomeoneElse')).toBe(false);
  });
});
