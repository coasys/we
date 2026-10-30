/**
 * The Feed module's own store: messages written from it, and staying live while it is drawn.
 */
import { markAction, markState } from '@we/module-shared';
import { describe, expect, it, vi } from 'vitest';

import { createFeedStore } from './store';

/** Signals and effects that track each other, so the store's effects rerun as they do in the app. */
function reactive() {
  let running: (() => void) | null = null;
  const signal = <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    const readers = new Set<() => void>();
    return [
      () => {
        if (running) readers.add(running);
        return value;
      },
      (next: T) => {
        if (Object.is(next, value)) return;
        value = next;
        for (const reader of [...readers]) reader();
      },
    ];
  };
  const effect = (fn: () => void) => {
    const run = () => {
      const outer = running;
      running = run;
      try {
        fn();
      } finally {
        running = outer;
      }
    };
    run();
  };
  return { signal, effect };
}

type Created = { entity: string; fields: Record<string, unknown>; options: unknown };

function harness(proposals: { id: string; kind: string }[] = []) {
  const { signal, effect } = reactive();
  const created: Created[] = [];
  const updated: { entity: string; id: string; fields: Record<string, unknown> }[] = [];
  const subscriptions: string[] = [];
  const records = {
    find: async (entity: string) => (entity === 'Space' ? [{ id: 'space-1', root: { id: 'root-1' } }] : []),
    subscribe: (entity: string) => {
      subscriptions.push(entity);
      return () => {};
    },
    create: async (entity: string, fields: Record<string, unknown>, options: unknown) => {
      created.push({ entity, fields, options });
      return `new-${created.length}`;
    },
    update: async (entity: string, id: string, fields: Record<string, unknown>) => {
      updated.push({ entity, id, fields });
    },
  };
  const interpretation = {
    targets: () => [],
    proposals: vi.fn(async () => proposals),
    proposalsRevision: () => 0,
  };
  const store = createFeedStore({
    signal,
    effect,
    state: markState,
    action: markAction,
    onDispose: () => {},
    dataset: () => 'space-1',
    settings: () => ({}),
    kernels: { records, interpretation },
  } as never) as Record<string, (...args: unknown[]) => unknown>;
  return { store, created, updated, subscriptions, interpretation };
}

describe('messages written from the Feed', () => {
  it('writes into the space collection, as a typed line', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    await h.store.sendToFeed('see you all on Friday', '[{"start":0,"end":3,"type":"strong"}]');
    expect(h.created).toEqual([
      {
        entity: 'TextBlock',
        fields: { text: 'see you all on Friday', source: 'typed', marks: '[{"start":0,"end":3,"type":"strong"}]' },
        options: { parent: { id: 'root-1', relation: 'children', entity: 'CollectionBlock' } },
      },
    ]);
    vi.useRealTimers();
  });

  it('hangs a reply off the line it answers, and puts the reply down once sent', async () => {
    const h = harness();
    h.store.startReply({ id: 'line-1', text: 'who has the venue?', author: 'did:ann' });
    expect(h.store.replyingTo()).toEqual({ id: 'line-1', text: 'who has the venue?', author: 'did:ann' });
    await h.store.reply('line-1', 'I do');
    expect(h.created[0]).toMatchObject({
      entity: 'TextBlock',
      fields: { text: 'I do', source: 'typed' },
      options: { parent: { id: 'line-1', relation: 'responses' } },
    });
    expect(h.store.replyingTo()).toBeNull();
  });

  it('marks a heard line corrected when somebody mends it, and leaves a typed one typed', async () => {
    const h = harness();
    await h.store.editUtterance('heard', 'Ana, not Anna', 'spoken');
    await h.store.editUtterance('typed', 'lunch at one', 'typed');
    expect(h.updated).toEqual([
      { entity: 'TextBlock', id: 'heard', fields: { text: 'Ana, not Anna', source: 'corrected' } },
      { entity: 'TextBlock', id: 'typed', fields: { text: 'lunch at one' } },
    ]);
  });
});

describe('staying live', () => {
  it('reads nothing until somebody looks, and keeps reading while a view of it is drawn', async () => {
    vi.useFakeTimers();
    const h = harness([
      { id: 'kept-later', kind: 'create' },
      { id: 'a-change', kind: 'update' },
    ]);
    await vi.runAllTimersAsync();
    expect(h.subscriptions).toEqual([]);
    expect(h.interpretation.proposals).not.toHaveBeenCalled();

    // A view of the Feed is drawn: the host calls `watchFeed`, as it would open the panel.
    h.store.watchFeed();
    await vi.runAllTimersAsync();
    expect(h.subscriptions).toContain('TextBlock');
    // Asked of the whole space, by the host's kernel rather than by another module.
    expect(h.interpretation.proposals).toHaveBeenCalledWith(undefined, undefined);

    vi.useRealTimers();
  });
});
