/**
 * Contract behavior of the in-memory lifecycle + agent-session ports — the reference the app
 * shell's executor-free tests build on.
 */
import { describe, expect, it, vi } from 'vitest';

import { createInMemoryAgentSession, createInMemoryLifecycle } from '../src/lifecycle';

describe('createInMemoryLifecycle', () => {
  it('lists seeded datasets and creates new ones with change events', async () => {
    const lifecycle = createInMemoryLifecycle([{ id: 'root', name: 'we-root' }]);
    const onAdded = vi.fn();
    lifecycle.subscribe({ onAdded });

    expect((await lifecycle.list()).map((d) => d.name)).toEqual(['we-root']);

    const created = await lifecycle.create('My Space');
    expect(created.name).toBe('My Space');
    expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Space' }));
    expect((await lifecycle.list()).length).toBe(2);
    expect(await lifecycle.get(created.id)).toEqual(created);
  });

  it('removes datasets locally and remotely, firing onRemoved once', async () => {
    const lifecycle = createInMemoryLifecycle([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    const onRemoved = vi.fn();
    lifecycle.subscribe({ onRemoved });

    await lifecycle.remove('a');
    lifecycle.removeRemotely('b');
    lifecycle.removeRemotely('b'); // already gone — no double event

    expect(onRemoved.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(await lifecycle.list()).toEqual([]);
  });

  it('publishes a dataset to a joinable URI and joins seeded shared datasets', async () => {
    const lifecycle = createInMemoryLifecycle();
    const created = await lifecycle.create('Shared');
    const { uri, sharedId } = await lifecycle.publish(created.id);
    expect(uri).toMatch(/^inmemory:\/\//);
    expect(sharedId).toBe(created.id);
    const republished = await lifecycle.get(created.id);
    expect(republished?.sharedUri).toBe(uri);
    expect(republished?.sharedId).toBe(created.id);

    // A "peer's" published dataset becomes joinable without existing locally.
    lifecycle.seedShared({ id: 'peer-ds', name: 'Peer Space', sharedUri: 'inmemory://peer-ds' });
    const joined = await lifecycle.join('inmemory://peer-ds');
    expect(joined.name).toBe('Peer Space');
    expect((await lifecycle.list()).some((d) => d.id === 'peer-ds')).toBe(true);

    await expect(lifecycle.join('inmemory://nowhere')).rejects.toThrow(/nothing published/);
  });

  it('unsubscribe stops events', async () => {
    const lifecycle = createInMemoryLifecycle();
    const onAdded = vi.fn();
    const unsubscribe = lifecycle.subscribe({ onAdded });
    unsubscribe();
    await lifecycle.create('X');
    expect(onAdded).not.toHaveBeenCalled();
  });
});

describe('createInMemoryAgentSession', () => {
  it('walks the boot state machine: locked → unlock → me → lock', async () => {
    const session = createInMemoryAgentSession({ id: 'did:test:james', password: 'pw' });

    expect(await session.status()).toEqual({ hasAgent: true, unlocked: false });
    await expect(session.me()).rejects.toThrow(/locked/);
    await expect(session.unlock('wrong')).rejects.toThrow(/invalid password/);

    await session.unlock('pw');
    expect(await session.status()).toEqual({ hasAgent: true, unlocked: true });
    // `did` mirrors `id` so template-facing vocabulary ($me.did) keeps working.
    expect(await session.me()).toEqual({ id: 'did:test:james', did: 'did:test:james' });

    await session.lock('pw');
    expect((await session.status()).unlocked).toBe(false);
  });

  it('models the first-run flow (no agent yet)', async () => {
    const session = createInMemoryAgentSession({ hasAgent: false });
    expect((await session.status()).hasAgent).toBe(false);
  });
});
