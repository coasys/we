# The backend system

WE's backend contract and its implementations. The renderer, the design system
and the module contract never import a backend — they speak these ports, which
is what makes a template, a component or a feature module reasonable about
without knowing what holds the data. Backend independence is a first-class
requirement of the project, and this directory is where it is enforced.

## Packages

| Package                | Role                                                                                                                                                                              | Depends on          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `@we/backend-shared`   | The contract: `BackendPorts` (agent session, dataset lifecycle, schemas, profiles, ephemeral, data bindings), the query IR + engine, presence/transcription ports, model manifest | nothing backend-y   |
| `@we/backend-ad4m`     | The AD4M adapter: query adapter, SDNA install, agent identity, ephemeral/transcription ports, the local-executor connector the desktop apps use                                   | shared, `@coasys/*` |
| `@we/backend-inmemory` | The reference implementation: row-backed entities over the shared query engine, the full ports bundle the boot/conformance suites run against — no executor needed                | shared              |

## The seams that matter

- **`BackendPorts`** (`shared/src/backendPorts.ts`) is what a host's
  `BackendConnector.initialize()` returns. The app shell wires it into stores;
  a second backend is a second implementation of this interface, nothing more.
- **`RendererDataBindings`** (`shared/src/dataSource.ts`) is the exact set of
  `$`-bindings the schema renderer reads (`$getEntity`, `$queryAdapter`,
  `$identities`, `$ephemeral`, `model` mutations, …). The in-memory bundle's
  conformance suite (`inmemory/tests/portsConformance.test.ts`) pins that both
  adapters expose the same surface — a missing binding is a named test
  failure, not a silently boot-only backend.
- **The query IR** (`shared/src/queryIR*`): templates issue the flat `$query`
  dialect; `compileQuery` lifts it to a neutral IR, each adapter's
  `QueryAdapter` plans and lowers it to whatever its backend natively speaks,
  and the engine computes up whatever the backend can't.
- **`@coasys/*` is imported only here** (the ad4m package), by `@we/entities`,
  and by modules that declare `backends: ['ad4m']`. Nothing else.

## Where things are

- The ports contract and query engine: `shared/src/`
- AD4M wiring (query adapter, SDNA install, agent identity, local-executor
  connector): `ad4m/src/`
- The in-memory backend and ports bundle: `inmemory/src/` (see its README)

Tests: `pnpm --filter @we/backend-shared test` (query engine, presence,
ephemeral), `--filter @we/backend-ad4m test` (adapters, manifest compiler),
`--filter @we/backend-inmemory test` (entities, lifecycle, ports conformance).
