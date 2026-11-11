import { describe, expect, it } from 'vitest';

import type { StorageStatus, StoreAtRest } from '../src/shared/platform/types';
import { DATA_PLAIN_LINE, ENCRYPTED_LINE, LINKS_PLAIN_LINE, storageLine } from '../src/shared/storageLine';

function open(
  database: StoreAtRest,
  languageStorage: StoreAtRest,
  links: StoreAtRest,
  encryptedAtRest = false,
): StorageStatus {
  return { state: 'open', encryptedAtRest, stores: { database, languageStorage, links } };
}

describe('storageLine', () => {
  it('says only the links are unencrypted where the rest is under its key', () => {
    expect(storageLine(open('encrypted', 'encrypted', 'plain'))).toBe(LINKS_PLAIN_LINE);
    expect(LINKS_PLAIN_LINE).toBe(
      'Your links on this device are not encrypted on its disk. Your other data here is encrypted. The device reads all of it while it works for you, so use devices you trust.',
    );
  });

  it('says none of it is encrypted where the database or the language storage is plain too', () => {
    expect(storageLine(open('plain', 'plain', 'plain'))).toBe(DATA_PLAIN_LINE);
    expect(storageLine(open('plain', 'encrypted', 'plain'))).toBe(DATA_PLAIN_LINE);
    expect(storageLine(open('encrypted', 'plain', 'plain'))).toBe(DATA_PLAIN_LINE);
    expect(DATA_PLAIN_LINE).toBe(
      'Your data on this device is not encrypted on its disk. The device reads it while it works for you, so use devices you trust.',
    );
  });

  it('says it is encrypted only where the backend says it is encrypted at rest', () => {
    expect(storageLine(open('encrypted', 'encrypted', 'encrypted', true))).toBe(ENCRYPTED_LINE);
    expect(ENCRYPTED_LINE).toBe(
      "Your data is encrypted on this device's disk. The device reads it while it works for you, so use devices you trust.",
    );
    // Every store encrypted but the secret on the data's disk: not encrypted at rest, and no
    // sentence here is true of it.
    expect(storageLine(open('encrypted', 'encrypted', 'encrypted', false))).toBeNull();
  });

  it('says nothing while the storage is not open', () => {
    expect(storageLine({ state: 'sealed', encryptedAtRest: false, stores: null })).toBeNull();
    expect(storageLine({ state: 'unlocking', encryptedAtRest: false, stores: null })).toBeNull();
    expect(
      storageLine({
        state: 'sealed',
        encryptedAtRest: false,
        stores: { database: 'encrypted', languageStorage: 'encrypted', links: 'plain' },
      }),
    ).toBeNull();
  });

  it('says nothing where the stores are not reported', () => {
    expect(storageLine({ state: 'open', encryptedAtRest: false, stores: null })).toBeNull();
    expect(storageLine(null)).toBeNull();
    expect(storageLine(undefined)).toBeNull();
  });

  it('says nothing while any store is being moved under its key', () => {
    expect(storageLine(open('migrating', 'encrypted', 'plain'))).toBeNull();
    expect(storageLine(open('encrypted', 'migrating', 'plain'))).toBeNull();
    expect(storageLine(open('encrypted', 'encrypted', 'migrating'))).toBeNull();
    expect(storageLine(open('plain', 'plain', 'migrating'))).toBeNull();
  });
});
