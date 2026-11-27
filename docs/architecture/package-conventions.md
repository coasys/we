# Package Conventions

How packages are organised in the WE monorepo, and — more usefully — the rules that decide where a
new thing goes. Follow these when adding or restructuring packages.

## Should this be a package at all?

The question the old version of this document never asked, which is how `@we/utils` came to exist:
74 lines, one consumer, its own `package.json`.

A package boundary buys exactly three things. **Independence is not one of them** — almost everything
here is coupled to something, and that is fine so long as the coupling is directional and declared.

|                 | Test                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| **Optionality** | Someone can install it without its siblings                                |
| **Enforcement** | It makes a boundary violation impossible rather than merely discouraged    |
| **Reuse**       | It has more than one consumer, or is meant for consumers outside this repo |

**A package earns its existence if at least one holds.** If none do, it is a directory.

Worked examples:

- `@we/backend-ad4m` — all three. A non-AD4M host omits it; the renderer _cannot_ import
  `@coasys/ad4m` through it; the shell and the modules both consume it.
- `@we/module-shared` — optionality and reuse. It is the module author's SDK: one install instead of
  three.
- `@we/utils` — none of the three. Folded into `@we/primitives`, its only consumer.

## Naming

### npm scope

All packages use the `@we/` scope.

### Directory names

Multi-package directories use a `-system` suffix:

```
packages/
├── design-system/    ← @we/tokens, @we/primitives, @we/components, …
├── schema-system/    ← @we/schema-shared, @we/expressions, @we/schema-solid
├── block-system/     ← @we/block-shared, @we/block-solid
├── backend-system/   ← @we/backend-shared, @we/backend-ad4m, @we/backend-inmemory, @we/backend-conformance
├── module-system/    ← @we/module-shared, @we/module-globe, @we/module-call, …
├── reactivity-system/ ← @we/reactivity, @we/reactivity-solid
├── templates/        ← @we/template-shell, @we/template-default  (data, no build step)
```

**Platform systems live at the top level; feature domains live in `module-system/`.** The top level
is the machinery WE is _made of_ — how templates render, where data lives, how features install. A
feature is a thing WE _has_, and the module system is the feature-packaging mechanism, so features
live under it: one package while simple, a **family** when the feature grows its own extension
point:

```
module-system/
├── shared/            the module contract
├── notes/             simple module — one package
├── call/              simple module — one package
├── transcribe/        simple module — one package
└── globe/             a feature family:
    ├── module/        @we/module-globe       shell integration
    ├── protocol/      @we/globe-protocol     the extension contract (pure types)
    ├── layers/        @we/globe-layers       first-party plugins
    └── widget/        @we/globe-widget       the renderer
```

When `GraphWidget` grows plugins it becomes `module-system/graph/` the same way. This is also why
`design-system/5-widgets` holds only _generic_ widgets — a feature's widget belongs to its family,
and moving the globe out of the design system is what took `cesium` out of the design system's
dependency graph.

Two consequences worth stating:

- **A family's contract may be `protocol/` instead of `shared/`** — `shared/` when it carries shared
  logic (a query engine, validators), `protocol/` when it is pure types. Both self-identify as the
  contract; the navigation rule "look for shared/" extends to "or protocol/".
- **Two naming orderings coexist inside a family, deliberately.** `@we/module-globe` is kind-first,
  matching its module siblings across families; `@we/globe-protocol` / `@we/globe-layers` /
  `@we/globe-widget` are domain-first, matching each other. Each package aligns with the family it
  is greppable against.

**`templates/` is deliberately not `template-system/`.** A `-system` holds a contract plus its
implementations; `templates/` holds **content** — its contract (`TemplateSchema`) lives in
`schema-system`. Same category of exception as `apps/`. The distinction to preserve: systems vary by
_implementation_, content directories vary by _what they say_.

**Directory names drop the kind prefix; package names carry it.** `@we/backend-ad4m` lives in
`backend-system/ad4m/`, `@we/template-default` in `templates/default/` — the parent directory
supplies what the npm name has to spell out, because npm names have no parent.

