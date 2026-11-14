/** The key log and device list in Settings' words. */
import { describe, expect, it } from 'vitest';

import { deviceRows, keyLogRows, lastRotation, requestRows, shortDid, shortHash } from '../src/shared/identityRows';

const REVOKED_HOLDER = 'Still has your master key. Replace it to lock this device out.';
/** Where only the key log speaks: it let the device keep the master key, and the record is gone. */
const REVOKED_MAY_HOLD = 'May still have your master key. Replace it to lock this device out.';

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
      ['d3', 'Device d3', 'Valid', true],
      ['d2', 'Device d2', 'Revoked at #2', false],
    ]);
    expect(rows[1].subtitle).toBe('d3 · added at #3');
    expect(rows.map((r) => r.icon)).toEqual(['laptop', 'key', 'key']);
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
      ['Desktop', 'laptop', 'Has master key'],
      ['Box', 'hard-drives', ''],
      ['Laptop', 'laptop', 'Master key sent'],
      ['Old', 'laptop', REVOKED_HOLDER],
    ]);
    expect(rows[0].subtitle).toBe('This computer · d1 · added at #0');
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
    expect(handedOver[1].master).toBe('Has master key');

    // The revoke: the record's write drops d2's entry, and the key log says d2 may still hold it.
    const revoked = deviceRows(
      [keys[0], { ...keys[1], revokedSeq: 2 }],
      [{ keyId: 'd1', name: 'Desktop', kind: 'desktop-app', holdsMaster: 'yes' }],
      ['d2'],
    );
    expect(revoked.map((r) => [r.label, r.status, r.master])).toEqual([
      ['Desktop', 'Valid', 'Has master key'],
      ['Device d2', 'Revoked at #2', REVOKED_MAY_HOLD],
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
      'Laptop asks to remove This computer, d3',
    ]);
  });
});

describe('short forms', () => {
  it('keeps short values whole', () => {
    expect(shortHash('Qm123')).toBe('Qm123');
    expect(shortHash(null)).toBe('');
    expect(shortDid('did:scid:coasys:1:QmLongLongLongHash')).toBe('did:scid:coasys:1:QmLo…Hash');
  });
});
