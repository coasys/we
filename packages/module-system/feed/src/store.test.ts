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

function harness(
  proposals: { id: string; kind: string }[] = [],
  moduleSettings: Record<string, unknown> = {},
  /** How a read is answered — or, more simply, the lines each collection holds, by its id. */
  reads:
    | ((entity: string, query: Record<string, unknown>) => Promise<Record<string, unknown>[]>)
    | Record<string, Record<string, unknown>[]> = async () => [],
  spaceRoot: () => string = () => 'root-1',
) {
  const held = typeof reads === 'function' ? null : reads;
  const find =
    typeof reads === 'function'
      ? reads
      : async (entity: string, query: Record<string, unknown>) =>
          entity === 'TextBlock' ? (held?.[String(query.within ?? '')] ?? []) : [];
  const { signal, effect } = reactive();
  const created: Created[] = [];
  const updated: { entity: string; id: string; fields: Record<string, unknown> }[] = [];
  const subscriptions: string[] = [];
  const subscribed: { entity: string; query: Record<string, unknown> }[] = [];
  /** Subscriptions still up, by what they are within. */
  const live = new Set<{ entity: string; within?: string }>();
  const finds: { entity: string; within?: string }[] = [];
  const linked: unknown[] = [];
  const identities = new Map<string, { kind: string }>([['did:bot', { kind: 'bot' }]]);
  const records = {
    find: async (entity: string, query: Record<string, unknown> = {}) => {
      finds.push({ entity, within: query.within as string | undefined });
      return find(entity, query);
    },
    subscribe: (entity: string, query: Record<string, unknown> = {}) => {
      subscriptions.push(entity);
      subscribed.push({ entity, query });
      const sub = { entity, within: query.within as string | undefined };
      live.add(sub);
      return () => live.delete(sub);
    },
    link: async (...args: unknown[]) => {
      linked.push(args);
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
  const firstScreen: { waiting: () => void; answered: () => void; held?: () => boolean } = {
    waiting: vi.fn(),
    answered: vi.fn(),
  };
  const disposers: (() => void)[] = [];
  const dispose = () => disposers.forEach((stop) => stop());
  const store = createFeedStore({
    signal,
    effect,
    state: markState,
    action: markAction,
    onDispose: (stop: () => void) => void disposers.push(stop),
    dataset: () => 'space-1',
    spaceRoot,
    settings: () => moduleSettings,
    identities: { get: (id: string) => identities.get(id), fetch: () => {} },
    kernels: { records, interpretation },
    firstScreen,
  } as never) as Record<string, (...args: unknown[]) => unknown>;
  return {
    store,
    created,
    updated,
    subscriptions,
    subscribed,
    live,
    finds,
    linked,
    interpretation,
    firstScreen,
    dispose,
  };
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
    expect(h.store.replyingTo()).toEqual({
      id: 'line-1',
      text: 'who has the venue?',
      author: 'did:ann',
      surface: 'feed',
    });
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

describe('the reader’s choices', () => {
  it('exposes the per-space transcript choice, off until this space asks for it', () => {
    expect(harness([], {}).store.showCallTranscripts()).toBe(false);
    expect(harness([], { showCallTranscripts: false }).store.showCallTranscripts()).toBe(false);
    expect(harness([], { showCallTranscripts: true }).store.showCallTranscripts()).toBe(true);
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
    // Only the bot watch, which is for the reader who is not looking (see `botWatch.ts`).
    expect(h.subscriptions).toEqual(['TextBlock']);
    expect(h.interpretation.proposals).not.toHaveBeenCalled();

    // A view of the Feed is drawn: the host calls `watchFeed`, as it would open the panel.
    h.store.watchFeed();
    await vi.runAllTimersAsync();
    expect(h.subscriptions).toEqual(['TextBlock', 'TextBlock', 'CollectionBlock']);
    // Asked of the whole space, by the host's kernel rather than by another module.
    expect(h.interpretation.proposals).toHaveBeenCalledWith(undefined, undefined);

    vi.useRealTimers();
  });

  it('follows the newest call by the fields a window draws of it, not the whole call', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.store.watchFeed();
    await vi.runAllTimersAsync();
    /*
      A whole call carries the id of every line said in it, which is most of what a call weighs. Its
      title and time are what the window draws, and what a change worth a re-read moves.
    */
    const call = h.subscribed.find((s) => s.entity === 'CollectionBlock');
    expect(call?.query).toMatchObject({ where: { kind: 'call' }, limit: 1, select: ['title', 'createdAt'] });
    vi.useRealTimers();
  });
});

describe('the first screen', () => {
  /** A read held open until the test lets it land. */
  function heldRead() {
    let land!: () => void;
    const landed = new Promise<void>((resolve) => (land = resolve));
    return { find: async () => (await landed, []), land: () => land() };
  }

  it('says it is reading as its first read leaves on being drawn, and answered once that page lands', async () => {
    const read = heldRead();
    const h = harness([], {}, read.find);
    expect(h.firstScreen.waiting).not.toHaveBeenCalled();

    h.store.watchFeed();
    await Promise.resolve();
    expect(h.firstScreen.waiting).toHaveBeenCalledTimes(1);
    expect(h.firstScreen.answered).not.toHaveBeenCalled();

    read.land();
    await vi.waitFor(() => expect(h.firstScreen.answered).toHaveBeenCalledTimes(1));
  });

  it('says answered when its first read fails too: the reader is looking at an error, not waiting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness([], {}, async () => {
      throw new Error('executor gone');
    });
    h.store.watchFeed();
    await vi.waitFor(() => expect(h.firstScreen.answered).toHaveBeenCalledTimes(1));
    warn.mockRestore();
  });

  it('never says it is reading in a space without a collection, where no read ever leaves', async () => {
    /*
      A space made before spaces had a collection: the Feed is drawn, but there is nothing to read
      from. Saying "waiting" there held the rest of the app until the gate's ceiling.
    */
    const find = vi.fn(async () => []);
    const h = harness([], {}, find, () => '');
    h.store.watchFeed();
    await Promise.resolve();
    expect(find).not.toHaveBeenCalled();
    expect(h.firstScreen.waiting).not.toHaveBeenCalled();
  });

  it('says answered when the reader leaves before its first page lands, and only once', async () => {
    /*
      Leaving stops the read (`FeedReadStopped`), so it never lands or fails — and the next screen's
      `drawn` cannot open a gate the Feed still says it is waiting on.
    */
    const read = heldRead();
    const h = harness([], {}, read.find);
    h.store.watchFeed();
    await Promise.resolve();
    expect(h.firstScreen.waiting).toHaveBeenCalledTimes(1);

    h.store.unwatchFeed();
    expect(h.firstScreen.answered).toHaveBeenCalledTimes(1);

    read.land();
    h.store.watchFeed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Coming back is not a first screen: said once, for the life of the store.
    expect(h.firstScreen.waiting).toHaveBeenCalledTimes(1);
    expect(h.firstScreen.answered).toHaveBeenCalledTimes(1);
  });

  it('says answered when it is taken down while its first page is still reading', async () => {
    const read = heldRead();
    const h = harness([], {}, read.find);
    h.store.watchFeed();
    await Promise.resolve();
    expect(h.firstScreen.waiting).toHaveBeenCalledTimes(1);
    h.dispose();
    expect(h.firstScreen.answered).toHaveBeenCalledTimes(1);
  });

  it('asks for the space’s suggestions after its first page, not beside it', async () => {
    /*
      The suggestions only re-mark rows already drawn, and asking for them reads the space's whole
      schema — the largest answers at boot — on the same executor the first page is waiting on.
    */
    const read = heldRead();
    const h = harness([{ id: 'kept-later', kind: 'create' }], {}, read.find);
    h.store.watchFeed();
    await Promise.resolve();
    expect(h.interpretation.proposals).not.toHaveBeenCalled();

    read.land();
    await vi.waitFor(() => expect(h.interpretation.proposals).toHaveBeenCalledTimes(1));
  });

  /*
    A call's Feed is the first screen only when a cold boot opens straight onto the call's page: then
    it is what the reader opened the app to read, and the host is still holding the rest for it. Drawn
    any later, the first screen is already up, and it says nothing either way — `answered` from a Feed
    that was never waited on would open a gate somebody else still holds.
  */
  it('holds the first screen for a call page a cold boot opened onto, until its page lands', async () => {
    const read = heldRead();
    const h = harness([], {}, read.find);
    h.firstScreen.held = () => true;
    h.store.watchCallFeed('call-9');
    await Promise.resolve();
    expect(h.firstScreen.waiting).toHaveBeenCalledTimes(1);
    expect(h.firstScreen.answered).not.toHaveBeenCalled();

    read.land();
    await vi.waitFor(() => expect(h.firstScreen.answered).toHaveBeenCalledTimes(1));
  });

  it('never says anything to the first screen from a call Feed drawn after it is up', async () => {
    const read = heldRead();
    const h = harness([], {}, read.find);
    h.firstScreen.held = () => false;
    h.store.watchCallFeed('call-9');
    await Promise.resolve();
    read.land();
    await vi.waitFor(() => expect(h.store.callFeedLoaded()).toBe(true));
    h.store.unwatchCallFeed('call-9');
    h.dispose();
    expect(h.firstScreen.waiting).not.toHaveBeenCalled();
    expect(h.firstScreen.answered).not.toHaveBeenCalled();
  });

  it('never says anything from a call Feed on a host that cannot say whether it is still held', async () => {
    const read = heldRead();
    const h = harness([], {}, read.find);
    h.store.watchCallFeed('call-9');
    await Promise.resolve();
    read.land();
    await vi.waitFor(() => expect(h.store.callFeedLoaded()).toBe(true));
    expect(h.firstScreen.waiting).not.toHaveBeenCalled();
    expect(h.firstScreen.answered).not.toHaveBeenCalled();
  });
});

