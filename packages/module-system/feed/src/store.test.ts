/**
 * The Feed module's own store: messages written from it, and staying live while it is drawn.
 */
import { markAction, markState } from '@we/module-shared';
import { ATTACH_MAX_BYTES } from '@we/schema-kit';
import { describe, expect, it, vi } from 'vitest';

import { BOT_BURST_MS } from './botWatch';
import { FEED_FIRST_PAGE, FEED_PAGE } from './feed';
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

/** Where the harness has the reader at the start, as a write names it. */
const SPACE_1 = { dataset: 'space-1' };

function harness(
  proposals: { id: string; kind: string }[] = [],
  moduleSettings: Record<string, unknown> = {},
  /** How a read is answered — or, more simply, the lines each collection holds, by its id. */
  reads:
    | ((entity: string, query: Record<string, unknown>) => Promise<Record<string, unknown>[]>)
    | Record<string, Record<string, unknown>[]> = async () => [],
  spaceRoot: () => string = () => 'root-1',
  /** The kinds of record extraction writes in this space. */
  targets: string[] = [],
  /** The host's `showPart` — absent, as on a host that has none. */
  showPart?: (part: string) => boolean,
) {
  const held = typeof reads === 'function' ? null : reads;
  const find =
    typeof reads === 'function'
      ? reads
      : async (entity: string, query: Record<string, unknown>) =>
          entity === 'TextBlock' ? (held?.[String(query.within ?? '')] ?? []) : [];
  const { signal, effect } = reactive();
  // The space's collection as the host resolves it — late, sometimes. `setSpaceRoot` moves it.
  const [resolvedRoot, setSpaceRoot] = signal<string | null>(null);
  /** What each subscription is told, by the order it was opened in — a test answers through these. */
  const answer: ((rows: Record<string, unknown>[]) => void)[] = [];
  const notices: { message: string; options?: unknown }[] = [];
  const created: Created[] = [];
  /** While set, a write waits for it — and fails when it rejects: the executor's round trips, as the test paces them. */
  let creating: Promise<void> | null = null;
  const holdCreates = () => {
    let settle: { release: () => void; fail: (error: Error) => void } | undefined;
    creating = new Promise<void>((resolve, reject) => {
      settle = { release: resolve, fail: reject };
    });
    creating.catch(() => {});
    return settle!;
  };
  const updated: { entity: string; id: string; fields: Record<string, unknown> }[] = [];
  const subscriptions: string[] = [];
  const subscribed: { entity: string; query: Record<string, unknown> }[] = [];
  /** Subscriptions still up, by what they are within. */
  const live = new Set<{ entity: string; within?: string }>();
  const finds: { entity: string; within?: string }[] = [];
  const linked: unknown[] = [];
  const removed: { entity: string; id: string; target?: unknown }[] = [];
  /** The dataset the reader has on screen — `datasetUri` answers it, and a test moves it. */
  const screen: { uri: string | null; id: string | null } = { uri: 'space-1', id: 'local-1' };
  /** Names of the records whose removal, or whose link, the executor refuses. */
  const unremovable = new Set<string>();
  const failLinks = { on: false };
  /** Names of the records whose write fails, as an upload the executor refuses does. */
  const refusing = new Set<string>();
  /** Entities whose write is answered with no id, as a host with nowhere to write answers. */
  const returnsNothing = new Set<string>();
  const identities = new Map<string, { kind: string }>([['did:bot', { kind: 'bot' }]]);
  const records = {
    find: async (entity: string, query: Record<string, unknown> = {}) => {
      finds.push({ entity, within: query.within as string | undefined });
      return find(entity, query);
    },
    subscribe: (
      entity: string,
      query: Record<string, unknown> = {},
      cb: (rows: Record<string, unknown>[]) => void = () => {},
    ) => {
      subscriptions.push(entity);
      subscribed.push({ entity, query });
      answer.push(cb);
      const sub = { entity, within: query.within as string | undefined };
      live.add(sub);
      return () => live.delete(sub);
    },
    link: async (...args: unknown[]) => {
      if (failLinks.on) throw new Error('the link was refused');
      linked.push(args);
    },
    create: async (entity: string, fields: Record<string, unknown>, options: unknown) => {
      if (refusing.has(String(fields.name))) throw new Error(`the executor refused ${fields.name}`);
      if (refusing.has(entity)) throw new Error(`the executor refused a ${entity}`);
      created.push({ entity, fields, options });
      const id = `new-${created.length}`;
      await creating;
      if (returnsNothing.has(entity)) return null;
      return id;
    },
    remove: async (entity: string, id: string, target?: unknown) => {
      if (unremovable.has(entity)) throw new Error(`could not remove ${entity}`);
      removed.push({ entity, id, target });
    },
    update: async (entity: string, id: string, fields: Record<string, unknown>) => {
      updated.push({ entity, id, fields });
    },
  };
  const interpretation = {
    targets: () => targets.map((entity) => ({ entity })),
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
    datasetUri: () => screen.uri,
    datasetId: () => screen.id,
    spaceRoot: () => resolvedRoot() ?? spaceRoot(),
    settings: () => moduleSettings,
    identities: { get: (id: string) => identities.get(id), fetch: () => {} },
    selfId: () => 'did:me',
    notify: (_tone: string, message: string, options?: unknown) => void notices.push({ message, options }),
    kernels: { records, interpretation },
    firstScreen,
    ...(showPart && { showPart }),
  } as never) as Record<string, (...args: unknown[]) => unknown>;
  return {
    store,
    setSpaceRoot,
    answer,
    notices,
    created,
    removed,
    refusing,
    returnsNothing,
    screen,
    unremovable,
    failLinks,
    holdCreates,
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
  it('writes a message into the space collection, as a composition that holds its words', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    await h.store.sendToFeed('see you all on Friday', '[{"start":0,"end":3,"type":"strong"}]');
    expect(h.created).toEqual([
      {
        entity: 'CollectionBlock',
        fields: { kind: 'message', mode: 'document', textContent: 'see you all on Friday', source: 'typed' },
        options: { parent: { id: 'root-1', relation: 'children', entity: 'CollectionBlock' }, dataset: 'space-1' },
      },
      {
        entity: 'TextBlock',
        fields: { text: 'see you all on Friday', source: 'typed', marks: '[{"start":0,"end":3,"type":"strong"}]' },
        options: { parent: { id: 'new-1', relation: 'children', entity: 'CollectionBlock' }, dataset: 'space-1' },
      },
    ]);
    // No files, so no group: the message holds one child.
    expect(h.linked).toEqual([]);
    expect(h.removed).toEqual([]);
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
      entity: 'CollectionBlock',
      fields: { kind: 'reply', textContent: 'I do', source: 'typed' },
      options: { parent: { id: 'line-1', relation: 'responses' } },
    });
    expect(h.created[1]).toMatchObject({
      entity: 'TextBlock',
      fields: { text: 'I do', source: 'typed' },
      options: { parent: { id: 'new-1', relation: 'children', entity: 'CollectionBlock' } },
    });
    expect(h.store.replyingTo()).toBeNull();
  });

  it('draws a reply under the line it answers at once, and puts the reply down as it is drawn', async () => {
    const h = harness();
    h.store.startReply({ id: 'line-1', text: 'who has the venue?', author: 'did:ann' });
    const writing = h.holdCreates();
    const sending = h.store.reply('line-1', 'I do');
    expect(h.store.feedRows()).toMatchObject([
      {
        kind: 'line',
        text: 'I do',
        sending: true,
        author: 'did:me',
        replyTo: { id: 'line-1', author: 'did:ann', text: 'who has the venue?' },
      },
    ]);
    // Down already, so a second message typed now is not sent as a reply too.
    expect(h.store.replyingTo()).toBeNull();
    writing.release();
    await sending;
  });

  it('draws a reply started in a call’s Feed in that Feed', async () => {
    const h = harness();
    h.store.watchCallFeed('call-9');
    h.store.startReply({ id: 'line-1', text: 'who?', author: 'did:ann', surface: 'callFeed' });
    h.holdCreates();
    void h.store.reply('line-1', 'I do');
    expect(h.store.callFeedRows()).toMatchObject([{ text: 'I do', sending: true, replyTo: { id: 'line-1' } }]);
    expect(h.store.feedRows()).toEqual([]);
  });

  it('draws a message sent to a call at once, and takes it down when the write fails', async () => {
    const h = harness();
    h.store.watchCallFeed('call-9');
    const writing = h.holdCreates();
    const sending = h.store.sendToCallFeed('hello call');
    expect(h.store.callFeedRows()).toMatchObject([{ text: 'hello call', sending: true, author: 'did:me' }]);
    writing.fail(new Error('executor unreachable'));
    await expect(sending).rejects.toThrow('executor unreachable');
    expect(h.store.callFeedRows()).toEqual([]);
  });

  it('keeps a reply started while an earlier one was still sending', async () => {
    const h = harness();
    h.store.startReply({ id: 'line-1', text: 'who?', author: 'did:ann', surface: 'callFeed' });
    const sending = h.store.reply('line-1', 'I do');
    h.store.startReply({ id: 'line-2', text: 'what?', author: 'did:ann', surface: 'feed' });
    await sending;
    expect(h.store.replyingTo()).toMatchObject({ id: 'line-2', surface: 'feed' });
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

  it('corrects a message composition in the text block it holds and in its own words', async () => {
    const h = harness([], {}, async (entity, query) => {
      const where = (query.where ?? {}) as Record<string, unknown>;
      if (entity === 'CollectionBlock' && where.id === 'msg-1') return [{ id: 'msg-1', kind: 'message' }];
      if (entity === 'TextBlock' && query.within === 'msg-1') return [{ id: 'words-1', text: 'lunch at 1' }];
      return [];
    });
    await h.store.editUtterance('msg-1', 'lunch at one', 'typed');
    expect(h.updated).toEqual([
      { entity: 'TextBlock', id: 'words-1', fields: { text: 'lunch at one' } },
      { entity: 'CollectionBlock', id: 'msg-1', fields: { textContent: 'lunch at one' } },
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
    // The bot watch's, then the window's: the newest line, the newest message composition, the newest call.
    expect(h.subscriptions).toEqual(['TextBlock', 'TextBlock', 'CollectionBlock', 'CollectionBlock']);
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
    const call = h.subscribed.find(
      (s) => s.entity === 'CollectionBlock' && (s.query.where as { kind?: unknown } | undefined)?.kind === 'call',
    );
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

  it('keeps a call’s lines when a second drawing of it comes and goes', async () => {
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();
    const lines = () => (h.store.callFeedRows() as { id: string }[]).map((r) => r.id).sort();
    expect(lines()).toEqual(['bot', 'said', 'typed']);

    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();
    expect(lines()).toEqual(['bot', 'said', 'typed']);
    expect(h.store.callFeedLoaded()).toBe(true);

    h.store.unwatchCallFeed('call-9');
    await vi.runAllTimersAsync();
    expect(lines()).toEqual(['bot', 'said', 'typed']);
    vi.useRealTimers();
  });

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

  it('writes a typed message into the call, as a composition, and nothing else', async () => {
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();

    await h.store.sendToCallFeed('running late', '');

    expect(h.created).toEqual([
      {
        entity: 'CollectionBlock',
        fields: { kind: 'message', mode: 'document', textContent: 'running late', source: 'typed' },
        options: { parent: { id: 'call-9', relation: 'children', entity: 'CollectionBlock' }, dataset: 'space-1' },
      },
      {
        entity: 'TextBlock',
        fields: { text: 'running late', source: 'typed' },
        options: { parent: { id: 'new-1', relation: 'children', entity: 'CollectionBlock' }, dataset: 'space-1' },
      },
    ]);
    // Writing into a call is not being in it: nobody is put on its roster from here.
    expect(h.linked).toEqual([]);
    vi.useRealTimers();
  });

  it('writes each file as a FileBlock in a group the message holds after its words, files first', async () => {
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();
    const plan = new File(['%PDF'], 'plan.pdf', { type: 'application/pdf' });
    const map = new File(['png!'], 'map.png', { type: 'image/png' });

    await h.store.sendToCallFeed('plan and map', '', [plan, map]);

    // The bytes go first, the step that can fail; the message is written only once they are stored.
    expect(h.created.map((c) => [c.entity, c.fields.kind ?? ''])).toEqual([
      ['FileBlock', ''],
      ['FileBlock', ''],
      ['CollectionBlock', 'attachments'],
      ['CollectionBlock', 'message'],
      ['TextBlock', ''],
    ]);
    expect(h.created[0]).toEqual({
      entity: 'FileBlock',
      fields: {
        name: 'plan.pdf',
        mimeType: 'application/pdf',
        size: 4,
        url: { data_base64: btoa('%PDF'), name: 'plan.pdf', file_type: 'application/pdf' },
      },
      options: SPACE_1,
    });
    // The group and the files are written unparented; only the message goes into the call.
    expect(h.created[2]).toEqual({
      entity: 'CollectionBlock',
      fields: { kind: 'attachments', mode: 'document' },
      options: SPACE_1,
    });
    expect(h.created[3].options).toEqual({
      parent: { id: 'call-9', relation: 'children', entity: 'CollectionBlock' },
      dataset: 'space-1',
    });
    expect(h.created[4].options).toEqual({
      parent: { id: 'new-4', relation: 'children', entity: 'CollectionBlock' },
      dataset: 'space-1',
    });
    // All containment: the files into the group, and the group into the message, after its words.
    expect(h.linked).toEqual([
      ['CollectionBlock', 'new-3', 'children', 'new-1', SPACE_1],
      ['CollectionBlock', 'new-3', 'children', 'new-2', SPACE_1],
      ['CollectionBlock', 'new-4', 'children', 'new-3', SPACE_1],
    ]);
    expect(h.removed).toEqual([]);
    vi.useRealTimers();
  });

  it('writes the files of a message sent to the space, and of a reply, the same way', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const note = new File(['hi'], 'note.txt', { type: 'text/plain' });

    await h.store.sendToFeed('see attached', undefined, [note]);
    expect(h.created.map((c) => c.entity)).toEqual(['FileBlock', 'CollectionBlock', 'CollectionBlock', 'TextBlock']);

    h.store.startReply({ id: 'line-1', text: 'who has the venue?', author: 'did:ann' });
    await h.store.reply('line-1', 'here', undefined, [note]);
    expect(h.created.slice(4).map((c) => [c.entity, c.fields.kind ?? ''])).toEqual([
      ['FileBlock', ''],
      ['CollectionBlock', 'attachments'],
      ['CollectionBlock', 'reply'],
      ['TextBlock', ''],
    ]);
    expect(h.created[6].options).toEqual({ parent: { id: 'line-1', relation: 'responses' }, dataset: 'space-1' });
    expect(h.linked).toEqual([
      ['CollectionBlock', 'new-2', 'children', 'new-1', SPACE_1],
      ['CollectionBlock', 'new-3', 'children', 'new-2', SPACE_1],
      ['CollectionBlock', 'new-6', 'children', 'new-5', SPACE_1],
      ['CollectionBlock', 'new-7', 'children', 'new-6', SPACE_1],
    ]);
    vi.useRealTimers();
  });

  it('writes no message when an attached file fails, and takes the files already written down', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const first = new File(['one'], 'one.txt', { type: 'text/plain' });
    const second = new File(['two'], 'two.txt', { type: 'text/plain' });
    // The first upload lands; the second is refused.
    h.refusing.add('two.txt');

    await expect(h.store.sendToFeed('with files', undefined, [first, second])).rejects.toThrow('refused');

    expect(h.created.map((c) => c.entity)).toEqual(['FileBlock']);
    expect(h.removed).toEqual([{ entity: 'FileBlock', id: 'new-1', target: SPACE_1 }]);
    expect(h.linked).toEqual([]);
    vi.useRealTimers();
  });

  it('leaves nothing stored when the words cannot be written', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const note = new File(['hi'], 'note.txt', { type: 'text/plain' });

    // Refused: the write throws. Newest first: the message, its group, the file.
    h.refusing.add('TextBlock');
    await expect(h.store.sendToFeed('with a file', undefined, [note])).rejects.toThrow('refused');
    expect(h.removed).toEqual([
      { entity: 'CollectionBlock', id: 'new-3', target: SPACE_1 },
      { entity: 'CollectionBlock', id: 'new-2', target: SPACE_1 },
      { entity: 'FileBlock', id: 'new-1', target: SPACE_1 },
    ]);
    // The group holds the file, and is never put in the message.
    expect(h.linked).toEqual([['CollectionBlock', 'new-2', 'children', 'new-1', SPACE_1]]);

    // Answered with no id: nothing was written, all of it is taken down as well, and the send fails.
    h.refusing.clear();
    h.removed.length = 0;
    h.linked.length = 0;
    h.returnsNothing.add('TextBlock');
    await expect(h.store.sendToFeed('with a file', undefined, [note])).rejects.toThrow('could not be sent');
    expect(h.removed).toEqual([
      { entity: 'CollectionBlock', id: 'new-6', target: SPACE_1 },
      { entity: 'CollectionBlock', id: 'new-5', target: SPACE_1 },
      { entity: 'FileBlock', id: 'new-4', target: SPACE_1 },
    ]);
    vi.useRealTimers();
  });

  it('takes the message down when its words cannot be written, with no files sent', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    h.refusing.add('TextBlock');

    await expect(h.store.sendToFeed('just words')).rejects.toThrow('refused');

    expect(h.removed).toEqual([{ entity: 'CollectionBlock', id: 'new-1', target: SPACE_1 }]);
    expect(h.store.feedRows()).toEqual([]);
    vi.useRealTimers();
  });

  it('takes the group and every file down when a link fails', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const note = new File(['hi'], 'note.txt', { type: 'text/plain' });
    h.failLinks.on = true;

    await expect(h.store.sendToFeed('with a file', undefined, [note])).rejects.toThrow('link was refused');

    // Newest first: the group, then the file it would have held. The message was never written.
    expect(h.created.map((c) => c.entity)).toEqual(['FileBlock', 'CollectionBlock']);
    expect(h.removed).toEqual([
      { entity: 'CollectionBlock', id: 'new-2', target: SPACE_1 },
      { entity: 'FileBlock', id: 'new-1', target: SPACE_1 },
    ]);
    vi.useRealTimers();
  });

  it('says so, and keeps going, when a removal is itself refused: the failure that stands is the first', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const note = new File(['hi'], 'note.txt', { type: 'text/plain' });
    h.failLinks.on = true;
    // The group cannot be taken down; the file still is.
    h.unremovable.add('CollectionBlock');

    await expect(h.store.sendToFeed('with a file', undefined, [note])).rejects.toThrow('link was refused');

    expect(h.removed).toEqual([{ entity: 'FileBlock', id: 'new-1', target: SPACE_1 }]);
    vi.useRealTimers();
  });

  it('refuses a file over the size limit before anything is written', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const big = new File(['x'], 'huge.bin');
    Object.defineProperty(big, 'size', { value: ATTACH_MAX_BYTES + 1 });

    await expect(h.store.sendToFeed('too much', undefined, [big])).rejects.toThrow('huge.bin');

    expect(h.created).toEqual([]);
    vi.useRealTimers();
  });

  it('writes and takes down in the space the send began in, whatever the reader moves to meanwhile', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const one = new File(['one'], 'one.txt', { type: 'text/plain' });
    const two = new File(['two'], 'two.txt', { type: 'text/plain' });
    h.refusing.add('two.txt');
    const upload = h.holdCreates();

    const sending = h.store.sendToFeed('with files', undefined, [one, two]);
    (sending as Promise<unknown>).catch(() => {});
    // The reader goes to another space while the first file is still going up.
    h.screen.uri = 'space-2';
    upload.release();
    await expect(sending as Promise<unknown>).rejects.toThrow('refused');

    expect(h.created.map((c) => c.options)).toEqual([SPACE_1]);
    expect(h.removed).toEqual([{ entity: 'FileBlock', id: 'new-1', target: SPACE_1 }]);
    vi.useRealTimers();
  });

  it('pins a personal space by its local id, in every write and removal, whatever the reader moves to', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const one = new File(['one'], 'one.txt', { type: 'text/plain' });
    const two = new File(['two'], 'two.txt', { type: 'text/plain' });
    const local = { dataset: 'local-1' };
    // No shared URI: only the local id names the space.
    h.screen.uri = null;
    h.refusing.add('two.txt');
    const upload = h.holdCreates();

    const sending = h.store.sendToFeed('with files', undefined, [one, two]);
    (sending as Promise<unknown>).catch(() => {});
    h.screen.id = 'local-2';
    upload.release();
    await expect(sending as Promise<unknown>).rejects.toThrow('refused');

    expect(h.created.map((c) => c.options)).toEqual([local]);
    expect(h.removed).toEqual([{ entity: 'FileBlock', id: 'new-1', target: local }]);
    vi.useRealTimers();
  });

  it('refuses to send, writing nothing, when no space is open to name', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    h.screen.uri = null;
    h.screen.id = null;

    await expect(h.store.sendToFeed('hello')).rejects.toThrow('no space open');

    expect(h.created).toEqual([]);
    vi.useRealTimers();
  });

  it('names that space on every create, link and removal of a send that succeeds across a switch', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.runAllTimersAsync();
    const note = new File(['hi'], 'note.txt', { type: 'text/plain' });
    const upload = h.holdCreates();

    const sending = h.store.sendToFeed('with a file', undefined, [note]);
    h.screen.uri = 'space-2';
    upload.release();
    await sending;

    expect(h.created.map((c) => c.options)).toEqual([
      SPACE_1,
      SPACE_1,
      { parent: { id: 'root-1', relation: 'children', entity: 'CollectionBlock' }, dataset: 'space-1' },
      { parent: { id: 'new-3', relation: 'children', entity: 'CollectionBlock' }, dataset: 'space-1' },
    ]);
    expect(h.linked).toEqual([
      ['CollectionBlock', 'new-2', 'children', 'new-1', SPACE_1],
      ['CollectionBlock', 'new-3', 'children', 'new-2', SPACE_1],
    ]);
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

  it('opens the next call at its newest page, however far the last one was read', async () => {
    /*
      The window's size and anchor were the last call's: paged out to 250 from its start, the next
      call opened read 250 of its lines from its own start.
    */
    vi.useFakeTimers();
    const asked: Record<string, unknown>[] = [];
    const h = harness([], {}, async (entity, query) => {
      if (entity === 'TextBlock') asked.push({ within: query.within, limit: query.limit, order: query.order });
      return [];
    });
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();
    h.store.readCallFeedFromStart();
    h.store.showMoreCallFeed();
    h.store.showMoreCallFeed();
    await vi.runAllTimersAsync();
    expect(asked.at(-1)).toEqual({
      within: 'call-9',
      limit: FEED_FIRST_PAGE + 2 * FEED_PAGE,
      order: { createdAt: 'asc' },
    });

    h.store.unwatchCallFeed('call-9');
    h.store.watchCallFeed('call-10');
    await vi.runAllTimersAsync();

    expect(h.store.callFeedFromStart()).toBe(false);
    expect(asked.at(-1)).toEqual({ within: 'call-10', limit: FEED_FIRST_PAGE, order: { createdAt: 'desc' } });
    vi.useRealTimers();
  });

  it('reads what the call found once the space’s collection is known, though its lines came first', async () => {
    /*
      What extraction found is held in the space. A call page opened before the host knew the space's
      collection read its lines and nothing found — and nothing said to read again once it was known.
    */
    vi.useFakeTimers();
    const h = harness(
      [],
      {},
      async (entity, query) => {
        const where = query.where as Record<string, unknown> | undefined;
        if (entity === 'CollectionBlock' && where?.id === 'call-9') return [{ id: 'call-9', extracted: ['task-1'] }];
        if (entity === 'TaskBlock' && query.within === 'root-1')
          return [{ id: 'task-1', title: 'Ship', createdAt: 5, extractedFrom: 'call-9' }];
        if (entity === 'TextBlock' && query.within === 'call-9') return CALL_LINES['call-9'];
        return [];
      },
      () => '',
      ['TaskBlock'],
    );
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();
    expect((h.store.callFeedRows() as { kind: string }[]).map((r) => r.kind)).toEqual(['line', 'line', 'line']);

    h.setSpaceRoot('root-1');
    await vi.runAllTimersAsync();

    const found = (h.store.callFeedRows() as { kind: string; summary?: string }[]).filter((r) => r.kind === 'activity');
    expect(found).toMatchObject([{ summary: '1 task' }]);
    vi.useRealTimers();
  });

  it('raises no notice for a bot answering in the call whose newest line the reader is on', async () => {
    /*
      Somebody on a call's page, at its newest line, sees the bot answer there. Asked only about the
      space's Feed, the watch told them anyway — with an Open that took them away from the call.
    */
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();
    expect(h.store.callFeedLoaded()).toBe(true);
    const watch = h.subscribed.findIndex((s) => s.entity === 'TextBlock' && s.query.limit === 20);
    h.answer[watch]([]);

    h.answer[watch]([{ id: 'bot-2', author: 'did:bot', text: 'here it is again', partOf: 'call-9' }]);
    await vi.advanceTimersByTimeAsync(BOT_BURST_MS);
    expect(h.notices).toEqual([]);

    // In another call, or read from the call's start, it is news.
    h.answer[watch]([{ id: 'bot-3', author: 'did:bot', text: 'elsewhere', partOf: 'call-3' }]);
    await vi.advanceTimersByTimeAsync(BOT_BURST_MS);
    h.store.readCallFeedFromStart();
    await vi.runAllTimersAsync();
    h.answer[watch]([{ id: 'bot-4', author: 'did:bot', text: 'later on', partOf: 'call-9' }]);
    await vi.advanceTimersByTimeAsync(BOT_BURST_MS);
    expect(h.notices.map((n) => n.message)).toEqual(['elsewhere', 'later on']);
    vi.useRealTimers();
  });

  it('listens for new lines within the call, not across the whole space', async () => {
    /*
      A second space-wide newest-line subscription made every line said anywhere in the space a
      re-read of the call's page. The call holds every line said or typed in it; a reply lands in
      the thread of a line on screen, which the subscription over those lines hears.
    */
    vi.useFakeTimers();
    const h = harness([], {}, CALL_LINES);
    h.store.watchCallFeed('call-9');
    await vi.runAllTimersAsync();
    const newest = h.subscribed.filter((s) => s.entity === 'TextBlock' && s.query.limit === 1);
    expect(newest.map((s) => s.query.within)).toEqual(['call-9']);
    vi.useRealTimers();
  });
});

