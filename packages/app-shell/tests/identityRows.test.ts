/** The key log and device list in Settings' words. */
import type { IdentityCustodyView } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import {
  custodyDevice,
  deviceRows,
  keyLogRows,
  lastRotation,
  requestRows,
  servingDevice,
  shortDid,
  shortHash,
} from '../src/shared/identityRows';

const REVOKED_HOLDER = 'Still holds a valid master key — replace your master key';
/** Where only the key log speaks: it let the device keep the master key, and the record is gone. */
const REVOKED_MAY_HOLD = 'May still hold a valid master key — replace your master key';

describe('keyLogRows', () => {
  const events = [
    { seq: 0, op: 'incept', hash: 'QmZkAAAAAAAAAAAA7rWd', added: [{ id: 'd1', sign: 'z' }], revoked: [] },
    { seq: 1, op: 'add', hash: 'QmN4BBBBBBBBBByFlk', added: [{ id: 'd2', sign: 'z' }], revoked: [] },
    { seq: 2, op: 'revoke', hash: null, added: [], revoked: ['d2'] },
    { seq: 3, op: 'rotate', hash: null, added: [], revoked: [] },
    { seq: 4, op: 'scope', hash: null, added: [], revoked: [] },
  ];

  it('words each event, newest first, and marks this computer', () => {
    const rows = keyLogRows(events, 'd1');
    expect(rows.map((r) => [r.position, r.title, r.detail])).toEqual([
      ['#4', 'Scope', ''],
      ['#3', 'Replaced the master key', 'with your 12 words'],
      ['#2', 'Revoked d2', 'd2'],
      ['#1', 'Added d2', 'd2'],
      ['#0', 'Created your identity', 'with d1 · This computer'],
    ]);
    expect(rows.find((r) => r.seq === 0)!.thisComputer).toBe(true);
    expect(rows.find((r) => r.seq === 1)!.thisComputer).toBe(false);
    expect(rows.find((r) => r.seq === 0)!.hashShort).toBe('QmZk…7rWd');
  });

  it('names this computer and every other key by its id', () => {
    const rows = keyLogRows(events.slice(0, 3), 'd2');
    expect(rows.map((r) => r.title)).toEqual(['Revoked This computer', 'Added This computer', 'Created your identity']);
    expect(rows[2].detail).toBe('with d1');
  });
});

