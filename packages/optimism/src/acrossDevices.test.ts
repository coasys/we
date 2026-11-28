/**
 * One person's newest record across their devices — the order every reader picks by, and the cleanup
 * a device does after a write agreeing with it.
 */
import { describe, expect, it, vi } from 'vitest';

import { compareWritten, keepNewestAcrossDevices, newestWritten, replaceAcrossDevices } from './acrossDevices';

/** A store of rows, each able to take itself away; `refuse` names ids the space will not remove. */
function stored(rows: { id: string; createdAt?: unknown }[], refuse: string[] = []) {
  const live = rows.map((row) => ({
    ...row,
    delete: async () => {
      if (refuse.includes(row.id)) throw new Error('refused by policy');
      const at = live.findIndex((r) => r.id === row.id);
      if (at >= 0) live.splice(at, 1);
    },
  }));
  return live;
}

describe('compareWritten', () => {
  it('puts the later time first, then the larger id, then a held row above everything', () => {
    expect(compareWritten({ id: 'a', createdAt: '2026-11-01T11:00:00Z' }, { id: 'b', createdAt: 1 })).toBeGreaterThan(
      0,
    );
    expect(compareWritten({ id: 'a', createdAt: 5 }, { id: 'b', createdAt: 5 })).toBeLessThan(0);
    expect(compareWritten({}, { id: 'z', createdAt: Date.now() })).toBeGreaterThan(0);
  });

  it('picks the same newest whichever order the rows are listed in', () => {
    const rows = [
      { id: 'v1', createdAt: '2026-11-01T10:00:00Z' },
      { id: 'v3', createdAt: '2026-11-01T10:00:00Z' },
      { id: 'v2', createdAt: '2026-11-01T10:00:00Z' },
    ];
    expect(newestWritten(rows)?.id).toBe('v3');
    expect(newestWritten([...rows].reverse())?.id).toBe('v3');
  });
});

describe('keepNewestAcrossDevices', () => {
  it('removes what loses to the write, and leaves the write', async () => {
    const live = stored([
      { id: 'old', createdAt: 1 },
      { id: 'new', createdAt: 2 },
    ]);
    const removed = await keepNewestAcrossDevices(live[1], [...live], 'test');
    expect([...removed]).toEqual(['old']);
    expect(live.map((row) => row.id)).toEqual(['new']);
  });

  it('takes the write back when another of my computers wrote later', async () => {
    const live = stored([
      { id: 'mine', createdAt: 1 },
      { id: 'laptop', createdAt: 2 },
    ]);
    await keepNewestAcrossDevices(live[0], [...live], 'test');
    expect(live.map((row) => row.id)).toEqual(['laptop']);
  });

  it('two devices cleaning up at once leave exactly the one both readers pick', async () => {
    const live = stored([
      { id: 'phone', createdAt: 7 },
      { id: 'laptop', createdAt: 7 },
    ]);
    const [phone, laptop] = live;
    const seen = [...live];
    await Promise.all([keepNewestAcrossDevices(phone, seen, 'test'), keepNewestAcrossDevices(laptop, seen, 'test')]);
    expect(live.map((row) => row.id)).toEqual([newestWritten(seen)?.id]);
  });

  it('leaves a refused removal standing and only logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const live = stored(
      [
        { id: 'laptop', createdAt: 1 },
        { id: 'phone', createdAt: 2 },
      ],
      ['laptop'],
    );
    const removed = await keepNewestAcrossDevices(live[1], [...live], 'could not');
    expect(removed.size).toBe(0);
    expect(live).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith('could not', expect.any(Error));
    warn.mockRestore();
  });
});

describe('replaceAcrossDevices', () => {
  it('removes every one and answers how many were refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const live = stored([{ id: 'a' }, { id: 'b' }], ['b']);
    expect(await replaceAcrossDevices([...live], 'could not')).toBe(1);
    expect(live.map((row) => row.id)).toEqual(['b']);
    warn.mockRestore();
  });
});