describe('a bot’s notice', () => {
  /** A bot's new line in the space, raised as a notice, and the notice's Open. */
  async function noticeOpen(showPart?: (part: string) => boolean) {
    vi.useFakeTimers();
    const h = harness(
      [],
      {},
      async () => [],
      () => 'root-1',
      [],
      showPart,
    );
    await vi.runAllTimersAsync();
    const watch = h.subscribed.findIndex((s) => s.entity === 'TextBlock' && s.query.limit === 20);
    h.answer[watch]([]);
    h.answer[watch]([{ id: 'bot-1', author: 'did:bot', text: 'the answer', partOf: '' }]);
    await vi.advanceTimersByTimeAsync(BOT_BURST_MS);
    const open = (h.notices[0]?.options as { action?: { label: string; run: () => void } } | undefined)?.action;
    vi.useRealTimers();
    return { h, open };
  }

  it('opens the space’s Feed page where the template has one, not a window over it', async () => {
    /*
      In a Coasys space the Feed is the root channel's page. Open raised the Feed panel as a window
      over the call instead of going to that page, which is where the space's own tree goes.
    */
    const asked: string[] = [];
    const { h, open } = await noticeOpen((part) => {
      asked.push(part);
      return true;
    });
    expect(open?.label).toBe('Open');
    open?.run();
    expect(asked).toEqual(['feed.feedView']);
    expect(h.store.feedOpen()).toBe(false);
    // At its newest line, as the panel was.
    expect(h.store.feedFromStart()).toBe(false);
  });

  it('opens the Feed panel where no page of the space draws the Feed', async () => {
    const { h, open } = await noticeOpen(() => false);
    open?.run();
    expect(h.store.feedOpen()).toBe(true);
  });

  it('opens the Feed panel on a host that cannot say where the Feed is drawn', async () => {
    const { h, open } = await noticeOpen();
    open?.run();
    expect(h.store.feedOpen()).toBe(true);
  });
});
