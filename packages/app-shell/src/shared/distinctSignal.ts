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
