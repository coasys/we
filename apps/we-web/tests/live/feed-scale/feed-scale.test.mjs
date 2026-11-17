/**
 * The parts of the feed-scale suite that need no executor: the signing, the messages, the shape read
 * off a written message, and the numbers it reports.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { JOB, cpuSeconds, loadPhases, max, median, memory, metrics, summaryLine } from './results.mjs';
import { AUTHORS, SPAN_MS, messageShape, messages, processorIds, random, words } from './seed.mjs';
import { base58, makeAgent } from './signer.mjs';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function unbase58(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(BASE58.indexOf(c));
  const hex = n.toString(16);
  const bytes = Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex');
  const zeros = s.length - s.replace(/^1+/, '').length;
  return Buffer.concat([Buffer.alloc(zeros), bytes]);
}

describe('signer', () => {
  it('writes base58 as multibase z does', () => {
    expect(base58(Buffer.from('hello world'))).toBe('StV1DL6CwTryKyV');
    expect(base58(Uint8Array.of(0, 0, 1))).toBe('112');
  });

  it('signs a link the way the executor checks one', () => {
    const agent = makeAgent();
    const link = agent.link('ad4m://obj/a', 'we://flag', 'we://text_block', Date.UTC(2025, 0, 2, 3, 4, 5, 6));
    expect(link.timestamp).toBe('2025-01-02T03:04:05.006Z');
    expect(link.data).toEqual({ predicate: 'we://flag', source: 'ad4m://obj/a', target: 'we://text_block' });
    expect(link.author).toBe(agent.did);
    expect(link.proof.key).toBe(`${agent.did}#${agent.did.slice('did:key:'.length)}`);

    // The did:key holds the public key: 0xed01 and the 32 raw bytes.
    const multikey = unbase58(agent.did.slice('did:key:z'.length));
    expect([...multikey.subarray(0, 2)]).toEqual([0xed, 0x01]);
    const publicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: multikey.subarray(2).toString('base64url') },
      format: 'jwk',
    });
    // Field order matters: the executor hashes serde's {"predicate","source","target"}.
    const digest = createHash('sha256')
      .update('{"predicate":"we://flag","source":"ad4m://obj/a","target":"we://text_block"}')
      .update('2025-01-02T03:04:05.006Z')
      .digest();
    expect(verify(null, digest, publicKey, Buffer.from(link.proof.signature, 'hex'))).toBe(true);
    expect(verify(null, Buffer.alloc(32), publicKey, Buffer.from(link.proof.signature, 'hex'))).toBe(false);
  });
});

describe('seed', () => {
  const root = 'ad4m://obj/root';
  const id = 'ad4m://obj/message';
  const link = (source, predicate, target) => ({ data: { source, predicate, target } });
  const written = [
    link(id, 'we://flag', 'we://text_block'),
    link(id, 'we://text', 'literal:string:hello'),
    link(id, 'we://style', 'literal:string:normal'),
    link(root, 'ad4m://has_child', id),
    link('ad4m://obj/other', 'we://flag', 'we://text_block'),
  ];

  it('reads the ids of the auto-processors off their config links', () => {
    expect(
      processorIds([
        link('ad4m://autoprocessor/we-call-a', 'ad4m://processor_id', 'literal:string:we-call-ad4m-obj-a'),
        link('ad4m://autoprocessor/x', 'ad4m://processor_id', 'bare-id'),
        link('ad4m://autoprocessor/we-call-a', 'ad4m://processor_id', 'literal:string:we-call-ad4m-obj-a'),
        link('ad4m://autoprocessor/x', 'ad4m://source_scope_query', 'literal:string:SELECT'),
      ]),
    ).toEqual(['bare-id', 'we-call-ad4m-obj-a']);
    expect(processorIds([])).toEqual([]);
  });

  it('reads the shape of a message off the links it made', () => {
    expect(messageShape(written, id, root)).toEqual({
      root,
      properties: [
        { predicate: 'we://text', target: null },
        { predicate: 'we://style', target: 'literal:string:normal' },
      ],
      links: 4,
    });
  });

  it('refuses a message the Feed would not read as one', () => {
    expect(() => messageShape(written.slice(1), id, root)).toThrow(/flag/);
    const untexted = written.filter((l) => l.data.predicate !== 'we://text');
    expect(() => messageShape(untexted, id, root)).toThrow(/we:\/\/text/);
    expect(() => messageShape(written.slice(0, 3), id, root)).toThrow(/collection/);
    expect(() => messageShape([...written, link(id, 'we://style', 'literal:string:x')], id, root)).toThrow(/repeats/);
  });

  it('makes the same messages for the same seed, oldest first, a year long', () => {
    const authors = Array.from({ length: 3 }, (_, i) => ({ did: `did:test:${i}` }));
    const endMs = Date.UTC(2026, 0, 1);
    const a = [...messages({ count: 1_000, endMs, seed: 7, authors })];
    const b = [...messages({ count: 1_000, endMs, seed: 7, authors })];
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    for (let i = 1; i < a.length; i++) expect(a[i].atMs).toBeGreaterThan(a[i - 1].atMs);
    expect(a[0].atMs).toBeGreaterThanOrEqual(endMs - SPAN_MS);
    expect(a.at(-1).atMs).toBeLessThan(endMs);
    expect(a.every((m) => /^ad4m:\/\/obj\/[a-z]{24}$/.test(m.id))).toBe(true);
    expect(new Set(a.map((m) => m.id)).size).toBe(a.length);
    expect(new Set(a.map((m) => m.author.did)).size).toBe(3);
    expect(a[42].text).toMatch(/ #42$/);
  });

  it('writes a sentence of 3 to 30 words, numbered', () => {
    const rand = random(3);
    for (let i = 0; i < 200; i++) {
      const text = words(rand, i);
      const n = text.split(' ').length - 1;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(30);
      expect(text.endsWith(` #${i}`)).toBe(true);
    }
    expect(AUTHORS).toBeGreaterThan(1);
  });
});

describe('results', () => {
  it('takes a median and a max', () => {
    expect(median([])).toBe(null);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(max([1, 9, 3])).toBe(9);
    expect(max([])).toBe(null);
  });

  const full = {
    messages: 1_000_000,
    mode: 'hybrid',
    seed: { seconds: 2_000, links: 12_000_000 },
    newest: [900, 300, 320, 310, 350],
    newestCold: 900,
    older: [400, 410, 390, 420, 500],
    queries: [100, 120, 110],
    otherQueries: [40, 700],
    attempted: 5,
    newestFailures: [],
    olderAttempted: 5,
    olderFailures: [],
    failedFeedCalls: 0,
    cpu: { uiPhase: 42.5, idleAfterSeed: 1.25, idleAfterUi: 180 },
    rss: { afterSeed: 2048, afterUi: 2100, peak: 2300 },
  };

  it('writes each number as a record of the performance history', () => {
    const out = metrics(full);
    const by = Object.fromEntries(out.map((m) => [m.metric, m]));
    expect(Object.keys(by).sort()).toEqual(
      [
        'executor.cpu_seconds.ui_phase',
        'executor.idle_cpu_percent.after_seed',
        'executor.idle_cpu_percent.after_ui',
        'executor.feed_other_queries.max',
        'executor.feed_query.failures',
        'executor.feed_query.max',
        'executor.feed_query.median',
        'executor.rss.after_seed',
        'executor.rss.after_ui',
        'executor.rss.peak',
        'feed.newest_page.cold',
        'feed.newest_page.failures',
        'feed.newest_page.max',
        'feed.newest_page.median',
        'feed.older_page.failures',
        'feed.older_page.max',
        'feed.older_page.median',
        'seed.links',
        'seed.links_per_second',
        'seed.seconds',
      ].sort(),
    );
    expect(by['feed.newest_page.cold']).toEqual({
      metric: 'feed.newest_page.cold',
      value: 900,
      unit: 'ms',
      better: 'lower',
      params: { messages: 1_000_000 },
    });
    expect(by['feed.newest_page.median'].value).toBe(320);
    expect(by['executor.feed_other_queries.max'].value).toBe(700);
    expect(by['seed.links_per_second']).toMatchObject({ value: 6_000, better: 'higher', unit: 'links/s' });
    expect(by['executor.cpu_seconds.ui_phase']).toMatchObject({ value: 42.5, unit: 's', better: 'lower' });
    expect(by['executor.idle_cpu_percent.after_ui']).toMatchObject({ value: 180, unit: '%', better: 'lower' });
    for (const m of out) {
      expect(m.metric).toMatch(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/);
      expect(['lower', 'higher']).toContain(m.better);
      expect(Number.isFinite(m.value)).toBe(true);
    }
    expect(JOB).toBe('feed-scale');
  });

  it('keeps a run seeded another way apart', () => {
    expect(metrics({ ...full, mode: 'executor' })[0].params).toEqual({ messages: 1_000_000, seed_mode: 'executor' });
  });

  it('reports no cold time when the cold load never drew', () => {
    const run = { ...full, newest: [300, 320, 310, 350], newestCold: null, newestFailures: ['timeout'] };
    const by = Object.fromEntries(metrics(run).map((m) => [m.metric, m]));
    expect(by['feed.newest_page.cold']).toBeUndefined();
    // The drawn warm loads still count toward the median and the max.
    expect(by['feed.newest_page.median'].value).toBe(315);
    expect(by['feed.newest_page.max'].value).toBe(350);
    expect(summaryLine(run, 'passed')).toContain('newest(cold/median/max)=-/315/350ms');
  });

  it("reports the cold load's own time when it drew", () => {
    const by = Object.fromEntries(metrics(full).map((m) => [m.metric, m]));
    expect(by['feed.newest_page.cold'].value).toBe(900);
    expect(summaryLine(full, 'passed')).toContain('newest(cold/median/max)=900/');
  });

  it('leaves out what a run that stopped early did not measure', () => {
    const out = metrics({
      messages: 10_000,
      mode: 'hybrid',
      seed: { seconds: 20, links: 120_000 },
      rss: { afterSeed: 900 },
    });
    expect(out.map((m) => m.metric)).toEqual([
      'seed.seconds',
      'seed.links',
      'seed.links_per_second',
      'executor.rss.after_seed',
    ]);
  });

  it('says the whole run in one line', () => {
    expect(summaryLine(full, 'passed')).toBe(
      'feed-scale passed: messages=1000000 seed=2000s/12000000links/hybrid newest(cold/median/max)=900/320/900ms ' +
        'older(median/max)=410/500ms query(median/max)=110/120ms others(max)=700ms ' +
        'cpu(ui/idle-seed/idle-ui)=43s/1%/180% rss(seed/ui/peak)=2048/2100/2300MiB runs=5',
    );
    expect(summaryLine({ messages: 10 }, 'failed')).toBe(
      'feed-scale failed: messages=10 seed=- newest(cold/median/max)=-/-/-ms older(median/max)=-/-ms ' +
        'query(median/max)=-/-ms others(max)=-ms cpu(ui/idle-seed/idle-ui)=-/-/- rss(seed/ui/peak)=-/-/-MiB runs=0',
    );
    expect(
      summaryLine(
        { messages: 10, newest: [], attempted: 5, newestFailures: ['feed-call-refused', 'feed-call-refused'] },
        'passed',
      ),
    ).toContain('runs=0 notdrawn=2:feed-call-refused');
  });

  it('records a run that could not draw as a count, with no page times', () => {
    const out = metrics({
      messages: 1_000_000,
      mode: 'hybrid',
      seed: { seconds: 6_000, links: 12_000_000 },
      attempted: 5,
      newestFailures: [
        'feed-call-refused',
        'feed-call-refused',
        'feed-call-refused',
        'feed-call-refused',
        'feed-call-refused',
      ],
      failedFeedCalls: 5,
    });
    const by = Object.fromEntries(out.map((m) => [m.metric, m]));
    expect(by['feed.newest_page.median']).toBeUndefined();
    expect(by['feed.newest_page.failures']).toMatchObject({ value: 5, unit: 'count', better: 'lower' });
    expect(by['executor.feed_query.failures']).toMatchObject({ value: 5, unit: 'count' });
    expect(by['feed.older_page.failures']).toBeUndefined();
  });

  it('reads CPU seconds off /proc/<pid>/stat, whatever the command is called', () => {
    // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime …
    const stat = '4242 (ad4m exec) S 1 4242 4242 0 -1 4194560 100 0 0 0 1500 250 0 0 20 0 64 0';
    expect(cpuSeconds(stat, 100)).toBe(17.5);
    expect(cpuSeconds('garbage', 100)).toBe(null);
    expect(cpuSeconds(stat, 0)).toBe(null);
  });

  it('splits a load into where its time went', () => {
    const calls = [
      { type: 'perspective.modelQuery', className: 'Space', feed: false, sentAfterMs: 500, ms: 300 },
      { type: 'perspective.modelQuery', className: 'TextBlock', feed: true, sentAfterMs: 900, ms: 400 },
      { type: 'perspective.modelQuery', className: 'TextBlock', feed: true, sentAfterMs: 5000, ms: 900 },
      { type: 'agent.byDid', className: null, feed: false, sentAfterMs: 1400, ms: 100 },
      { type: 'agent.byDid', className: null, feed: false, sentAfterMs: 1400, ms: 2600 },
      // After the draw: not something the newest page waited for.
      { type: 'agent.byDid', className: null, feed: false, sentAfterMs: 4500, ms: 9000 },
      { type: 'perspective.addAutoProcessor', className: null, feed: false, sentAfterMs: 2000, ms: 50 },
    ];
    expect(loadPhases(calls, { newestVisible: 4100, lastAttached: 4050 })).toEqual({
      firstCall: 500,
      spaceAnswered: 800,
      feedAsked: 900,
      feedAnswered: 1300,
      profiles: 2,
      profilesAnswered: 4000,
      watchRegistered: 2050,
      newestVisible: 4100,
      lastAttached: 4050,
    });
    expect(loadPhases([])).toMatchObject({ firstCall: null, feedAsked: null, profiles: 0, newestVisible: null });
  });

  it('reads memory off /proc/<pid>/status', () => {
    expect(memory('Name:\tad4m\nVmHWM:\t 2097152 kB\nVmRSS:\t 1048576 kB\n')).toEqual({ rss: 1024, peak: 2048 });
    expect(memory('')).toEqual({ rss: null, peak: null });
  });
});