describe('deviceRows', () => {
  it('puts valid keys first and this computer on top, and offers revoke for the others only', () => {
    const rows = deviceRows([
      { keyId: 'd3', sign: 'z', thisDevice: false, addedSeq: 3, revokedSeq: null },
      { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, revokedSeq: 2 },
      { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, revokedSeq: null },
    ]);
    expect(rows.map((r) => [r.keyId, r.label, r.status, r.canRevoke])).toEqual([
      ['d1', 'This computer', 'Valid', false],
      ['d3', 'Unnamed device', 'Valid', true],
      ['d2', 'Unnamed device', 'Revoked at #2', false],
    ]);
    // A device row names no key id; the Key log page is where those are read.
    expect(rows[1].subtitle).toBe('added at #3');
    expect(rows.map((r) => r.icon)).toEqual(['laptop', 'key', 'key']);
  });

  it('lists no bot key as a device, whatever the private record says, and counts only devices', () => {
    const NOW = 1_750_000_000;
    const bot = (keyId: string, expires: number, revokedSeq: number | null = null) => ({
      keyId,
      sign: 'z',
      thisDevice: false,
      addedSeq: Number(keyId.slice(1)),
      revokedSeq,
      bot: { can: ['read'], expires },
      expires,
    });
    const rows = deviceRows(
      [
        { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, revokedSeq: null, bot: null, expires: null },
        // A bot whose key is valid, one whose key has ended, and one revoked: Bots manages each.
        bot('d2', NOW + 1000),
        bot('d3', NOW - 1000),
        bot('d4', NOW + 1000, 5),
        // The record calls this one a bot; the key log does not, so it is a device.
        { keyId: 'd6', sign: 'z', thisDevice: false, addedSeq: 6, revokedSeq: null, bot: null, expires: null },
      ],
      [
        { keyId: 'd2', name: 'Helper', kind: 'desktop-app', holdsMaster: 'no' },
        { keyId: 'd6', name: 'Box', kind: 'bot', holdsMaster: 'no' },
      ],
      [],
      null,
      NOW,
    );
    expect(rows.map((r) => [r.keyId, r.label, r.status, r.valid])).toEqual([
      ['d1', 'This computer', 'Valid', true],
      ['d6', 'Box', 'Valid', true],
    ]);
  });

  it('says a key whose end has passed is expired, not valid', () => {
    const NOW = 1_750_000_000;
    const rows = deviceRows(
      [
        { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, revokedSeq: null, bot: null, expires: null },
        { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, revokedSeq: null, bot: null, expires: NOW - 60 },
        { keyId: 'd3', sign: 'z', thisDevice: false, addedSeq: 2, revokedSeq: null, bot: null, expires: NOW + 60 },
      ],
      [],
      [],
      null,
      NOW,
    );
    expect(rows.map((r) => [r.keyId, r.valid, r.revoked])).toEqual([
      ['d1', true, false],
      ['d3', true, false],
      ['d2', false, false],
    ]);
    expect(rows[2].status).toMatch(/^Expired on /);
    expect(rows[1].status).toBe('Valid');
    // Ending it for good in the key log is still offered: an end can be the log's to move.
    expect(rows[2].canRevoke).toBe(true);
  });

  it('names each device as the private record does, and says which keep the master key', () => {
    const rows = deviceRows(
      [
        { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, revokedSeq: null },
        { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, revokedSeq: null },
        { keyId: 'd3', sign: 'z', thisDevice: false, addedSeq: 2, revokedSeq: null },
        { keyId: 'd4', sign: 'z', thisDevice: false, addedSeq: 3, revokedSeq: 4 },
      ],
      [
        { keyId: 'd1', name: 'Desktop', kind: 'desktop-app', holdsMaster: 'yes' },
        { keyId: 'd2', name: 'Box', kind: 'server', holdsMaster: 'no' },
        { keyId: 'd3', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'offered' },
        // A revoke leaves its copy of the master key valid: the row still says so.
        { keyId: 'd4', name: 'Old', kind: 'desktop-app', holdsMaster: 'yes' },
      ],
    );
    expect(rows.map((r) => [r.label, r.icon, r.master])).toEqual([
      ['Desktop', 'laptop', 'Holds the master key'],
      ['Box', 'hard-drives', ''],
      ['Laptop', 'laptop', 'Master key offered, not yet taken'],
      ['Old', 'laptop', REVOKED_HOLDER],
    ]);
    expect(rows[0].subtitle).toBe('This computer · added at #0');
    // Not a master key it keeps: a warning.
    expect(rows[3].holdsMaster).toBe('no');
  });

  it('keeps warning of a device revoked after it was handed the master key', () => {
    const keys = [
      { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, revokedSeq: null },
      { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, revokedSeq: null },
    ];
    const handedOver = deviceRows(keys, [
      { keyId: 'd1', name: 'Desktop', kind: 'desktop-app', holdsMaster: 'yes' },
      { keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'yes' },
    ]);
    expect(handedOver[1].master).toBe('Holds the master key');

    // The revoke: the record's write drops d2's entry, and the key log says d2 may still hold it.
    const revoked = deviceRows(
      [keys[0], { ...keys[1], revokedSeq: 2 }],
      [{ keyId: 'd1', name: 'Desktop', kind: 'desktop-app', holdsMaster: 'yes' }],
      ['d2'],
    );
    expect(revoked.map((r) => [r.label, r.status, r.master])).toEqual([
      ['Desktop', 'Valid', 'Holds the master key'],
      ['Unnamed device', 'Revoked at #2', REVOKED_MAY_HOLD],
    ]);

    // A revoked device the log never let keep the master key carries no warning.
    const server = deviceRows([keys[0], { ...keys[1], revokedSeq: 2 }], [], []);
    expect(server[1].master).toBe('');
    expect(server[1].replaceMaster).toBe(false);
    expect(revoked[1].replaceMaster).toBe(true);
  });

  it('stops warning once the master key was replaced at or after the revoke', () => {
    const keys = [
      { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, revokedSeq: null },
      { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, revokedSeq: 2 },
    ];
    const stillListed = [{ keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'yes' as const }];
    // A rotation before the revoke left d2 a copy of the new key: the warning stands.
    expect(deviceRows(keys, stillListed, ['d2'], 1)[1]).toMatchObject({ replaceMaster: true });
    // The same event (a revoke that also replaced it), or a later one, shuts the copy out.
    for (const seq of [2, 3]) {
      expect(deviceRows(keys, stillListed, ['d2'], seq)[1]).toMatchObject({ master: '', replaceMaster: false });
    }
    expect(
      lastRotation([
        { seq: 0, op: 'incept' },
        { seq: 3, op: 'rotate' },
        { seq: 4, op: 'add' },
      ]),
    ).toBe(3);
    expect(lastRotation([{ seq: 0, op: 'incept' }])).toBeNull();
  });
});

