/**
 * distinctSignal: a write of what the signal holds wakes nothing, under either port — which Solid's
 * signals did by themselves and the port does not promise.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { describe, expect, it } from 'vitest';

import { distinctSignal } from '../src/shared/distinctSignal';

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  it('skips a write of the value it holds, and wakes on a different one', () => {
    const reactivity = makePort();
    const seen: boolean[] = [];
    let set!: (next: boolean) => void;
    const dispose = reactivity.root(() => {
      const [read, write] = distinctSignal(reactivity, false);
      set = write;
      reactivity.effect(() => void seen.push(read()));
    });
    set(false);
    set(true);
    set(true);
    expect(seen).toEqual([false, true]);
    dispose();
  });

  it('compares with the sameness it is given', () => {
    const reactivity = makePort();
    const seen: string[] = [];
    let set!: (next: { id: string; at: number }) => void;
    const dispose = reactivity.root(() => {
      const [read, write] = distinctSignal(reactivity, { id: 'a', at: 1 }, (x, y) => x.id === y.id);
      set = write;
      reactivity.effect(() => void seen.push(`${read().id}@${read().at}`));
    });
    set({ id: 'a', at: 2 });
    set({ id: 'b', at: 3 });
    expect(seen).toEqual(['a@1', 'b@3']);
    dispose();
  });
});
