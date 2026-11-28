# Module testing

`@we/module-testing` tests a module store without a host. It gives fake deps, an in-memory fake for each common kernel, a `buildStore` that builds a store as the registry does, and the contract's own `lintModule`.

**Why:** A store is built only from injected deps, so a test can give it closures for signals and arrays for records, and run it under vitest with no renderer, backend or shell (the `index.ts` header). Before this package, each bundled module wrote its own fakes.

**Parent:** [Module contract](README.md)

<details><summary>How it works</summary>

| Export | What it gives |
|---|---|
| `fakeDeps(overrides)` | The degraded host that every store must survive: `plainSignal` for signals, an effect that runs once and swallows an error, no kernels, no dataset, no agent, empty settings. A test overrides only what it is about. |
| `plainSignal(initial)` | A signal as a getter and a setter over a closure. |
| `fakeRecords({ author, datasetKey })` | A `RecordsKernel` over an array per entity: `where` by equality (a list means "in", `{ not }` means "not equal"), `order` by one key, `limit`, `offset`, `select`, `within`, and a live `subscribe` that fires after each write. `rows` and `writes` let a test assert what the module wrote and where. |
| `fakeDocuments` | `DocumentAccess` as a map. `read` returns exactly what was written. |
| `fakeAgentData` | The same fake in the `AgentDataKernel` shape, with a personal dataset key. |
| `fakePresence` | A roster that the test sets. `publish(peer, activity)` puts an activity on a peer; `setActivity` records what the module published. |
| `fakeEphemeral` | The in-memory `EphemeralPort` from `@we/backend-shared` on an `InMemoryBus`. `agent(did)` is a second peer, `sent(channel)` is what the store sent, and `drop` simulates loss. |
| `fakeView` | A pointer and a frame that the test moves, and a record of what the module asked to draw or go to. |
| `buildStore(definition, deps)` | Calls `createStore` with only the kernels that `manifest.requires.kernels` names. A test of a module whose manifest forgets a kernel sees the same degraded path as the app. |
| `lintModule`, `markState`, `markAction`, `storeSurface` | Re-exported from `@we/module-shared`, so a test judges a definition as the registry does. |

The `fakeEphemeral` comment gives a warning: the in-memory port is the opposite of AD4M's on every axis (native unicast, at-least-once, no heartbeat). A test about loss must use `drop`.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/testing/src/index.ts](../../../packages/module-system/testing/src/index.ts): every fake and `buildStore`.
- [packages/module-system/testing/src/index.test.ts](../../../packages/module-system/testing/src/index.test.ts): the fakes' own tests.
- [packages/module-system/shared/src/lint.ts](../../../packages/module-system/shared/src/lint.ts): `lintModule` ([Lint and compatibility](../registry/lint.md)).

</details>
