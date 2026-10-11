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
 */
function space() {
  const subs: { entity: string; within?: string; cb: () => void }[] = [];
  const reads: string[] = [];
  const records = {
    find: async (entity: string) => {
      reads.push(entity);
      return entity === 'Space' ? [{ root: 'root-1' }] : [];
    },
    subscribe: (entity: string, query: { within?: string }, cb: () => void) => {
      const sub = { entity, within: query.within, cb };
      subs.push(sub);
      return () => subs.splice(subs.indexOf(sub), 1);
    },
  };
  /** A record written into the space, contained by `parent` — or linked from it, which is no containment. */
  const write = (entity: string, containedBy?: string) => {
    for (const sub of [...subs]) {
      if (sub.entity !== entity) continue;
      if (sub.within && sub.within !== containedBy) continue;
      sub.cb();
    }
  };
  return { records, reads, write };
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
      records: s.records as never,
      interpretation: undefined,
      unconfirmedIds: () => [],
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
});
