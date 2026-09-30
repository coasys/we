import type { LiveAnchor, LiveDecoration, ModuleDefinition } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { buildStore, fakeDeps, fakeEphemeral, fakePresence, fakeRecords, fakeView, lintModule } from './index';

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

describe('fakeEphemeral', () => {
  it('carries a message from another agent, and records what the module published', () => {
    const wire = fakeEphemeral({ self: 'did:me' });
    const scope = wire.port(wire.dataset)!;
    const heard: { from: string; payload: unknown }[] = [];
    scope.channel('live').onMessage((from, payload) => void heard.push({ from, payload }));

    wire.agent('did:ana').channel('live').publish({ kind: 'cursor' });
    expect(heard).toEqual([{ from: 'did:ana', payload: { kind: 'cursor' } }]);

    scope.channel('live').publish({ kind: 'view' });
    expect(wire.sent('live')).toEqual([{ tag: 'live', payload: { kind: 'view' }, to: undefined }]);
    // Never looped back to the sender, which is what real broadcast does.
    expect(heard).toHaveLength(1);
  });

  it('keeps channels apart by tag, and records a send it refused to deliver', () => {
    const wire = fakeEphemeral();
    const scope = wire.port(wire.dataset)!;
    const live: unknown[] = [];
    scope.channel('live').onMessage((_from, payload) => void live.push(payload));
    wire.agent('did:ana').channel('presence').publish({ v: 1 });
    expect(live).toEqual([]);

    wire.drop();
    scope.channel('live').publish({ kind: 'cursor' });
    // Recorded as published — the module did its part — and never delivered.
    expect(wire.sent('live')).toHaveLength(1);
    expect(live).toEqual([]);
  });
});

describe('fakeView', () => {
  it('reports a pointer, reads decorations fresh, and records a frame applied', () => {
    const view = fakeView({ frame: { path: '/space/a/canvas' } });
    const seen: (LiveAnchor | null)[] = [];
    view.kernel.onPointer((at) => void seen.push(at));

    const at: LiveAnchor = { surface: 'canvas:c1', kind: 'world', x: 10, y: 20 };
    view.move(at);
    view.move(null);
    expect(seen).toEqual([at, null]);

    expect(view.decorating()).toBe(false);
    let marks: LiveDecoration[] = [];
    view.kernel.decorate(() => marks);
    expect(view.decorating()).toBe(true);
    expect(view.decorations()).toEqual([]);
    // Read through the accessor, so a test sees what the host would see on its next read.
    marks = [{ id: 'did:ana', at, node: { type: 'we-live-cursor' } }];
    expect(view.decorations()).toHaveLength(1);

    expect(view.kernel.frame().path).toBe('/space/a/canvas');
    view.kernel.apply({ path: '/space/a/kanban' });
    expect(view.applied.map((f) => f.path)).toEqual(['/space/a/kanban']);
  });
});
