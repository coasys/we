/**
 * A device key answers the person its key log lists it under; anything else is its own person.
 */
import { describe, expect, it, vi } from 'vitest';

import { missingExecutorMethods, resetMissingExecutorMethods } from './missingMethods';
import { createAd4mPersonPort, MISS_TTL_MS } from './personPort';

const PERSON = 'did:scid:coasys:1:QmPerson';
const LAPTOP = 'did:key:z6MkLaptop';
const DESKTOP = 'did:key:z6MkDesktop';
const LONER = 'did:key:z6MkLoner';

/** `identity.resolve` as the executor answers it: the person's document for a listed key. */
function resolverFor(listed: Record<string, string>) {
  return vi.fn(async (did: string) =>
    listed[did]
      ? { didDocument: { id: listed[did] }, didResolutionMetadata: { 'coasys:keyValid': true } }
      : { didDocument: null, didResolutionMetadata: { error: 'notFound' } },
  );
}

describe('createAd4mPersonPort', () => {
  it('answers the person both devices of one key log speak for', async () => {
    const resolve = resolverFor({ [LAPTOP]: PERSON, [DESKTOP]: PERSON });
    const persons = createAd4mPersonPort({ identity: { resolve } });

    expect(await persons.personOf(LAPTOP)).toBe(PERSON);
    expect(await persons.personOf(DESKTOP)).toBe(PERSON);
  });

  it('answers a key no log lists as its own person', async () => {
    const persons = createAd4mPersonPort({ identity: { resolve: resolverFor({}) } });
    expect(await persons.personOf(LONER)).toBe(LONER);
  });

  it('answers a person, and anything that is not a device key, as itself without asking', async () => {
    const resolve = resolverFor({});
    const persons = createAd4mPersonPort({ identity: { resolve } });

    expect(await persons.personOf(PERSON)).toBe(PERSON);
    expect(await persons.personOf('did:test:ann')).toBe('did:test:ann');
    expect(await persons.personOf('')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps a person it found for the session, and asks once for concurrent callers', async () => {
    const resolve = resolverFor({ [LAPTOP]: PERSON });
    const persons = createAd4mPersonPort({ identity: { resolve } });

    await Promise.all([persons.personOf(LAPTOP), persons.personOf(LAPTOP)]);
    await persons.personOf(LAPTOP);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('asks again about an unlisted key once the miss is old: it may be a device linked since', async () => {
    let clock = 1_000;
    const listed: Record<string, string> = {};
    const resolve = resolverFor(listed);
    const persons = createAd4mPersonPort({ identity: { resolve } }, () => clock);

    expect(await persons.personOf(DESKTOP)).toBe(DESKTOP);
    listed[DESKTOP] = PERSON;
    expect(await persons.personOf(DESKTOP)).toBe(DESKTOP);
    expect(resolve).toHaveBeenCalledTimes(1);

    clock += MISS_TTL_MS;
    expect(await persons.personOf(DESKTOP)).toBe(PERSON);
  });

  it('takes every key as its own person on an executor without identity.resolve, and asks no more', async () => {
    resetMissingExecutorMethods();
    const resolve = vi.fn(async () => {
      throw new Error('Unknown type: identity.resolve');
    });
    const persons = createAd4mPersonPort({ identity: { resolve } });

    expect(await persons.personOf(LAPTOP)).toBe(LAPTOP);
    expect(await persons.personOf(DESKTOP)).toBe(DESKTOP);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(missingExecutorMethods().map((m) => m.method)).toContain('identity.resolve');
  });
});