Every `-system` has a `shared/` holding its contract. **Look for `shared/` to find the contract** is
the one navigation rule worth memorising.

### Package names

Use the **shortest unambiguous** name within the `@we/` scope.

| Package                      | Name                | Rationale                                               |
| ---------------------------- | ------------------- | ------------------------------------------------------- |
| `schema-system/shared`       | `@we/schema-shared` | Needs prefix — "shared" alone is ambiguous              |
| `backend-system/ad4m`        | `@we/backend-ad4m`  | Needs prefix — "ad4m" alone says nothing about its role |
| `design-system/1-tokens`     | `@we/tokens`        | Standalone identity — unambiguous without prefix        |
| `design-system/3-primitives` | `@we/primitives`    | Standalone identity                                     |
| `models`                     | `@we/entities`      | Standalone package                                      |

### The shipped product's name — `WE` or `we`

Everything above names things a developer reads. A packaged desktop app also names things a **user**
reads, and the two want different spellings of the same word. The rule is which of them is reading:

| Spelling | Where                                                                                | Why                                                                                          |
| -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `WE`     | Window title, `.desktop` `Name=`, macOS bundle name, About screen, artifact filename | A person reads it as a name, and the capital is what stops it reading as the word "we"       |
| `we`     | Executable, Rust crate, `@we/` scope, reverse-DNS identifier, config directory       | A machine reads it as an identifier, where Unix convention is lowercase and nothing collides |

**Nothing carries both spellings for the same job.** That is the whole point of the rule, and the
failure it prevents is not cosmetic: a config directory derived from the display name in one host and
written lowercase in another is two directories on a case-sensitive filesystem, so the two hosts stop
seeing each other's data.

Concretely, in `apps/we-tauri/src-tauri/tauri.conf.json` `productName` is `WE` and `mainBinaryName` is
`we`; in `apps/we-electron/electron-builder.config.js` `productName` is `WE` and `executableName` is
`we`. Tauri's `mainBinaryName` must match the crate name in `Cargo.toml.template`, so both are `we`.

**Identifiers are product-then-runtime**: `io.weco.we.electron` and `io.weco.we.tauri`. Both hosts are
shipped, and an identifier is what macOS and Windows install _by_ — two apps sharing one cannot be
installed side by side. The runtime is the qualifier because the product is the same either way.

**Artifact filenames match across hosts**, since a release can hold one from each:
`WE-<version>-linux-x86_64.AppImage` from Electron and `WE-<version>-tauri-linux-x86_64.AppImage`
from Tauri. Electron carries no qualifier — it is the primary download, and choosing a file should not
require knowing what a runtime is. Electron gets this from its `artifactName` template; Tauri has no
equivalent, so `apps/we-tauri/scripts/rename-bundle.cjs` does it after the build.

## Grouping directories

Some `-system`s group their variants in a subdirectory (`schema-system/frameworks/solid`) and some do
not (`backend-system/ad4m`). That is not inconsistency; it follows a rule:

> **A grouping directory earns its keep when the variant names don't self-identify from the parent.**

- `backend-system/ad4m` — "ad4m" under a parent called `backend-system` is unambiguously a backend.
  A `backends/` level would stutter and add nothing.
- `schema-system/solid` — "solid" beside "shared" says nothing about _what kind of thing_ it is.
  `frameworks/solid` does.

It sharpens as the list grows. `{shared, solid, react, vue}` reads as four peers with `shared`
accidentally alphabetised among them; `{shared, frameworks/}` reads as _the contract_ and _its
bindings_. It also survives a future non-framework sibling — add `codegen/` to a flat list and the
directory becomes a grab-bag.

The cost is one extra `pnpm-workspace.yaml` glob per grouped system. Legibility while reading beats
brevity while globbing.

**Current state:** `frameworks/` in `schema-system`, `block-system` and `reactivity-system`; flat in `backend-system` and
`module-system`. If `backend-system` ever needs framework-specific bindings, `frameworks/` appears
then, beside the flat backends — which is what the rule predicts.

