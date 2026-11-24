# @we/reactivity

The reactivity a store is written against, whatever framework the host runs: one `ReactivityPort`
that the renderer's prop resolvers, module stores and host stores all take.

```ts
interface ReactivityPort {
  signal: <T>(initial: T) => [Accessor<T>, Setter<T>];
  memo: <T>(fn: () => T) => Accessor<T>;
  effect: (fn: () => void) => void;
  untrack: <T>(fn: () => T) => T;
  batch: <T>(fn: () => T) => T;
  root: (fn: () => void) => () => void;
  onCleanup: (fn: () => void) => void;
}
```

A setter takes a value, never an updater: a function written to a signal is stored as the value.
`root` owns the memos and effects created inside it until the function it returns is called;
`onCleanup` registers teardown with the running effect or memo, else the root.

| Package                  | Where                                | What                                             |
| ------------------------ | ------------------------------------ | ------------------------------------------------ |
| `@we/reactivity`         | `reactivity-system/shared`           | The port, and nothing framework-bound            |
| `@we/reactivity/testing` | the same package                     | The guarantee suite every implementation runs    |
| `@we/reactivity-solid`   | `reactivity-system/frameworks/solid` | `solidReactivity`: the port implemented by Solid |

## The three guarantees

A store may rely on these, and on nothing else about timing.

1. **An effect runs after the synchronous update that triggered it, never during it.** The update is
   a write, or the effect's own creation. By the time the outermost write, `batch` or `root`
   containing that update returns, the effect has run and seen the update complete.
2. **`batch` defers effects to its end.** No effect runs while a batch is open, nested batches
   included. When the outermost one returns, every effect its writes woke has run.
3. **A memo read is always current** while the root that owns it is alive: inside a batch, inside an
   effect that has just written the memo's sources, untracked or not. A memo whose root has been
   disposed keeps whatever it last held.

"Outermost" in the first is load-bearing under Solid. An effect created while a root is being built
first runs when that root returns — and if the root was itself made while another root was being
built, or inside a running effect, when the outer one finishes. A store built by a composition root
therefore cannot count on its own effects having run before its factory returns, only before the
composition root does.

Things the port does **not** promise, which a store must not lean on: the order sibling effects run
in; whether writing an equal value wakes anything; how many times an effect runs for one update; an
effect's first run happening at any particular point before the end of its update.

## Implementations, and the suite they pass

`describeReactivityGuarantees(name, createPort, hosts?)` in `@we/reactivity/testing` is the
guarantees as a test suite. Each case runs from several _hosts_ — the place a store's root is made: a
root at module scope, a root made while another is being built, a root made inside an effect, and a
root made after an `await`. `@we/reactivity-solid` adds a mounted component tree. An implementation
passes the whole suite or it is not one.

## What belongs here and what doesn't

**Here:** the port's types and the guarantee suite. Nothing that imports a
framework — the package is marked `"we": { "neutral": true }`, and `pnpm check:neutral-stores` fails
if it, or any neutral package, imports or depends on Solid.

**Not here:**

- **A framework's implementation.** It goes in its own package under `frameworks/`, so a host on
  another framework installs the contract without it.
- **A nested-store primitive** (`createStore`, `reconcile`). Row identity in lists is the renderer's
  job and it already does it (`keepRows`); a per-key lookup is a map of signals; the template document
  is the renderer adapter's. Neither needs the port.
- **Context, providers, hooks.** Stores are composed by passing them to each other; a framework's hook
  layer over the composed stores lives with that framework's host.
- **Tagging accessors** for the renderer. That is `markReactive` in `@we/expressions`, beside the
  evaluator that reads the tag.
