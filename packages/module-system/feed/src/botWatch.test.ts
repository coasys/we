/**
 * A bot's message raised as a notice — unit tests.
 *
 * - What was already in the space raises nothing; a bot's new line raises one notice, with Open
 * - A burst from one bot is one notice ("Sent 3 messages"), from the bot, with its robot
 * - Nothing for your own lines, a person's, or while the reader is on the Feed's newest line, or with
 *   the setting off
 * - An author whose profile has not arrived is asked for, and judged when the burst ends
 */
import type { ModuleIdentity } from '@we/module-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_BURST_MS, BOT_NOTICE_MS, botNotice, watchBotMessages } from './botWatch';

type Row = Record<string, unknown>;

function harness(options: { reading?: boolean; enabled?: boolean; spokenHidden?: boolean } = {}) {
  let push: (rows: Row[]) => void = () => {};
  const people = new Map<string, ModuleIdentity>([
    ['did:data', { name: 'Data', avatar: 'data.png', kind: 'bot' }],
    ['did:ann', { name: 'Ann' }],
  ]);
  const fetched: string[] = [];
  const notices: {
    tone: string;
    message: string;
    options?: { action?: { label: string; run: () => void }; from?: unknown; icon?: string };
  }[] = [];
  const open = vi.fn();
  watchBotMessages({
    effect: (fn) => fn(),
    onDispose: () => {},
    space: () => 'root-1',
    records: {
      subscribe: (_entity: string, _query: unknown, cb: (rows: Row[]) => void) => {
        push = cb;
        return () => {};
      },
    } as never,
    identities: { get: (id) => people.get(id), fetch: (id) => void fetched.push(id) },
    selfId: () => 'did:me',
    notify: (tone, message, opts) => void notices.push({ tone, message, options: opts }),
    enabled: () => options.enabled ?? true,
    readingLive: () => options.reading ?? false,
    spokenHidden: () => options.spokenHidden ?? false,
    open,
  });
  let n = 0;
  const line = (author: string, text: string, source = ''): Row => ({ id: `line-${++n}`, author, text, source });
  return { push, people, fetched, notices, open, line };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a bot answering in the space', () => {
  it('raises one notice for a new line, never for what was already there, with Open', () => {
    const h = harness();
    const before = h.line('did:data', 'an old answer');
    h.push([before]);
    vi.advanceTimersByTime(BOT_BURST_MS);
    expect(h.notices).toEqual([]);

    h.push([h.line('did:data', 'Here is the summary of the call.\nIt went well.'), before]);
    expect(h.notices).toEqual([]);
    vi.advanceTimersByTime(BOT_BURST_MS);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toMatchObject({ tone: 'info', message: 'Here is the summary of the call.' });
    expect(h.notices[0].options).toMatchObject({
      duration: BOT_NOTICE_MS,
      action: { label: 'Open' },
      icon: 'robot',
      from: { name: 'Data', avatar: 'data.png', id: 'did:data' },
    });
    h.notices[0].options!.action!.run();
    expect(h.open).toHaveBeenCalled();
  });

  it('gathers a burst from one bot into one notice', () => {
    const h = harness();
    h.push([]);
    h.push([h.line('did:data', 'one')]);
    h.push([h.line('did:data', 'two'), h.line('did:data', 'three')]);
    vi.advanceTimersByTime(BOT_BURST_MS);
    expect(h.notices.map((n) => n.message)).toEqual(['Sent 3 messages']);
    expect(h.notices[0].options?.from).toMatchObject({ name: 'Data' });
  });

  it('says nothing for your own lines, a person’s, a reader on the newest line, or the setting off', () => {
    const own = harness();
    own.push([]);
    own.push([own.line('did:me', 'mine'), own.line('did:ann', 'hers')]);
    vi.advanceTimersByTime(BOT_BURST_MS);
    expect(own.notices).toEqual([]);

    for (const options of [{ reading: true }, { enabled: false }]) {
      const h = harness(options);
      h.push([]);
      h.push([h.line('did:data', 'an answer')]);
      vi.advanceTimersByTime(BOT_BURST_MS);
      expect(h.notices, JSON.stringify(options)).toEqual([]);
    }
  });

  it('does not count a spoken line a hidden transcript already kept from the reader', () => {
    const h = harness({ spokenHidden: true });
    h.push([]);
    h.push([h.line('did:data', 'said in the call', 'spoken')]);
    vi.advanceTimersByTime(BOT_BURST_MS);
    expect(h.notices).toEqual([]);

    // A bot's typed line in the same space still raises it — only what is hidden is discounted.
    h.push([h.line('did:data', 'typed answer', 'typed'), h.line('did:data', 'more words', 'spoken')]);
    vi.advanceTimersByTime(BOT_BURST_MS);
    expect(h.notices.map((n) => n.message)).toEqual(['typed answer']);
  });

  it('weighs a spoken line once transcripts are shown', () => {
    const h = harness();
    h.push([]);
    h.push([h.line('did:data', 'said in the call', 'spoken')]);
    vi.advanceTimersByTime(BOT_BURST_MS);
    expect(h.notices.map((n) => n.message)).toEqual(['said in the call']);
  });

  it('asks for a profile it does not have, and judges the line when the burst ends', () => {
    const h = harness();
    h.push([]);
    h.push([h.line('did:hermes', 'on it')]);
    expect(h.fetched).toEqual(['did:hermes']);
    h.people.set('did:hermes', { name: 'Hermes', kind: 'bot' });
    vi.advanceTimersByTime(BOT_BURST_MS);
    expect(h.notices.map((n) => n.message)).toEqual(['on it']);
    expect(h.notices[0].options?.from).toEqual({ name: 'Hermes', id: 'did:hermes' });
  });
});

describe('botNotice', () => {
  it('quotes the first line, cut short', () => {
    expect(botNotice(['x'.repeat(200)])).toHaveLength(90);
    expect(botNotice(['First line\nsecond'])).toBe('First line');
  });
});
