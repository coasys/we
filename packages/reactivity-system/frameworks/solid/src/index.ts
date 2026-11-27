/**
 * The reactivity port, implemented by Solid.
 *
 * In Solid the port is Solid: `signal` is `createSignal`, `root` is `createRoot`, and a store moved
 * onto the port behaves exactly as it did. Two places need more than a re-export:
 *
 * - **The setter takes a value, never an updater.** Solid's setter calls a function it is given and
 *   stores the result, so a store keeping a callback in a signal would have it called instead of
 *   kept. Wrapping the value in a function is how Solid is told to store it as it is.
 * - **`root` hands back its disposer**, rather than passing it into the function, so a store's
 *   factory does not need to know it is running inside a root.
 *
 * Kept out of `@we/reactivity` itself so the contract carries no Solid: a host on another framework
 * installs the contract without this package, and a store that imported it would be Solid-bound,
 * which the neutral-stores check refuses.
 */
import type { Accessor, ReactivityPort, Setter } from '@we/reactivity';
import { batch, createEffect, createMemo, createRoot, createSignal, onCleanup, untrack } from 'solid-js';

export const solidReactivity: ReactivityPort = {
  signal: <T>(initial: T): [Accessor<T>, Setter<T>] => {
    const [read, write] = createSignal<T>(initial);
    return [read, (next: T) => void write(() => next)];
  },
  memo: <T>(fn: () => T): Accessor<T> => createMemo(() => fn()),
  effect: (fn) => createEffect(() => fn()),
  untrack,
  batch,
  root: (fn) =>
    createRoot((dispose) => {
      fn();
      return dispose;
    }),
  onCleanup: (fn) => void onCleanup(fn),
};
