/** The key log and device list in Settings' words (identity slice 1). */
import { describe, expect, it } from 'vitest';

import { deviceRows, keyLogRows, shortDid, shortHash } from '../src/shared/identityRows';

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
});

describe('short forms', () => {
  it('keeps short values whole', () => {
    expect(shortHash('Qm123')).toBe('Qm123');
    expect(shortHash(null)).toBe('');
    expect(shortDid('did:scid:coasys:1:QmLongLongLongHash')).toBe('did:scid:coasys:1:QmLo…Hash');
  });
});