## Pattern A vs Pattern B

The old criterion was whether the shared layer is "substantial." That is not what is at stake.

> **Pattern A (multi-package) when a consumer should be able to install one variant without the
> others. Pattern B (single package, internal directories) when they always ship together.**

Substance is a proxy that mostly correlates and occasionally misleads. Optionality is the thing you
actually care about, and it predicts the right answer for cases the old rule left to judgement — e.g.
`@we/components` is correctly Pattern B today because nobody wants `Column` without its Solid
binding, and the rule says what to do when React lands rather than leaving it open.

### Pattern A: multi-package directory

```
schema-system/
├── shared/              ← @we/schema-shared (own package.json, tsconfig, tsup.config, src/)
└── frameworks/solid/    ← @we/schema-solid (depends on shared via workspace:*)
```

Each sub-package builds and versions independently. Adding a framework means adding a sibling under
`frameworks/`.

### Pattern B: single package with internal directories

```
4-components/
├── package.json         ← single @we/components package
└── src/
    ├── shared/
    └── frameworks/solid/
```

Consumers use subpath exports: `@we/components/solid`. `app-shell` is Pattern B with the same
`src/shared/` + `src/frameworks/solid/` split.

## Dependency direction

The invariant everything else rests on, and the one a lint rule can enforce.

```
templates ──▶ shell ──▶ backend-shared ◀── backend-ad4m
modules ──▶ shell ──▶ backend-shared ◀── backend-inmemory
     │                    ▲
     └──▶ schema-kit ──▶ schema-shared
```

- **Dependencies point inward** toward the contract packages.
- **No sideways edges.** No `templates → modules`, no `modules → modules`, no `backend-* → shell`.
  `@we/schema-kit` exists because of this rule rather than despite it: a module wanting a fragment the
  kit already had could only reach it through `modules → templates`, so the portable half moved inward
  to where both families point instead of an exception being carved for one of them. Its WE-store half
  stays in `@we/template-kit`, where a module reaching for it would be taking on the host's store
  surface — which is the coupling the edge was protecting against in the first place. Where such an
  edge existed it was inverted rather than tolerated: `installSpaceSdna` takes the module-owned models
  as an argument instead of reading the host's registry.
- `@we/shell-*`, `@we/schema-shared`, `@we/backend-shared`, `@we/module-shared` and `@we/*-solid`
  **must not import `@coasys/*`**. A package under `module-system/` may, **iff** its `defineModule`
  declares `backends: ['ad4m']` — that enforces the documented escape hatch rather than pretending it
  does not exist.

`@we/schema-shared` re-exports `@we/backend-shared`; the reverse would be circular, so
`@we/module-shared` (which depends on both) is where anything genuinely straddling them belongs.

`@we/expressions` sits between them: it depends on `@we/backend-shared` alone (for the where-object
matcher) and `@we/schema-shared` depends on it and re-exports it. It must not import the schema side,
because `@we/entities` evaluates expressions in declared operations and depends only on the backend
contract.

## Packages that carry assets are consumed as source

A package whose source imports assets (`.jpg`, `.glb`, `.svg`) must export `src/` and have **no build
step** — the two packages under `templates/` are the current examples.

Pre-bundling such a package resolves its asset imports at _package_ build time, emitting the files
into that package's `dist/` and freezing plain relative strings into the JS. The consuming app's
bundler cannot rewrite a plain string, so the URLs ship unchanged and 404 at runtime — a failure that
is silent, because nothing errors and the images are simply absent.

Only the bundler that emits the final output can resolve an asset URL. `@we/app-shell` exports
`./solid` as source for the same reason.

## Peer dependencies and injection

Load-bearing, and previously written nowhere.

> **A package that must share a single instance with the host declares it `peer` and receives it by
> injection, never by import.**

