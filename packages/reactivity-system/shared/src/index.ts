/**
 * The reactivity a store is written against, whatever framework the host runs.
 *
 * A store built from this port rather than from a framework's own primitives runs under any host
 * that implements it: Solid's implementation is `@we/reactivity-solid`, and `@we/reactivity/testing`
 * holds a second, small one that tests run under so a store is shown to depend on nothing more.
 *
 * What a store may assume about timing is exactly three things, stated on {@link ReactivityPort} and
 * in the README. Anything else one implementation happens to do — the order sibling effects run in,
 * whether writing an equal value wakes anyone, when an effect first runs inside a root — is not part
 * of the port, and the second implementation differs from Solid on the last of those on purpose.
 */

/** Read a reactive value. Read inside a memo or an effect, it makes that computation depend on it. */
export type Accessor<T> = () => T;

/**
 * Replace a signal's value.
 *
 * Always a value, never an updater: a function passed is stored as the value. Solid's own setter
 * would call it, which is why the Solid implementation wraps it rather than handing it out.
 */
export type Setter<T> = (next: T) => void;

/**
 * The port. Every member is a plain function, so it can be destructured and passed on unbound.
 *
 * The three timing guarantees, and the only ones:
 *
 * 1. **An effect runs after the synchronous update that triggered it, never during it.** The update
 *    is a write, or the effect's own creation. By the time the outermost write, `batch` or `root`
 *    containing that update returns, the effect has run and seen the update complete.
 * 2. **`batch` defers effects to its end.** No effect runs while a batch is open, nested ones
 *    included; when the outermost batch returns, every effect its writes woke has run.
 * 3. **A memo read is always current** while the root that owns it is alive: inside a batch, inside
 *    an effect that has just written its sources, untracked or not. A memo whose root has been
 *    disposed keeps whatever it last held.
 */
export interface ReactivityPort {
  /** A value that can be read and replaced. */
  signal: <T>(initial: T) => [Accessor<T>, Setter<T>];
  /** A value derived from others, recomputed when they change and read like a signal. */
  memo: <T>(fn: () => T) => Accessor<T>;
  /**
   * Run `fn` now or soon, and again whenever something it read changes. Teardown is `onCleanup`
   * inside it, which runs before each re-run and when the owning root is disposed.
   */
  effect: (fn: () => void) => void;
  /** Read without depending: nothing `fn` reads makes the surrounding memo or effect re-run. */
  untrack: <T>(fn: () => T) => T;
  /** Make several writes as one update. Returns what `fn` returns. */
  batch: <T>(fn: () => T) => T;
  /**
   * An owner for the memos and effects created inside `fn`, which live until the returned function
   * is called. A store is created inside one, so what it set running has a scope that ends.
   */
  root: (fn: () => void) => () => void;
  /** Register teardown with the current owner — the running effect or memo, else the root. */
  onCleanup: (fn: () => void) => void;
}
