/**
 * The Feed keeps up with what is written in the space while it is open.
 *
 * It re-reads its window when one of its one-row subscriptions says something new may be in it.
 * A reply is the case that was missed: it is linked from the line it answers rather than contained
 * by the space or a call, so subscriptions over what the space and its calls contain never heard of
 * one, and a reply written from the Feed did not appear in it.
 */
import { markAction, markState } from '@we/module-shared';
import { describe, expect, it, vi } from 'vitest';

import { createFeed } from './feedStore';

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

/**
 * Records in a space, with subscriptions that fire the way containment does: a `within` subscription
 * hears only about records contained by that record, and one without hears about any of its entity.
 *
 * Like the host's, a subscription answers once with the rows it starts from, a moment after it is
 * made, and again on each change. `hold()` keeps every read waiting until `release()`, for asking
 * what happens while one is in flight.
 */
function space() {
  const subs: { entity: string; within?: string; ids?: string[]; cb: (rows: unknown[]) => void }[] = [];
  const reads: string[] = [];
  /** Every read, with what it was within — a call's page is a TextBlock read within that call. */
  const finds: { entity: string; within?: string }[] = [];
  /** The lines typed into the space, as a page of them reads back. */
  const lines: Record<string, unknown>[] = [];
  /** The space's calls, and what was said in each. */
  const calls: Record<string, unknown>[] = [];
  const said: Record<string, Record<string, unknown>[]> = {};
  /** What extraction found, by entity. */
  const found: Record<string, Record<string, unknown>[]> = {};
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let failing = false;
  const answer = (entity: string, within?: string) => {
    if (entity === 'CollectionBlock') return within === 'root-1' ? calls.map((call) => ({ ...call })) : [];
    if (entity === 'TextBlock') {
      if (within === 'root-1') return lines.map((line) => ({ ...line }));
      return (within && said[within]?.map((line) => ({ ...line }))) || [];
    }
    return within === 'root-1' ? (found[entity] ?? []).map((row) => ({ ...row })) : [];
  };
  const records = {
    find: async (entity: string, query: { within?: string } = {}) => {
      reads.push(entity);
      finds.push({ entity, within: query.within });
      if (gate) await gate;
      if (entity === 'CollectionBlock' && failing) throw new Error('executor unreachable');
      return answer(entity, query.within);
    },
    subscribe: (
      entity: string,
      query: { within?: string; where?: { id?: string[] } },
      cb: (rows: unknown[]) => void,
    ) => {
      const sub = { entity, within: query.within, ids: query.where?.id, cb };
      subs.push(sub);
      // The first answer: the rows it starts from, which is not a change.
      void Promise.resolve().then(() => {
        if (subs.includes(sub)) cb(answer(entity, query.within));
      });
      return () => {
        if (subs.includes(sub)) subs.splice(subs.indexOf(sub), 1);
      };
    },
  };
  /** A record written into the space, contained by `parent` — or linked from it, which is no containment. */
  const write = (entity: string, containedBy?: string) => {
    for (const sub of [...subs]) {
      if (sub.entity !== entity) continue;
      if (sub.within && sub.within !== containedBy) continue;
      // A subscription to particular records hears nothing about a new one.
      if (sub.ids) continue;
      sub.cb([]);
    }
  };
  /** An edit to a record already written: only a subscription naming it hears of it. */
  const edit = (entity: string, id: string) => {
    for (const sub of [...subs]) if (sub.entity === entity && sub.ids?.includes(id)) sub.cb([]);
  };
  const hold = () => {
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
  };
  const release = () => {
    gate = null;
    open?.();
  };
  /** Every window read fails while set (the call list throws), as with an unreachable executor. */
  const fail = (on: boolean) => {
    failing = on;
  };
  /** One whole read of the window: the call list is asked once per read, and nowhere else. */
  const windowReads = () => finds.filter((f) => f.entity === 'CollectionBlock').length;
  /** The call pages read — the serial part of a read. */
  const callPages = () => finds.filter((f) => f.entity === 'TextBlock' && f.within?.startsWith('call-')).length;
  return {
    records,
    reads,
    finds,
    write,
    edit,
    lines,
    calls,
    said,
    found,
    subs,
    hold,
    release,
    fail,
    windowReads,
    callPages,
  };
}

/** The suggestions kernel: a revision that moves when the set may have, and the set itself. */
function suggestions(signal: ReturnType<typeof reactive>['signal'], staged: string[] = []) {
  const [revision, setRevision] = signal(0);
  let set = staged;
  const asked: number[] = [];
  const kernel = {
    targets: () => [{ entity: 'TaskBlock', selected: true }],
    proposalsRevision: revision,
    proposals: async () => {
      asked.push(revision());
      // Later than the window's first read lands, as the trace has it.
      await new Promise((resolve) => setTimeout(resolve, 500));
      return set.map((id) => ({ kind: 'create', id }));
    },
  };
  return {
    kernel,
    asked,
    /** A pass staged more, or somebody kept or discarded one. */
    move: (next: string[]) => {
      set = next;
      setRevision(revision() + 1);
    },
  };
}

