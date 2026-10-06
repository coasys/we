# The backend system

The contract between WE and whatever holds its data, and the adapters that implement it. The
renderer, the stores, the design system and the module contract speak the ports in `shared/`; a
backend is one package under this directory that implements them, and nothing above this directory
imports one.

## Why a contract layer

- **The dependency is a readable list.** What a store or the renderer needs from the data layer is
  one interface in one file — `BackendPorts`, `RendererDataBindings` — rather than something
  recovered by grepping call sites. Reviewing a change to it is reviewing a file.
- **A stated grammar is what a query can be planned against.** Every `$query` compiles to the IR and
  is planned against the adapter's declared capabilities before it runs. A query the backend cannot
  answer is refused by feature name; without a contract to plan against it answers nothing, silently.
- **Entities are declarations because the product needs them to be.** A community defines a model
  in the morning; a wizard and a language model both produce declarations; forms, cards, pickers and
  extraction prompts derive from them. That needs a declaration format that is not class syntax —
  `EntityManifest` — whatever the adapter compiles it to.
- **Optional ports degrade by construction.** Transcription, the language model, runtime admin and
  interpretation are optional and feature-detected. A node without one omits the port, and the UI
  says so rather than every feature learning how to check.
- **A client upgrade is one package.** The adapter carries the version it was verified against and
  the quirks that version has; moving the pin is one review.
- **Consumers boot in milliseconds.** Because the contract is implementable over arrays, store tests
  and the browser harness run against `@we/backend-inmemory` with no process to start.

## Packages

| Package                | Role                                                                                                                                                                           | Depends on        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| `@we/backend-shared`   | The contract: `BackendPorts`, the query IR + planner + reference engine, the entity manifest, the record contract, presence / ephemeral / transcription / interpretation ports | nothing backend-y |
| `@we/backend-ad4m`     | The AD4M adapter — the only package that imports `@coasys/*` (see its README)                                                                                                  | shared            |
| `@we/backend-inmemory` | The test double: row-backed entities over the shared engine, the full ports bundle the boot and conformance suites run against                                                 | shared            |

## The seams that matter

- **`BackendPorts`** (`shared/src/backendPorts.ts`) — what a host's `BackendConnector.initialize()`
  returns and stores consume through `sessionStore.backendPorts()`. Records are reached through the
  entity proxies in `@we/entities`, which resolve to whatever the adapter registered at connect time.
- **`RendererDataBindings`** (`shared/src/dataSource.ts`) — the exact `$`-bindings the schema
  renderer reads. `inmemory/tests/portsConformance.test.ts` pins that both adapters expose the same
  surface, so a missing binding is a named test failure rather than a backend that only boots.
- **The query IR** (`shared/src/queryIR*`) — templates issue the flat `$query` dialect,
  `compileQuery` lifts it to the IR, the adapter plans it and lowers it to its native query. `scope`
  is an anchor type plus a relation name, so no template names a storage predicate.
- **The contract specifies the semantics; both implementations conform.** Where the reference
  engine and an adapter disagree about an answer, the IR is where the rule gets written and the
  conformance suite is where it gets asserted — against both.

## Where things are

- The ports contract, query IR and planner: `shared/src/`
- The AD4M adapter: `ad4m/src/` (its README says what belongs there)
- The in-memory backend and ports bundle: `inmemory/src/` (see its README)

Tests: `pnpm --filter @we/backend-shared test` (query engine, presence, ephemeral),
`--filter @we/backend-ad4m test` (adapters, manifest compiler), `--filter @we/backend-inmemory test`
(entities, lifecycle, ports conformance).
