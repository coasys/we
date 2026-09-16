import type { ModuleDefinition } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { buildStore, fakeDeps, fakePresence, fakeRecords, lintModule } from './index';

describe('fakeRecords', () => {
  it('stores what a module writes and reads it back by equality, order and limit', async () => {
    const records = fakeRecords({ author: 'did:a' });
    await records.kernel.create('Vote', { pollId: 'p1', option: 'tea' });
    await records.kernel.create('Vote', { pollId: 'p1', option: 'milk' });
    await records.kernel.create('Vote', { pollId: 'p2', option: 'tea' });

    expect(await records.kernel.find('Vote', { where: { pollId: 'p1' } })).toHaveLength(2);
    expect(
      (await records.kernel.find('Vote', { where: { pollId: 'p1' }, order: { option: 'asc' }, limit: 1 }))[0].option,
    ).toBe('milk');
    expect(records.rows.every((row) => row.author === 'did:a')).toBe(true);
    expect(records.writes.map((w) => w.op)).toEqual(['create', 'create', 'create']);
  });

  it('fires a subscription on every write, with the current rows', async () => {
    const records = fakeRecords();
    const seen: number[] = [];
    const stop = records.kernel.subscribe('Note', {}, (rows) => void seen.push(rows.length));
    await records.kernel.create('Note', { text: 'a' });
    await records.kernel.create('Other', {});
    stop();
    await records.kernel.create('Note', { text: 'b' });
    expect(seen).toEqual([0, 1, 1]);
  });

  it('records the dataset a write named, so a test can assert on the target', async () => {
    const records = fakeRecords();
    await records.kernel.create('TextBlock', { text: 'x' }, { dataset: 'neighbourhood://there' });
    expect(records.writes[0].dataset).toBe('neighbourhood://there');
  });
});

describe('fakePresence', () => {
  it('holds a roster a test shapes, and records what the module publishes', () => {
    const presence = fakePresence({ self: 'did:me' });
    presence.publish('did:peer', { type: 'call', id: 'c1' });
    presence.kernel.setActivity({ type: 'call', id: 'c1' });
    expect(
      presence.kernel
        .peers()
        .map((p) => p.agentId)
        .sort(),
    ).toEqual(['did:me', 'did:peer']);
    expect(presence.published).toEqual([{ type: 'call', id: 'c1' }]);
    presence.kernel.clearActivity('call', 'c1');
    expect(presence.cleared).toEqual([{ type: 'call', id: 'c1' }]);
  });
});

describe('buildStore', () => {
  const definition: ModuleDefinition = {
    manifest: { id: 'demo', name: 'Demo', requires: { kernels: ['records'] } },
    createStore: ({ kernels, state }) => ({
      hasRecords: state(() => Boolean(kernels.records), 'x'),
      hasPresence: state(() => Boolean(kernels.presence), 'x'),
    }),
  };

  it('hands the store only the kernels the manifest names, as the registry does', () => {
    const store = buildStore(
      definition,
      fakeDeps({ kernels: { records: fakeRecords().kernel, presence: fakePresence().kernel } }),
    ) as { hasRecords: () => boolean; hasPresence: () => boolean };
    expect(store.hasRecords()).toBe(true);
    // Handed in by the test and dropped: the manifest never asked for it.
    expect(store.hasPresence()).toBe(false);
  });

  it('lints the same way the registry judges', () => {
    expect(lintModule(definition).problems).toEqual([]);
  });
});
