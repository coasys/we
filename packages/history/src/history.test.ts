import { describe, expect, it, vi } from 'vitest';

import { createHistory, type HistoryEntry } from './index';

/** The two closures a host's `createSignal` stands in for. */
function signal<T>(initial: T): [() => T, (next: T) => void] {
  let value = initial;
  return [() => value, (next: T) => (value = next)];
}

/** An entry over a shared counter, so a test can move "the world" out from under it. */
function entry(over: { value: string }, from: string, to: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    scope: 'canvas-1',
    label: `set ${to}`,
    undo: () => void (over.value = from),
    redo: () => void (over.value = to),
    // Each direction asks about what the entry last left behind — see `HistoryEntry.stale`.
    stale: (direction) => (direction === 'undo' ? over.value !== to : over.value !== from),
    ...extra,
  };
}

describe('createHistory', () => {
  it('replays backwards and forwards', async () => {
    const world = { value: 'b' };
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push(entry(world, 'a', 'b'));

    expect(history.state().canUndo).toBe(true);
    await history.undo();
    expect(world.value).toBe('a');
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: true });

    await history.redo();
    expect(world.value).toBe('b');
    expect(history.state()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('drops an entry the world has moved past, rather than fighting for it', async () => {
    /*
      The rule that stops an undo teleporting a card out from under the peer who just moved it. The
      entry says it left the value at 'b'; a peer has since made it 'c', so putting 'a' back would
      discard a change this agent never saw.
    */
    const world = { value: 'b' };
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push(entry(world, 'a', 'b'));

    world.value = 'c';
    await history.undo();

    expect(world.value).toBe('c');
    expect(history.state().canUndo).toBe(false);
  });

  it('walks past a stale entry to one that still holds', async () => {
    const stale = { value: 'x' };
    const live = { value: 'b' };
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push(entry(live, 'a', 'b'));
    history.push(entry(stale, 'p', 'q'));

    await history.undo();

    expect(live.value).toBe('a');
  });

  it('asks about the direction it is going, not only about the original write', async () => {
    /*
      The bug the first version of this had, and it is invisible from the store side: an entry that
      has just been undone left the OLD value behind, so a staleness check asked only about the new
      one calls every redo stale and redo silently does nothing.
    */
    const world = { value: 'b' };
    const asked: string[] = [];
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push(entry(world, 'a', 'b', { stale: (direction) => void asked.push(direction) as unknown as boolean }));

    await history.undo();
    await history.redo();

    expect(asked).toEqual(['undo', 'redo']);
  });

  it('treats an absent stale check as always applicable', async () => {
    const seen: string[] = [];
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push({ scope: 'canvas-1', label: 'act', undo: () => void seen.push('undo'), redo: () => undefined });

    await history.undo();

    expect(seen).toEqual(['undo']);
  });

  it('ends the future when a new act is recorded', async () => {
    const world = { value: 'b' };
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push(entry(world, 'a', 'b'));
    await history.undo();
    expect(history.state().canRedo).toBe(true);

    world.value = 'z';
    history.push(entry(world, 'a', 'z'));

    expect(history.state().canRedo).toBe(false);
  });

  it('forgets everything when the scope changes', () => {
    const world = { value: 'b' };
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push(entry(world, 'a', 'b'));

    history.scopeTo('canvas-2');

    expect(history.state().canUndo).toBe(false);
  });

  it('ignores a scope it is already pointed at', () => {
    const world = { value: 'b' };
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push(entry(world, 'a', 'b'));

    history.scopeTo('canvas-1');

    expect(history.state().canUndo).toBe(true);
  });

  it('adopts the scope of an entry that disagrees, rather than dropping the act', () => {
    const world = { value: 'b' };
    const history = createHistory(signal);
    history.scopeTo('canvas-1');

    history.push(entry(world, 'a', 'b', { scope: 'canvas-2' }));

    expect(history.state()).toMatchObject({ canUndo: true, undoLabel: 'set b' });
  });

  it('refuses a second replay while one is in flight', async () => {
    /*
      A reader holding the key down. Both presses would read the same "before" value, and the second
      would be judged stale by a world the first had already changed — so the stack would eat an
      entry per press while only one of them did anything.
    */
    let release: (() => void) | undefined;
    const undone = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push({ scope: 'canvas-1', label: 'slow', undo: undone, redo: () => undefined });
    history.push({ scope: 'canvas-1', label: 'second', undo: () => undefined, redo: () => undefined });

    void history.undo();
    void history.undo();

    expect(history.state().canUndo).toBe(true);
    release?.();
  });

  it('drops a replay that threw, so the key does not retry it forever', async () => {
    const failing = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push({
      scope: 'canvas-1',
      label: 'doomed',
      undo: () => Promise.reject(new Error('gone')),
      redo: () => undefined,
    });

    await history.undo();

    expect(history.state().canUndo).toBe(false);
    failing.mockRestore();
  });

  it('forgets the oldest act past its limit', () => {
    const world = { value: '' };
    const history = createHistory(signal, { limit: 2 });
    history.scopeTo('canvas-1');
    history.push(entry(world, '', 'one'));
    history.push(entry(world, '', 'two'));
    history.push(entry(world, '', 'three'));

    expect(history.state().undoLabel).toBe('set three');
  });

  it('names what a press would do, for a tooltip', async () => {
    const world = { value: 'b' };
    const history = createHistory(signal);
    history.scopeTo('canvas-1');
    history.push(entry(world, 'a', 'b'));

    expect(history.state().undoLabel).toBe('set b');
    await history.undo();
    expect(history.state().redoLabel).toBe('set b');
  });
});
