/**
 * A lookup of one signal per key, under each reactivity port: a reader wakes for its own key and for
 * no other, an absent key's reader wakes when it lands, and a write of what a key already holds
 * wakes nobody.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createKeyedSignals } from '../src/shared/keyedSignals';

const ports: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

describe.each(ports)('keyed signals, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  const disposers: (() => void)[] = [];

  /** How many times an effect reading `read` has run. */
  function runsOf(read: () => unknown): () => number {
    let runs = 0;
    disposers.push(
      port.root(() =>
        port.effect(() => {
          read();
          runs += 1;
        }),
      ),
    );
    return () => runs;
  }

  beforeEach(() => {
    port = makePort();
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('wakes the readers of the key that changed, and nobody else', () => {
    const index = createKeyedSignals<string, { name: string }>(port);
    index.replace([
      ['alice', { name: 'Alice' }],
      ['bob', { name: 'Bob' }],
    ]);
    const alice = runsOf(() => index.get('alice'));
    const bob = runsOf(() => index.get('bob'));
    const [aliceBefore, bobBefore] = [alice(), bob()];

    port.batch(() =>
      index.replace([
        ['alice', index.get('alice')!],
        ['bob', { name: 'Robert' }],
      ]),
    );

    expect(alice()).toBe(aliceBefore);
    expect(bob()).toBe(bobBefore + 1);
    expect(index.get('bob')).toEqual({ name: 'Robert' });
  });

  it('wakes a reader that asked before its key had a value, when the value lands', () => {
    const index = createKeyedSignals<string, string>(port);
    let seen: string | undefined = 'unread';
    disposers.push(port.root(() => port.effect(() => void (seen = index.get('carol')))));
    expect(seen).toBeUndefined();

    index.set('carol', 'Carol');
    expect(seen).toBe('Carol');
  });

  it('writes nothing when the value is the same by the comparison it was given', () => {
    const index = createKeyedSignals<string, { name: string }>(port, (a, b) => a?.name === b?.name);
    index.set('alice', { name: 'Alice' });
    const alice = runsOf(() => index.get('alice'));
    const before = alice();

    // A new object saying the same thing, as a rebuilt list hands out.
    index.set('alice', { name: 'Alice' });
    expect(alice()).toBe(before);
  });

  it('clears a key that replace leaves out', () => {
    const index = createKeyedSignals<string, string>(port);
    index.replace([['alice', 'Alice']]);
    const alice = runsOf(() => index.get('alice'));
    const before = alice();

    index.replace([]);
    expect(index.get('alice')).toBeUndefined();
    expect(alice()).toBe(before + 1);
  });
});