`@we/module-globe` peer-depends on `@we/widgets` and takes `CesiumGlobe` as a constructor argument;
`@we/entities` peer-depends on `@coasys/ad4m`; every module peer-depends on `@we/module-shared`. The
failure this prevents is documented in `docs/guides/writing-a-module.md`: a bundle carrying its own
reactive runtime gets a _second_ one, and reactivity silently stops crossing the boundary. It is
also why a module store is built from injected `deps.signal` / `deps.effect` rather than importing a
framework.

## Neutral stores and neutral packages

**A store, a module store and the prop resolvers take their reactivity from one `ReactivityPort`**
(`@we/reactivity`: signal, memo, effect, untrack, batch, root, onCleanup), never from a framework.
The host lends its implementation — `@we/reactivity-solid` under Solid — and tests also run under
`@we/reactivity/testing`'s second one, so a store that passes both is neutral in fact rather than
only in its imports. A store may rely on the port's three timing guarantees and nothing else; they
are in that package's README.

**Its environment comes from one `PlatformPort` in the same way** (`app-shell/src/shared/platform/`):
storage and session storage, the address and its history, a reload, the window's size, media
queries, the window's input events, animation frames, an image codec (how a picture is scaled
and encoded before it is stored: a canvas in a browser, the bytes as they came in a test), and the
document (custom properties and attributes on its root, style sheets, an element by id, a drawn
box measured, the title and icon). The app's clocks play on the platform's frames: `composeStores`
makes the one registry (`createAppClocks`) and lends it to the module services and the globe.
A store reads `platform.storage`, never `localStorage`. The port is the environment half of
`PlatformAdapter`, which extends it, so the adapter an app supplies is the `platform` every store
takes; a browser renderer spreads `createBrowserPlatform()` into its adapter, and a host that is not
a browser implements the port itself. `createTestPlatform()` is the test implementation: storage in
maps, an address and history in memory, a window a test resizes, events a test sends, frames a test
runs (`flushFrames`), an image codec that keeps the bytes, and a document that records what was written to its root (`drawn`). Timers and
`performance.now()` are not on it: every JavaScript runtime has them, and a test's fake clock
controls them. A measured input that changes the answer rides on the argument (the app's chrome
frame is `Viewport.frame`), never on module state.

Two places promise to be free of Solid, and `pnpm check:neutral-stores` (in CI beside the other
checks) holds them to it — and the stores and kernels to reading no browser global:

- **`packages/app-shell/src/shared/`**, where every store and the modules they use live. Any
  import of `solid-js` (`solid-js/store` and `solid-js/web` included), app-shell's `@solid/*`
  alias, a relative path into `frameworks/solid/`, or a workspace package that depends on solid-js
  fails. Nothing is let through: what a store needs from Solid is a binding, and a binding goes in
  `frameworks/solid/`.
- **A package marked `"we": { "neutral": true }`** in its package.json — the contract packages a
  host on another framework installs (`@we/reactivity`, `@we/backend-shared`, `@we/schema-shared`,
  `@we/module-shared`, …). Its `src/` is held to the same import rule, and it may
  not depend on solid-js, nor on a workspace package that does. Mark a new contract package neutral
  when you add it.
- **`shared/stores/` and `shared/kernels/`** read no browser global: `window`, `document`, storage,
  `navigator`, the address and history, media queries, animation frames, DOM constructors, in a value
  position (`typeof window` and `globalThis.<name>` included; a type annotation is not a read, and a
  name the file declares is its own). The rest of `shared/` may: its browser modules (safe mode, the
  boot snapshot) are the platform's side of the seam.

**How a neutral store is written and composed.** `RouteStore` (`app-shell/src/shared/stores/`) is
the first, and the shape the rest copy:

- The factory takes one object: `reactivity` (the port), `platform` when it touches the
  environment (typed as the `Pick<PlatformPort, …>` it uses), and the stores it reads, by the
  registry's names — `createXStore({ reactivity, platform, sessionStore, datasetStore })`. Nothing is
  looked up.
