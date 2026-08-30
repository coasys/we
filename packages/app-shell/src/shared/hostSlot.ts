/**
 * A place one store lends a value to another, with a way back out.
 *
 * ## What this replaces
 *
 * WE's stores form a provider tree, and the dependencies point one way: `DatasetStore` mounts above
 * `ShapeStore`, which mounts above `SpaceStore`. But some answers only exist further down — whether
 * this space auto-interprets its calls lives on a `Space`, which only `SpaceStore` can read — so
 * the lower store hands a closure upward and the upper one keeps it in a `let`:
 *
 * ```ts
 * let autoInterpretGate: (() => boolean) | null = null;
 * const provideAutoInterpretGate = (gate) => { autoInterpretGate = gate; };
 * ```
 *
 * Ten of these had accumulated, and four audits in a row have named them, because the shape has two
 * failures that are invisible until they bite:
 *
 * - **No way out.** Nothing ever clears the slot, so when the provider unmounts the upper store
 *   still holds its closure — reading signals from a scope that has been disposed. It answers with
 *   whatever was true when the provider died, forever, and nothing anywhere reports it.
 * - **Silent last-write-wins.** Two providers filling the same slot is not an error, it is a
 *   coin toss decided by mount order. `provideExtractionCandidates` was called from two stores with
 *   the same accessor, which was harmless *and unnoticeable*; the day the two differ, the one that
 *   loses is simply gone.
 *
 * ## The shape
 *
 * `provide()` returns a disposer, and the disposer clears the slot **only if it is still the one it
 * set**. That last clause is the whole point: a re-provide before the old provider's cleanup runs
 * (which is the ordinary case in Solid, where a replacement mounts before its predecessor disposes)
 * must not have the dying provider blank the live value on its way out.
 *
 * `onCleanup(slot.provide(...))` at the call site is then all a caller has to write, and a caller
 * whose scope genuinely lives as long as the app can ignore the return value.
 *
 * A slot deliberately holds one value. Fan-out — several listeners, all called — is `hostListeners`
 * below, which has the same disposal contract and the same reason for it.
 */

export interface HostSlot<T> {
  /** What was lent, or `null` when nothing has been. Callers decide what absent means. */
  get: () => T | null;
  /** Lend a value. Returns the disposer; call it, or hand it to `onCleanup`. */
  provide: (value: T) => () => void;
}

export function hostSlot<T>(): HostSlot<T> {
  let current: T | null = null;
  return {
    get: () => current,
    provide: (value: T) => {
      current = value;
      return () => {
        // Only if it is still ours. A provider that has been superseded must not clear its
        // successor's value on the way out — see the note above.
        if (current === value) current = null;
      };
    },
  };
}

export interface HostListeners<T extends (...args: never[]) => void> {
  /** Subscribe. Returns the unsubscribe; call it, or hand it to `onCleanup`. */
  add: (listener: T) => () => void;
  /**
   * Call every listener, each in its own `try`.
   *
   * One subscriber throwing must not stop the rest: these are teardown paths — "this dataset went
   * away, forget what you knew about it" — and a listener that fails half way is a reason to log,
   * never a reason to leave the remaining stores holding a dataset that no longer exists.
   */
  emit: (...args: Parameters<T>) => void;
}

export function hostListeners<T extends (...args: never[]) => void>(label: string): HostListeners<T> {
  const listeners = new Set<T>();
  return {
    add: (listener: T) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (...args: Parameters<T>) => {
      // Copied first: a listener is allowed to unsubscribe itself in response, and mutating the set
      // mid-iteration would silently skip whichever one came next.
      for (const listener of [...listeners]) {
        try {
          listener(...args);
        } catch (error) {
          console.error(`${label}: a listener threw`, error);
        }
      }
    },
  };
}
