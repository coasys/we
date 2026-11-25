/**
 * A lookup whose readers depend on one key each: a signal per key, on the reactivity port.
 *
 * The question it answers is "wake only the readers of this key", which a memo over the whole map
 * cannot: the map is one value, so every reader of any key wakes on every change. One signal per key
 * gives each its own dependency on any port, with nothing nested.
 *
 * A key read before it has a value has a signal too, created by the read, so a reader that asked
 * too early wakes when its value lands. A write compares with what the key holds and writes nothing
 * when they are the same, because whether an equal write wakes anyone is not something the port
 * promises.
 */
import type { Accessor, ReactivityPort, Setter } from '@we/reactivity';

export interface KeyedSignals<K, V> {
  /** The value under `key`, or `undefined`. Read in a memo or an effect, it depends on that key alone. */
  get: (key: K) => V | undefined;
  /** Put `value` under `key`; `undefined` clears it. Wakes the key's readers only if it differs. */
  set: (key: K, value: V | undefined) => void;
  /**
   * Make the lookup hold exactly `entries`: each key set, every other key cleared. Wakes only the
   * readers of keys whose value differs. Wrap it in the port's `batch` to make it one update.
   */
  replace: (entries: Iterable<readonly [K, V]>) => void;
}

export function createKeyedSignals<K, V>(
  reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>,
  same: (a: V | undefined, b: V | undefined) => boolean = Object.is,
): KeyedSignals<K, V> {
  const slots = new Map<K, [Accessor<V | undefined>, Setter<V | undefined>]>();
  const slot = (key: K) => {
    let found = slots.get(key);
    if (!found) {
      found = reactivity.signal<V | undefined>(undefined);
      slots.set(key, found);
    }
    return found;
  };
  const set = (key: K, value: V | undefined) => {
    const [read, write] = slot(key);
    if (!same(reactivity.untrack(read), value)) write(value);
  };
  return {
    get: (key) => slot(key)[0](),
    set,
    replace: (entries) => {
      const next = new Map(entries);
      for (const key of [...slots.keys()]) if (!next.has(key)) set(key, undefined);
      for (const [key, value] of next) set(key, value);
    },
  };
}