describe('requestRows', () => {
  it('names the device that asked, and each device a revoke would remove', () => {
    const names = [{ keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'no' as const }];
    const rows = requestRows(
      [
        { id: 'r1', kind: 'send-master', by: 'd2', keyIds: [], expires: 9 },
        { id: 'r2', kind: 'confirm-revoke', by: 'd2', keyIds: ['d1', 'd3'], expires: 9 },
      ],
      names,
      'd1',
    );
    expect(rows.map((r) => r.title)).toEqual([
      'Laptop asks for the master key',
      'Laptop asks to revoke This computer, d3',
    ]);
  });
});

/**
 * Where this device is: on the desktop the custody service runs beside the executor, which marks its
 * own key; on a phone the custody service answers for the phone, which reaches a computer's executor.
 */
describe('this device, on a phone and on a desktop', () => {
  const custody = (thisDevice: IdentityCustodyView['thisDevice']): IdentityCustodyView => ({
    did: 'did:scid:coasys:1:QmIdentity',
    holdsMaster: true,
    unlock: 'os',
    blocked: null,
    devices: [],
    revokedHolders: [],
    requests: [],
    masterWaiting: false,
    thisDevice,
  });
  // The executor is the laptop's (d1), and marks d1 as its own; the phone is d2.
  const keys = [
    { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, revokedSeq: null },
    { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, revokedSeq: null },
    { keyId: 'd3', sign: 'z', thisDevice: false, addedSeq: 2, revokedSeq: null },
  ];
  const names = [
    { keyId: 'd1', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'no' as const },
    { keyId: 'd3', name: 'Box', kind: 'server', holdsMaster: 'no' as const },
  ];
  const NOW = 1_800_000_000;

  it('a desktop names nothing of its own, and the executor’s key stays this computer', () => {
    expect(custodyDevice(custody(null))).toBeNull();
    expect(custodyDevice(custody(undefined))).toBeNull();
    expect(custodyDevice(null)).toBeNull();
    const rows = deviceRows(keys, names, [], null, NOW, custodyDevice(custody(null)));
    expect(rows.map((r) => [r.keyId, r.label, r.subtitle, r.icon, r.thisDevice, r.canRevoke])).toEqual([
      ['d1', 'Laptop', 'This computer · added at #0', 'laptop', true, false],
      ['d2', 'Unnamed device', 'added at #1', 'key', false, true],
      ['d3', 'Box', 'added at #2', 'hard-drives', false, true],
    ]);
    // And exactly as before there was a custody device at all.
    expect(rows).toEqual(deviceRows(keys, names, [], null, NOW));
  });

  it('a phone is this device, and the computer whose executor it reaches is one more device', () => {
    const here = custodyDevice(custody({ keyId: 'd2', kind: 'phone-app' }));
    expect(here).toEqual({ keyId: 'd2', label: 'This phone', icon: 'device-mobile' });
    const rows = deviceRows(keys, names, [], null, NOW, here);
    expect(rows.map((r) => [r.keyId, r.label, r.subtitle, r.icon, r.thisDevice, r.canRevoke])).toEqual([
      ['d2', 'This phone', 'added at #1', 'device-mobile', true, false],
      // The laptop: its name and kind, and no mark of this device.
      ['d1', 'Laptop', 'added at #0', 'laptop', false, true],
      ['d3', 'Box', 'added at #2', 'hard-drives', false, true],
    ]);
    // A name the record gives the phone stays its label, with "This phone" beside it.
    const named = deviceRows(
      keys,
      [...names, { keyId: 'd2', name: 'Pixel', kind: 'phone-app', holdsMaster: 'yes' as const }],
      [],
      null,
      NOW,
      here,
    );
    expect(named[0]).toMatchObject({ keyId: 'd2', label: 'Pixel', subtitle: 'This phone · added at #1' });
  });

  it('a phone the log does not list yet marks no key as this device', () => {
    const here = custodyDevice(custody({ keyId: null, kind: 'phone-app' }));
    const rows = deviceRows(keys, names, [], null, NOW, here);
    expect(rows.every((r) => !r.thisDevice)).toBe(true);
    expect(rows.map((r) => r.label)).toEqual(['Laptop', 'Unnamed device', 'Box']);
  });

  it('the key log and the requests call the phone “This phone”', () => {
    const events = [
      { seq: 0, op: 'incept', hash: null, added: [{ id: 'd1', sign: 'z' }], revoked: [] },
      { seq: 1, op: 'add', hash: null, added: [{ id: 'd2', sign: 'z' }], revoked: [] },
    ];
    const phone = keyLogRows(events, 'd2', 'This phone');
    expect(phone.map((r) => [r.title, r.detail, r.thisComputer])).toEqual([
      ['Added This phone', 'd2 · This phone', true],
      ['Created your identity', 'with d1', false],
    ]);
    // The desktop's words are unchanged.
    expect(keyLogRows(events, 'd1').map((r) => r.detail)).toEqual(['d2', 'with d1 · This computer']);

    const asks = [{ id: 'r1', kind: 'confirm-revoke' as const, by: 'd3', keyIds: ['d2', 'd1'], expires: 9 }];
    expect(requestRows(asks, names, 'd2', 'This phone')[0].title).toBe('Box asks to revoke This phone, Laptop');
    expect(requestRows(asks, [], 'd1')[0].title).toBe('d3 asks to revoke d2, This computer');
  });

  it('the device serving the session is this computer on a desktop, the host on a phone', () => {
    // The desktop: whatever the record names, the top card is this computer.
    expect(servingDevice(keys, names, custodyDevice(custody(null)))).toEqual({
      label: 'This computer',
      subtitle: 'Serves you now',
      icon: 'desktop',
    });
    expect(servingDevice([], [], null).label).toBe('This computer');

    // A phone: the executor it signs in to marks d1, the laptop, which the record names.
    const here = custodyDevice(custody({ keyId: 'd2', kind: 'phone-app' }));
    expect(servingDevice(keys, names, here)).toEqual({
      label: 'Laptop',
      subtitle: 'Your host · serves you now',
      icon: 'laptop',
    });
    // Never "This computer", whether the record names the host or not, or the list is not read yet.
    expect(servingDevice(keys, [], here)).toEqual({
      label: 'Your host',
      subtitle: 'Serves you now',
      icon: 'hard-drives',
    });
    expect(servingDevice([], names, here).label).toBe('Your host');
  });

  it('a computer the person did not name: its record name everywhere, "This computer" only on itself', () => {
    // `crates/custody` writes an unnamed computer by what it is ("Linux computer"), never as
    // "This computer", which every other device would then show as theirs.
    const unnamed = [{ keyId: 'd1', name: 'Linux computer', kind: 'desktop-app', holdsMaster: 'yes' as const }];
    const desktop = custodyDevice(custody(null));
    expect(servingDevice(keys, unnamed, desktop).label).toBe('This computer');
    expect(deviceRows(keys, unnamed, [], null, NOW, desktop)[0]).toMatchObject({
      keyId: 'd1',
      label: 'Linux computer',
      subtitle: 'This computer · added at #0',
    });
    const phone = custodyDevice(custody({ keyId: 'd2', kind: 'phone-app' }));
    expect(servingDevice(keys, unnamed, phone)).toEqual({
      label: 'Linux computer',
      subtitle: 'Your host · serves you now',
      icon: 'laptop',
    });
    const host = deviceRows(keys, unnamed, [], null, NOW, phone).find((r) => r.keyId === 'd1');
    expect(host).toMatchObject({ label: 'Linux computer', subtitle: 'added at #0' });
  });
});

describe('short forms', () => {
  it('keeps short values whole', () => {
    expect(shortHash('Qm123')).toBe('Qm123');
    expect(shortHash(null)).toBe('');
    expect(shortDid('did:scid:coasys:1:QmLongLongLongHash')).toBe('did:scid:coasys:1:QmLo…Hash');
  });
});