/**
 * A Feed over `s`, given its space collection by the host as the app gives it: `spaceStore.root`, a
 * signal. `setRoot` moves it, as switching space does.
 */
function mount(s: ReturnType<typeof space>, interpretation?: unknown, r = reactive(), initialRoot = 'root-1') {
  const [spaceRoot, setRoot] = r.signal(initialRoot);
  const feed = createFeed({
    signal: r.signal,
    effect: r.effect,
    state: markState,
    action: markAction,
    onDispose: () => {},
    dataset: () => 'space-1',
    spaceRoot,
    records: s.records as never,
    interpretation: interpretation as never,
    write: async () => null,
  });
  const call = (name: keyof typeof feed) => (feed[name] as unknown as () => void)();
  return { feed, setRoot, open: () => call('openFeed'), close: () => call('closeFeed') };
}

/** A space with a call in it and a task extraction found, as a real space looks at load. */
function busySpace() {
  const s = space();
  s.lines.push({ id: 'msg-1', text: 'lunch at 1?', author: 'did:ann', createdAt: 3 });
  for (const n of [1, 2, 3]) {
    s.calls.push({ id: `call-${n}`, title: `Call ${n}`, createdAt: n });
    s.said[`call-${n}`] = [{ id: `line-${n}`, text: `said in ${n}`, author: 'did:bo', createdAt: n + 0.5 }];
  }
  s.found.TaskBlock = [{ id: 'task-1', title: 'Book a room', author: 'did:ann', createdAt: 2.7 }];
  return s;
}

