/**
 * A signal whose write is skipped when it holds that value already.
 *
 * Solid's signals skip an equal write by themselves; the reactivity port does not promise to, so a
 * store that relied on it — a flag cleared on every keystroke, a dataset published again as a new
 * object equal to the one on screen — says so here, once. `same` decides what equal means, and is
 * `Object.is` unless the store knows better.
 */
import type { Accessor, ReactivityPort } from '@we/reactivity';

export function distinctSignal<T>(
  reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>,
  initial: T,
  same: (a: T, b: T) => boolean = Object.is,
): [Accessor<T>, (next: T) => void] {
  const [read, write] = reactivity.signal<T>(initial);
  return [
    read,
    (next) => {
      if (!same(reactivity.untrack(read), next)) write(next);
    },
  ];
}

/**
 * A {@link distinctSignal} that can also be changed from what it holds: `update(change)` hands the
 * held value to `change` and writes what comes back — Solid's updater setter, which the port's setter
 * is not (it stores a function as the value). The held value is read untracked, so an effect updating
 * it does not come to depend on it, and a change that hands back what it was given writes nothing.
 */
export function updatingSignal<T>(
  reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>,
  initial: T,
): [Accessor<T>, (next: T) => void, (change: (held: T) => T) => void] {
  const [read, write] = distinctSignal(reactivity, initial);
  return [read, write, (change) => write(change(reactivity.untrack(read)))];
}