- `composeStores` (`app-shell/src/shared/composeStores.ts`) is the composition point, and neutral: it
  builds every store once, in dependency order, passing the reactivity port, the platform and the
  stores already built, and registers the boot sequence; a store needing a later one is lent it
  through a method afterwards (`provideSpaceLookup`), never by reordering. `BootController` calls it
  with `solidReactivity` and the app's host state; the profile vectors call it with the test port and
  the test platform, no framework at all (`tests/support/profileHost.ts`).
- The composed set is typed twice, both in `shared/stores/`: `StoreRegistry` (`storeRegistry.ts`),
  what components ask of by name, and `Stores` (`storeBag.ts`), the bag a template renders against.
  Components reach the registry through `useStore('xStore')` (`frameworks/solid/stores/useStore.ts`).
  That directory holds only Solid's binding: the hook and its context, Solid's live template document
  (`liveTemplate.ts`, the nested store a template edit patches), and the app's one copy of each
  piece of host state made over Solid's port (`hostState.ts`). A second framework writes those
  three over the same composed instances.
- What that binding costs is pinned by a test: `app-shell/tests/react/useStore.ts` is React's, about
  30 lines of code. A context holding the registry and the engine, `useStore(key)` for a store by
  name, and `useValue(accessor)` — `useSyncExternalStore` whose subscribe is an effect in a root of
  its own that reads the accessor and tells React, and whose snapshot is an untracked read. Nothing
  in a store changes for it; `tests/react/useStore.test.ts` mounts RouteStore and ClockStore under all
  three engines, calls an action from a press and redraws only when what was read changed. The host
  state and the live template document are the rest of a second host's bill (`plainLiveTemplates`
  serves any engine).
- A store with several jobs is one factory per job, composed back into one store. `SpaceStore`,
  `ShellStore` and `RecordStore` are each an interface and a composition in `shared/stores/`, with
  their parts in `stores/space/`, `stores/shell/` and `stores/records/`. A part is a factory
  (`createSpaceRoles(deps)`, `createShellDocks(deps)`, `createRecordCanvas(deps)`) returning the store
  members it owns, typed as a `Pick` of the store's interface, and what later parts read; the
  composition builds them in order and spreads their members, so a template still reads one
  namespace (`spaceStore.x`) and the template surface and profiles do not change when a job moves.
  A part takes the earlier parts it reads as narrow `Pick`s, never a closure over a later one. Where
  two parts genuinely need each other, the earlier one exposes a `provide*` call (a `hostSlot`, whose
  `need` throws naming what is missing) and the composition makes it right after building the later
  part — so every backward edge is one visible line in the composition. Each part has its own test
  under every engine, and each composition a test that builds it whole under every engine. The parts sit in a
  subdirectory so the AI-context extractor, which reads `stores/*.ts` for store interfaces, never
  takes one for a store.
- Its tests are plain `.ts` store tests, `describe.each(reactivityPorts)` over three engines
  (`app-shell/tests/support/engines.ts`): `solidReactivity`, `createTestReactivity()` — which runs
  sibling effects in a seeded shuffle and wakes readers on an equal write, the two things the port
  does not promise — and a port over `@vue/reactivity` (`tests/support/vueReactivity.ts`), an engine
  nobody here wrote. Each store is built inside `port.root` and disposed after, given
  `createTestPlatform()`. A failure under the test port prints its seed; `WE_REACTIVITY_SEED=<n>`
  runs that order again. They run in app-shell's `stores` test project: no DOM, the browser build of
  solid-js, so a store reaching past the platform port fails there rather than passing on jsdom's
  globals. A store test goes in jsdom's project only for a reason it names. What Solid gave
  for free and the port does not — a signal's `equals`, an updater setter — is written out in the
  store: an equal write is skipped by comparing first, a function is stored as the value.
- A backend read is followed through `followLive` (`app-shell/src/shared/followLive.ts`), called in
  the effect that owns it, applying each page through the store's own function. It disposes the handle with
  its owner, drops anything for an input the store has moved on from, says when the rows are in,
  and reads the stored rows once when the handle cannot open and an empty answer would mean
  something (`stored`). A store does not keep its own `stopped` flag.