describe('the Feed of one call', () => {
  /*
    The same window, pointed at one call's collection: every line said and typed in it, a box that
    writes into it, and nothing of the space's own window disturbed. The host hands the call in as
    the part is drawn (`whileShown` with the placement's subject) and takes it back as it goes.
  */
  const CALL_LINES = {
    'call-9': [
      { id: 'said', text: 'hello', source: 'spoken', author: 'did:ann', createdAt: 1 },
      { id: 'typed', text: 'link?', source: 'typed', author: 'did:ben', createdAt: 2 },
      { id: 'bot', text: 'here it is', author: 'did:bot', createdAt: 3 },
    ],
  };

  it('reads the call it is drawn for, and leaves the space’s window alone', async () => {
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    await vi.runAllTimersAsync();

    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();

    expect(h.store.callFeedRoot()).toBe('call-9');
    expect(h.finds).toContainEqual({ entity: 'TextBlock', within: 'call-9' });
    expect(h.finds.some((f) => f.within === 'root-1')).toBe(false);
    expect((h.store.callFeedRows() as { id: string }[]).map((r) => r.id).sort()).toEqual(['bot', 'said', 'typed']);
    expect(h.store.callFeedLoaded()).toBe(true);
    expect(h.store.feedRows()).toEqual([]);
    // Its bots are known the same way the space's are.
    expect(h.store.botAuthors()).toEqual(['did:bot']);
    vi.useRealTimers();
  });

  it('writes a typed line into the call, the record the transcript writes, and nothing else', async () => {
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();

    await h.store.sendToCallFeed('running late', '');

    expect(h.created).toEqual([
      {
        entity: 'TextBlock',
        fields: { text: 'running late', source: 'typed' },
        options: { parent: { id: 'call-9', relation: 'children', entity: 'CollectionBlock' } },
      },
    ]);
    // Writing into a call is not being in it: nobody is put on its roster from here.
    expect(h.linked).toEqual([]);
    vi.useRealTimers();
  });

  it('writes nothing while no call is drawn', async () => {
    const h = harness();
    await h.store.sendToCallFeed('to nowhere');
    expect(h.created).toEqual([]);
  });

  it('lets the call go when its last drawing is taken down', async () => {
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();
    expect([...h.live].some((s) => s.within === 'call-9')).toBe(true);

    h.store.unwatchCallFeed('call-9');
    await vi.runAllTimersAsync();

    expect(h.store.callFeedRoot()).toBe('');
    expect([...h.live].some((s) => s.within === 'call-9')).toBe(false);
    vi.useRealTimers();
  });

  it('follows the call a drawing is pointed at next, and back', async () => {
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    h.store.watchCallFeed('call-9');
    h.store.watchCallFeed('call-10');
    expect(h.store.callFeedRoot()).toBe('call-10');
    h.store.unwatchCallFeed('call-10');
    expect(h.store.callFeedRoot()).toBe('call-9');
    vi.useRealTimers();
  });

  it('keeps a reply to the composer it was started under', () => {
    // The Feed panel and a call's page can both be on screen: a reply started in one is not the other's.
    const h = harness();
    h.store.startReply({ id: 'line-1', text: 'who?', author: 'did:ann', surface: 'callFeed' });
    expect(h.store.replyingTo()).toMatchObject({ id: 'line-1', surface: 'callFeed' });
    h.store.startReply({ id: 'line-2', text: 'what?', author: 'did:ann', surface: 'feed' });
    expect(h.store.replyingTo()).toMatchObject({ id: 'line-2', surface: 'feed' });
  });

  it('puts a reply in a call’s Feed down when the call drawn changes', () => {
    const h = harness();
    h.store.watchCallFeed('call-9');
    h.store.startReply({ id: 'line-1', text: 'who?', author: 'did:ann', surface: 'callFeed' });
    h.store.watchCallFeed('call-10');
    expect(h.store.replyingTo()).toBeNull();
  });
});
