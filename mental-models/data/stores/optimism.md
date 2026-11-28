# Optimism

**Optimism** (`@we/optimism`) holds a value that the screen draws before its write comes back, and decides when to stop believing it. A **hold** is one such value, by key, with the data's value at the first draw after the write as its baseline.

**Why:** On AD4M a write comes back through a subscription in about a second, and the executor's subscription loop adds a 250 ms debounce. For a control the person is watching, a second of the old value reads as a failed press. The hold is a promise about presentation, not a prediction of the merge: it never merges, renumbers or breaks a tie, and it gives way to the next answer from the data. It is not a cache and not part of the backend contract, so nothing can trust it as data.

**Parent:** [Stores](README.md)

<details><summary>How it works</summary>

The five rules:

1. **Release only on failure.** A successful write does not release its hold, because the promise resolves before the data arrives.
2. **Settle on the data moving, not on it agreeing.** A hold retires when an answer later than the write arrives, even if a peer's write makes that answer differ.
3. **Take the baseline at the first draw**, not at hold time, so no extra read is needed.
4. **Nothing settles while a write is still going.** A hold counts the writes behind it (`writing`) and is judged only after the last one returns, against a fresh baseline.
5. **A backstop.** A hold older than `ttlMs` (`DEFAULT_TTL_MS`, 10 000 ms) is not believed.

| Member | Use |
|---|---|
| `hold(key, value)` | a write goes out |
| `preview(key, value)` | show a value with no write behind it, for example a slider during a drag |
| `done(key)` / `release(key)` | the write returned / failed |
| `toDraw(key, observed)` | the held value, or `undefined` when the data has overtaken it |
| `settle(observedBy)` | report what a draw was made from |
| `inFlight()`, `forget(key)`, `holds()`, `reset()` | inspect or drop holds |

`createOptimism(signal, rules)` takes the host's signal factory and `Rules` (`same`, `ttlMs`). Users: `RecordStore` (card styles, connections), `boardOptimism.ts`, `signalOptimism.ts`, `involvementOptimism.ts` and the polls module store.

</details>

<details><summary>Where in the code</summary>

- [packages/optimism/src/index.ts](../../../packages/optimism/src/index.ts): `createOptimism`, `Optimism`, `Held`, `Holds`, `Rules`, `DEFAULT_TTL_MS`, `keyOf`, `sameValue`, `sameOrder`, and the pure functions `hold`, `preview`, `done`, `release`, `forget`, `toDraw`, `reconcile`.
- [packages/app-shell/src/shared/boardOptimism.ts](../../../packages/app-shell/src/shared/boardOptimism.ts), [signalOptimism.ts](../../../packages/app-shell/src/shared/signalOptimism.ts), [involvementOptimism.ts](../../../packages/app-shell/src/shared/involvementOptimism.ts): host users.
- [packages/module-system/polls/src/store.ts](../../../packages/module-system/polls/src/store.ts): a module user.

</details>