- A list is handed out plain, rebuilt freely, with an `id` on every row. The renderer keeps a list's
  rows by `id` (`keepRows` in `@we/schema-solid`), so a row whose fields change keeps its mount; a
  store does not reconcile a list to keep its rows. A lookup that must wake only the readers of one
  key is a signal per key (`app-shell/src/shared/keyedSignals.ts`), not a nested store.

### Kernels

A **kernel** here is a pure algorithm a host needs to agree on with every other host: data in, data
out, no store, no backend, no framework. Each one has recorded vectors beside it, so a second host
(another framework, or another language) either reimplements it and replays the vectors, or runs
the same code compiled to WASM. Sharing one implementation is fine for these because they are pure;
what must stay separately implementable is the spec and anything stateful. (Not the same thing as a
module's capability kernels in `@we/module-shared`, which are ports a module is handed.)

| Kernel            | Where                                                  | What it answers                                                                                                         | Vectors                                  |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Board arrangement | `app-shell/src/shared/kernels/boardArrangement.ts`     | which cards each column of a board shows, in what order, and what is left over                                          | `kernels/vectors/boardArrangement.json`  |
| Tree ranks        | `app-shell/src/shared/kernels/treeRanks.ts`            | where a card sits in a tree read as arranged (`seatInRow`), and whether a drop would put it inside itself (`isUnder`)   | `kernels/vectors/treeRanks.json`         |
| Connection key    | `app-shell/src/shared/kernels/connectionKey.ts`        | the key a drawn connection is deduplicated by, which an interpretation pass matches                                     | `kernels/vectors/connectionKey.json`     |
| Dock layout       | `app-shell/src/shared/kernels/dockLayout.ts`           | the entry points of `dockGeometry.ts`: where a panel is placed, the seated layout, a drag's targets, what a drop writes | `kernels/vectors/dockLayout.json`        |
| Block flattening  | `flattenBlocks` in `@we/block-shared` (`src/kernels/`) | a composed document as the ordered rows a post is written as, each keyed to its parent                                  | `src/kernels/vectors/flattenBlocks.json` |

The vectors are recorded from the code (`pnpm --filter @we/app-shell record:kernels`,
`pnpm --filter @we/block-shared record:kernels`) and a test replays each file, so changing a kernel's
answer means re-recording and the diff shows every answer that moved. Add a kernel when a second host
would otherwise have to read our source to draw the same thing.

A kernel exports its **entry points**, not its helpers: each answers a whole question the host asks,
and the vectors ask only those. A vector that called a helper would pin how WE happens to compute the
answer, so a refactor would rewrite the vectors and a second host would have to copy the
decomposition. The helpers stay exported from the module they live in, for app code and the
TypeScript tests that pin them. Where the questions share inputs, the vectors are scenarios: the
inputs once, then each question with its arguments, an argument `{ "$": "path" }` naming one of the
inputs or an earlier question's answer (`dockLayout.json` is read this way — `askScenario` in
`app-shell/scripts/dockLayoutCases.ts`). The kernel's test checks that every entry point is asked
and every question names one.

A Pattern B package with a neutral core and a Solid binding says which exports are which with
`"we": { "neutralExports": [".", …] }` — `@we/design-utils` lists `.`, and `@we/components` its
`./signals` and `./step-words`. Importing a listed export from a neutral place is fine; any other
export of a package that depends on solid-js counts as Solid. List an export only when nothing it
reaches imports a framework.

## Adding a new package

1. Apply the three-part test above. If it fails all three, make a directory instead.
2. Pick Pattern A or B on optionality.
3. Pattern A: create the directory under the appropriate `-system/` parent — grouped under
   `frameworks/` only if the variant name doesn't self-identify — and add `package.json`,
   `tsconfig.json`, `tsup.config.ts`.
4. Follow the naming rules.
5. Add the workspace glob to `pnpm-workspace.yaml` if the parent isn't already matched.
6. Add a `README.md`. For a `shared/` contract package it must state **what belongs here and what
   doesn't** — that section is the thing that stops the package re-accreting, which is how both
   `app-shell` and `schema-shared` became hubs.
