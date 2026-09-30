import { describe, expect, it } from 'vitest';

import { toPeerRecords } from '../src/peerRecords';

/** A record as `runtime.hcAgentInfos` returns it: Kitsune2's signed agent info encoding. */
function kitsuneRecord(info: Record<string, unknown>, signature = 'c2lnbmF0dXJl'): string {
  return JSON.stringify({ agentInfo: JSON.stringify(info), signature });
}

const info = {
  agent: 'YWdlbnQ',
  space: 'c3BhY2U',
  // 2026-09-15T08:00:00.000Z, in microseconds, as Kitsune writes it.
  createdAt: '1789459200000000',
  expiresAt: '1789460400000000',
  isTombstone: false,
  url: 'wss://relay.example/peer',
  storageArc: [0, 4294967295],
};

describe('toPeerRecords', () => {
  it('hands back the records exactly as they arrived, for copying', () => {
    const raw = [kitsuneRecord(info), kitsuneRecord({ ...info, agent: 'b3RoZXI' })];
    expect(toPeerRecords(raw).records).toBe(raw);
  });

  it('unpacks the agent info from inside its string, with dates for the timestamps', () => {
    const [record] = JSON.parse(toPeerRecords([kitsuneRecord(info)]).readable);

    expect(record).toEqual({
      agent: 'YWdlbnQ',
      space: 'c3BhY2U',
      createdAt: '2026-09-15T08:00:00.000Z',
      expiresAt: '2026-09-15T08:20:00.000Z',
      isTombstone: false,
      url: 'wss://relay.example/peer',
      storageArc: [0, 4294967295],
      signature: 'c2lnbmF0dXJl',
    });
    // Identity and validity first — what somebody reading a record is looking for.
    expect(Object.keys(record).slice(0, 4)).toEqual(['agent', 'space', 'createdAt', 'expiresAt']);
  });

  it('leaves out a field the record does not carry, rather than showing it as null', () => {
    const { url: _url, ...tombstone } = { ...info, isTombstone: true };
    const [record] = JSON.parse(toPeerRecords([kitsuneRecord(tombstone)]).readable);
    expect(record).not.toHaveProperty('url');
  });

  it('shows a record it cannot decode as the string it arrived as', () => {
    const readable = JSON.parse(toPeerRecords(['not a record', '{"agentInfo":"{broken"}']).readable);
    expect(readable).toEqual(['not a record', '{"agentInfo":"{broken"}']);
  });

  it('keeps a timestamp it cannot read as it was', () => {
    const [record] = JSON.parse(toPeerRecords([kitsuneRecord({ ...info, createdAt: 'soon' })]).readable);
    expect(record.createdAt).toBe('soon');
  });

  it('is an empty list when there are no records', () => {
    expect(toPeerRecords([]).readable).toBe('[]');
  });
});
