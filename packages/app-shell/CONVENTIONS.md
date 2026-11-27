# @we/app-shell — conventions

The biggest package in the repo, and the one place framework, backend
contract, and product meet. These are the rules that keep it navigable.

## Layering

- `src/shared/` is framework-neutral: no Solid imports. Platform and backend
  **contracts** live here; their implementations live with the hosts
  (`createDesktopPlatform` is the one shared implementation, because the
  shape is identical across desktop hosts).
- `src/frameworks/solid/` is the app. A future second framework is a sibling
  directory, not edits here.
- Never import `@coasys/*` outside `src/shared/backend` wiring — data access
  goes through the ports from `@we/backend-shared`. The renderer, design
  system and modules never see a backend.

## Stores

- One store per concern, in `src/shared/stores/`, built by a `createXStore(deps)`
  factory on the reactivity port and the platform port (`deps.platform`, the
  `PlatformAdapter` the app supplies, which extends `PlatformPort`) and composed
  in `src/shared/composeStores.ts`, which `providers/BootController.tsx` calls:
  the stores it reads are its arguments, never a context lookup. **The
  composition order is load-bearing**: a store may read stores built before
  it, never after. Components read stores through `useStore('<name>Store')`
  (`frameworks/solid/stores/useStore.ts`), keyed by the names templates use;
  that directory is the only Solid-specific piece of the wiring, and
  `pnpm check:neutral-stores` refuses a Solid import anywhere under `shared/`,
  and a browser global (`window`, `document`, `localStorage`, …) under
  `shared/stores/` and `shared/kernels/`: storage, the address, the window, its
  events, frames and the document come from `platform`. Store tests take
  `createTestPlatform()` and run without a DOM (the `stores` test project).
- A store with several jobs is one part per job (`stores/space/`,
  `stores/shell/`, `stores/records/`), each its own factory with its own test
  under every engine (`tests/support/engines.ts`), composed back into the one store templates read. Move a
  job between parts without changing the store's interface. A part takes the parts before it as
  `Pick`s; a need that points at a later part is a `provide*` call the composition makes once that
  part is built, never a closure.
- A pure algorithm another host has to agree with is a kernel in
  `src/shared/kernels/`, with recorded vectors (`pnpm --filter @we/app-shell
record:kernels`; prettier the JSON after, except `dockLayout.json`). See
  "Kernels" in `docs/architecture/package-conventions.md`.
  A store needing something from a later one is a design smell — the existing
  upward callbacks (`registerHistoryCallbacks`, `provideSpaceLookup`,
  `provideInstalledModules`, `setNavigateFunction`) are tolerated debt, not
  a pattern to extend.
- A store's public surface is schema-facing API. Every state member and
  action is reachable from templates through an expression or `$invoke`, interpreted into
  the generated reference by `@we/ai-context` — so name members for template
  authors, document them in `ai-context/src/fragments/stores.ts`, and treat
  removals as breaking (a stale fragment entry fails the build).
- No scratch members on stores. A debug helper on the store surface is
  template-reachable vocabulary (`spaceStore.test` existed; it is gone).
- Async actions that schemas await (`$invoke` + `onSuccess`) must reject on
  failure — `onSuccess` firing on a failed join is a lie in the UI.

## Schemas

- Built-in template schemas live in `src/shared/schemas/` as `.schema.ts`
  files; validate with `pnpm --filter @we/schema-shared validate` after any
  change.
- Developer-only surfaces (the schema test harness) are DEV-gated at their
  registration site, not shipped and hidden.

## UI code

- Use DS components and props (`Column`/`Row`/`we-*` with `gap`/`p`/`bg`/…),
  not raw divs with `style={{}}` — the `design-system/prefer-ds-props` lint
  rule enforces the overlap. Raw `style` is for CSS with no DS equivalent
  (three.js mounts, router internals).
- Logging: `console.warn`/`error` for real diagnostics; anything chattier is
  DEV-gated. User-facing failures go through the toast service / `$onError`,
  not the console.

## Tests

- `tests/` runs against `@we/backend-inmemory`'s ports — no executor. If a
  store behaviour can't be tested that way, that is a gap in the in-memory
  backend's conformance surface; extend it there rather than mocking around
  it.