describe('the Feed staying live', () => {
  it('re-reads when somebody replies to a line, though a reply is contained by nothing', async () => {
    vi.useFakeTimers();
    const { signal, effect } = reactive();
    const s = space();
    const feed = createFeed({
      signal,
      effect,
      state: markState,
      action: markAction,
      onDispose: () => {},
      dataset: () => 'space-1',
      spaceRoot: () => 'root-1',
      records: s.records as never,
      interpretation: undefined,
      write: async () => null,
    });

    // The space collection arrives, the panel opens, and the first read settles.
    await vi.runAllTimersAsync();
    (feed.openFeed as unknown as () => void)();
    await vi.runAllTimersAsync();
    const before = s.reads.filter((e) => e === 'TextBlock').length;

    // A reply: a TextBlock linked from the line it answers, contained by neither the space nor a call.
    s.write('TextBlock', undefined);
    await vi.runAllTimersAsync();

    expect(s.reads.filter((e) => e === 'TextBlock').length).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('re-reads when a line it is showing is edited', async () => {
    /*
      Nothing new arrives with an edit, so the subscriptions that say "something new may be here"
      stay quiet. The Feed follows the lines it draws as well, as the transcript does.
    */
    vi.useFakeTimers();
    const { signal, effect } = reactive();
    const s = space();
    s.lines.push({ id: 'msg-1', text: 'lunch at 1?', author: 'did:ann', createdAt: 1 });
    const feed = createFeed({
      signal,
      effect,
      state: markState,
      action: markAction,
      onDispose: () => {},
      dataset: () => 'space-1',
      spaceRoot: () => 'root-1',
      records: s.records as never,
      interpretation: undefined,
      write: async () => null,
    });
    await vi.runAllTimersAsync();
    (feed.openFeed as unknown as () => void)();
    await vi.runAllTimersAsync();
    const before = s.reads.filter((e) => e === 'TextBlock').length;

    s.edit('TextBlock', 'msg-1');
    await vi.runAllTimersAsync();

    expect(s.reads.filter((e) => e === 'TextBlock').length).toBeGreaterThan(before);
    vi.useRealTimers();
  });
});

describe('whether the reader counts as on the newest line', () => {
  it('is false until a read has landed, and again after one fails', async () => {
    /*
      `followingLive` is the word the bot notice is held back on — a reader on the newest line is
      assumed to see the line arrive. A Feed still reading, or one whose last read failed, shows
      nothing, so counting it as read anyway held the notice back from somebody who saw neither it
      nor the line.
    */
    vi.useFakeTimers();
    const s = busySpace();
    const { feed, open, close } = mount(s);
    const live = () => feed.followingLive();

    // Looking, but the first read is still on the wire.
    s.hold();
    open();
    expect(s.windowReads()).toBe(1);
    expect(live()).toBe(false);
    s.release();
    await vi.runAllTimersAsync();
    expect(live()).toBe(true);

    // And a read that failed is not an answer either.
    s.fail(true);
    s.write('TextBlock', 'root-1');
    await vi.runAllTimersAsync();
    expect(live()).toBe(false);

    // Coming back reads again — the failure is owed — but the retry on the wire is not an answer
    // yet: the failed read's `failed` clears as the retry starts, and that alone must not count.
    s.fail(false);
    close();
    await vi.runAllTimersAsync();
    s.hold();
    open();
    expect(live()).toBe(false);
    s.release();
    await vi.runAllTimersAsync();
    expect(live()).toBe(true);

    // A routine re-read under somebody watching does not stop them following.
    s.hold();
    s.write('TextBlock', 'root-1');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(live()).toBe(true);
    s.release();
    await vi.runAllTimersAsync();
    expect(live()).toBe(true);
    vi.useRealTimers();
  });
});

describe('where the Feed starts from', () => {
  it('takes the space collection from the host and reads no Space of its own', async () => {
    /*
      The Feed used to find the collection by reading the Space record with its root included — the
      same read the host had already made for `spaceStore.root`, so opening a space paid for it twice
      and the Feed's copy answered no sooner than the host's.
    */
    vi.useFakeTimers();
    const { signal, effect } = reactive();
    const s = space();
    s.lines.push({ id: 'msg-1', text: 'hello', author: 'did:ann', createdAt: 1 });
    const [root, setRoot] = signal('');
    const feed = createFeed({
      signal,
      effect,
      state: markState,
      action: markAction,
      onDispose: () => {},
      dataset: () => 'space-1',
      spaceRoot: root,
      records: s.records as never,
      interpretation: undefined,
      write: async () => null,
    });
    (feed.openFeed as unknown as () => void)();
    await vi.runAllTimersAsync();
    // Nothing is read until the host knows the collection.
    expect(s.reads).toEqual([]);

    setRoot('root-1');
    await vi.runAllTimersAsync();

    expect((feed.feedRoot as unknown as () => string)()).toBe('root-1');
    expect((feed.feedRows as unknown as () => { id: string }[])().map((row) => row.id)).toEqual(['msg-1']);
    expect(s.reads).not.toContain('Space');
    vi.useRealTimers();
  });

  it('moves its window when the host’s collection changes, and reads nothing for the one it left', async () => {
    /*
      The root a read began with is what decides whether its answer is still wanted, and that root
      is now the host's. Switching it mid-read stops the read for the old collection at its next
      step, and the new one is read in its place.
    */
    vi.useFakeTimers();
    const s = busySpace();
    const { feed, open, setRoot } = mount(s);
    await vi.runAllTimersAsync();
    s.hold();
    open();
    expect(s.windowReads()).toBe(1);
    setRoot('root-2');
    s.release();
    await vi.runAllTimersAsync();

    expect((feed.feedRoot as unknown as () => string)()).toBe('root-2');
    expect(s.windowReads()).toBe(2);
    // The read for root-1 stopped before walking its calls; root-2 has none.
    expect(s.callPages()).toBe(0);
    expect((feed.feedRows as unknown as () => unknown[])()).toEqual([]);
    expect(s.reads).not.toContain('Space');
    vi.useRealTimers();
  });

  it('reads nothing while the host has no collection, and reads once it has one', async () => {
    vi.useFakeTimers();
    const s = busySpace();
    const { open, setRoot } = mount(s, undefined, reactive(), '');
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(0);

    setRoot('root-1');
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(1);
    expect(s.callPages()).toBe(3);
    vi.useRealTimers();
  });
});

/*
  How often the window is read. One read is five queries and a call page each — about 400 KB and
  6.6–7.2 s of executor time on a real space — so a read is spent only on a change: never on a
  subscription telling the Feed what it already has, one at a time, and never for a Feed nobody sees.
*/
describe('the Feed reading only when something changed', () => {
  it('reads once on mount, though every subscription and the suggestions answer after it', async () => {
    vi.useFakeTimers();
    const r = reactive();
    const s = busySpace();
    const staged = suggestions(r.signal, ['task-1']);
    const { feed, open } = mount(s, staged.kernel, r);
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();

    // Three subscriptions answered, the suggestions arrived, and the lines on screen are followed.
    expect(s.subs.length).toBe(3);
    expect(staged.asked.length).toBe(1);
    expect(s.windowReads()).toBe(1);
    // The suggestions mark what is on screen, with no read of their own.
    const rows = (feed.feedRows as unknown as () => { kind: string; suggested?: number }[])();
    expect(rows.find((row) => row.kind === 'activity')?.suggested).toBe(1);
    vi.useRealTimers();
  });

  it('starts the first read at once rather than after a settling delay', async () => {
    vi.useFakeTimers();
    const s = busySpace();
    const { open } = mount(s);
    await vi.runAllTimersAsync();
    open();
    // No time has passed: the read is already asking.
    expect(s.windowReads()).toBe(1);
    vi.useRealTimers();
  });

  it('reads once for a real change', async () => {
    vi.useFakeTimers();
    const s = busySpace();
    const { open } = mount(s);
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();

    s.write('TextBlock', 'root-1');
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(2);
    vi.useRealTimers();
  });

  it('reads one more time, not one per change, for changes heard while a read runs', async () => {
    vi.useFakeTimers();
    const s = busySpace();
    const { open } = mount(s);
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();

    s.hold();
    s.write('TextBlock', 'root-1');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.windowReads()).toBe(2);
    // Two more while that read is waiting on the executor.
    s.write('TextBlock', 'root-1');
    s.write('CollectionBlock', 'root-1');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.windowReads()).toBe(2);
    s.release();
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(3);
    vi.useRealTimers();
  });

  it('stops a read whose window moved before it reached its call pages, and draws the one that replaced it', async () => {
    vi.useFakeTimers();
    const s = busySpace();
    const { feed, open } = mount(s);
    await vi.runAllTimersAsync();
    s.hold();
    open();
    expect(s.windowReads()).toBe(1);
    // The reader jumps to the start while the live end is still being read.
    (feed.readFeedFromStart as unknown as () => void)();
    s.release();
    await vi.runAllTimersAsync();

    expect(s.windowReads()).toBe(2);
    // Only the read that is drawn walked its calls.
    expect(s.callPages()).toBe(3);
    const rows = (feed.feedRows as unknown as () => { id: string }[])();
    expect(rows[0]?.id).toBe('line-1');
    vi.useRealTimers();
  });

  it('stops a read when the Feed is closed under it', async () => {
    vi.useFakeTimers();
    const s = busySpace();
    const { open, close } = mount(s);
    await vi.runAllTimersAsync();
    s.hold();
    open();
    close();
    s.release();
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(1);
    expect(s.callPages()).toBe(0);
    vi.useRealTimers();
  });

  it('shows what it has, with no read, on coming back to a Feed nothing changed under', async () => {
    vi.useFakeTimers();
    const r = reactive();
    const s = busySpace();
    const staged = suggestions(r.signal, ['task-1']);
    const { open, close } = mount(s, staged.kernel, r);
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();
    const subscribed = s.subs.length;

    for (let visit = 0; visit < 2; visit++) {
      close();
      await vi.runAllTimersAsync();
      open();
      await vi.runAllTimersAsync();
    }
    expect(s.windowReads()).toBe(1);
    // The suggestions are kept between visits, and so are the subscriptions.
    expect(staged.asked.length).toBe(1);
    expect(s.subs.length).toBe(subscribed);
    vi.useRealTimers();
  });

  it('reads again on coming back after a read that failed', async () => {
    vi.useFakeTimers();
    const r = reactive();
    const s = busySpace();
    const staged = suggestions(r.signal, ['task-1']);
    const { open, close } = mount(s, staged.kernel, r);
    s.fail(true);
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(1);

    s.fail(false);
    close();
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(2);
    vi.useRealTimers();
  });

  it('does not retry a failing read by itself while it stays open', async () => {
    vi.useFakeTimers();
    const r = reactive();
    const s = busySpace();
    const staged = suggestions(r.signal, ['task-1']);
    const { open } = mount(s, staged.kernel, r);
    s.fail(true);
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.windowReads()).toBe(1);
    vi.useRealTimers();
  });

  it('reads once, at once, on coming back to a Feed that changed while nobody looked', async () => {
    vi.useFakeTimers();
    const r = reactive();
    const s = busySpace();
    const staged = suggestions(r.signal, ['task-1']);
    const { open, close } = mount(s, staged.kernel, r);
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();

    close();
    // A call goes on elsewhere: lines are said, and extraction stages more.
    s.write('TextBlock', 'call-3');
    s.write('TextBlock', 'call-3');
    staged.move(['task-1', 'task-2']);
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(1);

    open();
    expect(s.windowReads()).toBe(2);
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(2);
    expect(staged.asked.length).toBe(2);
    vi.useRealTimers();
  });

  it('reads again when the suggestions move while it is open', async () => {
    // A pass staged new records, or one was discarded: activity rows change, and nothing else hears it.
    vi.useFakeTimers();
    const r = reactive();
    const s = busySpace();
    const staged = suggestions(r.signal, ['task-1']);
    const { open } = mount(s, staged.kernel, r);
    await vi.runAllTimersAsync();
    open();
    await vi.runAllTimersAsync();
    staged.move([]);
    await vi.runAllTimersAsync();
    expect(s.windowReads()).toBe(2);
    vi.useRealTimers();
  });
});
