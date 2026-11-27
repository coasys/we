/**
 * distinctSignal: a write of what the signal holds wakes nothing, under either port — which Solid's
 * signals did by themselves and the port does not promise.
 */
import { describe, expect, it } from 'vitest';

import { distinctSignal, updatingSignal } from '../src/shared/distinctSignal';
import { reactivityPorts } from './support/engines';

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

  it('changes from what it holds, untracked, and a change handing it back wakes nothing', () => {
    const reactivity = makePort();
    const seen: string[][] = [];
    let update!: (change: (held: string[]) => string[]) => void;
    let runs = 0;
    let poke!: (n: number) => void;
    const dispose = reactivity.root(() => {
      const [read, , change] = updatingSignal<string[]>(reactivity, []);
      update = change;
      reactivity.effect(() => void seen.push(read()));
      // Updating inside an effect must not make it depend on what it updates.
      const [trigger, setTrigger] = reactivity.signal(0);
      poke = setTrigger;
      reactivity.effect(() => {
        trigger();
        runs++;
        change((held) => (held.includes('x') ? held : [...held, 'x']));
      });
    });
    poke(1);
    update((held) => held);
    update((held) => [...held, 'y']);
    expect(seen).toEqual([[], ['x'], ['x', 'y']]);
    expect(runs).toBe(2);
    dispose();
  });
});
