/** The key log and device list in Settings' words. */
import { describe, expect, it } from 'vitest';

import { deviceRows, keyLogRows, requestRows, shortDid, shortHash } from '../src/shared/identityRows';

const REVOKED_HOLDER = 'Still has your master key. Replace it to lock this device out.';
/** Where only the key log speaks: it let the device keep the master key, and the record is gone. */
const REVOKED_MAY_HOLD = 'May still have your master key. Replace it to lock this device out.';

describe('keyLogRows', () => {
  const events = [
    { seq: 0, op: 'incept', hash: 'QmZkAAAAAAAAAAAA7rWd', added: [{ id: 'd1', sign: 'z' }], unlinked: [], revoked: [] },
    { seq: 1, op: 'add', hash: 'QmN4BBBBBBBBBByFlk', added: [{ id: 'd2', sign: 'z' }], unlinked: [], revoked: [] },
    { seq: 2, op: 'revoke', hash: null, added: [], unlinked: [], revoked: ['d2'] },
    { seq: 3, op: 'rotate', hash: null, added: [], unlinked: [], revoked: [] },
    { seq: 4, op: 'scope', hash: null, added: [], unlinked: [], revoked: [] },
  ];

  it('words each event, newest first, and marks this computer', () => {
    const rows = keyLogRows(events, 'd1');
    expect(rows.map((r) => [r.position, r.title, r.detail])).toEqual([
      ['#4', 'Scope', ''],
      ['#3', 'Replaced the master key', 'with your recovery phrase'],
      ['#2', 'Revoked d2', 'd2'],
      ['#1', 'Added d2', 'd2'],
      ['#0', 'Created identity', 'with d1 · This computer'],
    ]);
    expect(rows.find((r) => r.seq === 0)!.thisComputer).toBe(true);
    expect(rows.find((r) => r.seq === 1)!.thisComputer).toBe(false);
    expect(rows.find((r) => r.seq === 0)!.hashShort).toBe('QmZk…7rWd');
  });

  it('reads an unlink as the key it retires', () => {
    const [row] = keyLogRows([{ seq: 2, op: 'unlink', hash: null, added: [], unlinked: ['d2'], revoked: [] }], 'd1');
    expect([row.title, row.detail, row.keys, row.icon]).toEqual(['Unlinked d2', 'd2', ['d2'], 'link-break']);
  });

  it('names this computer and every other key by its id', () => {
    const rows = keyLogRows(events.slice(0, 3), 'd2');
    expect(rows.map((r) => r.title)).toEqual(['Revoked this computer', 'Added this computer', 'Created identity']);
    expect(rows[2].detail).toBe('with d1');
  });
});

describe('deviceRows', () => {
  it('puts valid keys first and this computer on top, and offers revoke for the others only', () => {
    const rows = deviceRows([
      { keyId: 'd3', sign: 'z', thisDevice: false, addedSeq: 3, unlinkedSeq: null, revokedSeq: null },
      { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, unlinkedSeq: null, revokedSeq: 2 },
      { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, unlinkedSeq: null, revokedSeq: null },
    ]);
    expect(rows.map((r) => [r.keyId, r.label, r.status, r.canUnlink, r.canRevoke])).toEqual([
      ['d1', 'This computer', 'Active', false, false],
      ['d3', 'Device d3', 'Active', true, true],
      ['d2', 'Device d2', 'Revoked', false, false],
    ]);
    expect(rows[1].subtitle).toBe('d3 · added at #3');
    expect(rows.map((r) => r.icon)).toEqual(['laptop', 'key', 'key']);
  });

  it('reads a device Active, Unlinked or Revoked, and lets an unlinked one be revoked but not unlinked again', () => {
    const rows = deviceRows([
      { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, unlinkedSeq: null, revokedSeq: null },
      { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, unlinkedSeq: 3, revokedSeq: null },
      { keyId: 'd3', sign: 'z', thisDevice: false, addedSeq: 2, unlinkedSeq: 4, revokedSeq: 5 },
      { keyId: 'd4', sign: 'z', thisDevice: false, addedSeq: 6, unlinkedSeq: null, revokedSeq: null },
    ]);
    expect(rows.map((r) => [r.keyId, r.status, r.unlinked, r.revoked, r.canUnlink, r.canRevoke])).toEqual([
      ['d1', 'Active', false, false, false, false],
      ['d4', 'Active', false, false, true, true],
      ['d2', 'Unlinked', true, false, false, true],
      ['d3', 'Revoked', true, true, false, false],
    ]);
  });

  it('names each device as the private record does, and says which keep the master key', () => {
    const rows = deviceRows(
      [
        { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, unlinkedSeq: null, revokedSeq: null },
        { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, unlinkedSeq: null, revokedSeq: null },
        { keyId: 'd3', sign: 'z', thisDevice: false, addedSeq: 2, unlinkedSeq: null, revokedSeq: null },
        { keyId: 'd4', sign: 'z', thisDevice: false, addedSeq: 3, unlinkedSeq: null, revokedSeq: 4 },
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
      { keyId: 'd1', sign: 'z', thisDevice: true, addedSeq: 0, unlinkedSeq: null, revokedSeq: null },
      { keyId: 'd2', sign: 'z', thisDevice: false, addedSeq: 1, unlinkedSeq: null, revokedSeq: null },
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
      ['Desktop', 'Active', 'Has master key'],
      ['Device d2', 'Revoked', REVOKED_MAY_HOLD],
    ]);

    // A revoked device the log never let keep the master key carries no warning.
    const server = deviceRows([keys[0], { ...keys[1], revokedSeq: 2 }], [], []);
    expect(server[1].master).toBe('');

    // An unlink does not replace the master key either: the row warns, in words for a device the
    // person may still have. Before the record's write it still lists the device as a holder.
    const unlinked = [keys[0], { ...keys[1], unlinkedSeq: 2 }];
    const kept = deviceRows(unlinked, [{ keyId: 'd2', name: 'Laptop', kind: 'desktop-app', holdsMaster: 'yes' }]);
    expect([kept[1].status, kept[1].holdsMaster, kept[1].master]).toEqual([
      'Unlinked',
      'no',
      "Still has your master key. Replace it if you don't have this device any more.",
    ]);
    expect(deviceRows(unlinked, [], ['d2'])[1].master).toBe(
      "May still have your master key. Replace it if you don't have this device any more.",
    );
    expect(deviceRows(unlinked, [], [])[1].master).toBe('');
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
    // A removal revokes the device key; a copy of the master key stays valid until it is replaced.
    expect(rows[1].detail).toBe(
      'Their device keys stop working. A device with your master key keeps access until you replace it.',
    );
  });
});

describe('short forms', () => {
  it('keeps short values whole', () => {
    expect(shortHash('Qm123')).toBe('Qm123');
    expect(shortHash(null)).toBe('');
    expect(shortDid('did:scid:coasys:1:QmLongLongLongHash')).toBe('did:scid:coasys:1:QmLo…Hash');
  });
});
