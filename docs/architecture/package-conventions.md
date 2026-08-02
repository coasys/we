# Package Conventions

How packages are organised in the WE monorepo, and — more usefully — the rules that decide where a
new thing goes. Follow these when adding or restructuring packages.

## Should this be a package at all?

The question the old version of this document never asked, which is how `@we/utils` came to exist:
74 lines, one consumer, its own `package.json`.

A package boundary buys exactly three things. **Independence is not one of them** — almost everything
here is coupled to something, and that is fine so long as the coupling is directional and declared.

| | Test |
| --- | --- |
| **Optionality** | Someone can install it without its siblings |
| **Enforcement** | It makes a boundary violation impossible rather than merely discouraged |
| **Reuse** | It has more than one consumer, or is meant for consumers outside this repo |

**A package earns its existence if at least one holds.** If none do, it is a directory.

Worked examples:

- `@we/backend-ad4m` — all three. A non-AD4M host omits it; the renderer *cannot* import
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
├── schema-system/    ← @we/schema-shared, @we/schema-solid
├── block-system/     ← @we/block-shared, @we/block-solid
├── backend-system/   ← @we/backend-shared, @we/backend-ad4m, @we/backend-inmemory
├── module-system/    ← @we/module-shared, @we/module-globe, @we/module-call, …
├── globe-system/     ← @we/globe-protocol, @we/cesium-layers
├── templates/        ← @we/template-shell, @we/template-default  (data, no build step)
```

**`templates/` is deliberately not `template-system/`.** A `-system` holds a contract plus its
implementations; `templates/` holds **content** — its contract (`TemplateSchema`) lives in
`schema-system`. Same category of exception as `apps/`. The distinction to preserve: systems vary by
*implementation*, content directories vary by *what they say*.

**Directory names drop the kind prefix; package names carry it.** `@we/backend-ad4m` lives in
`backend-system/ad4m/`, `@we/template-default` in `templates/default/` — the parent directory
supplies what the npm name has to spell out, because npm names have no parent.

Every `-system` has a `shared/` holding its contract. **Look for `shared/` to find the contract** is
the one navigation rule worth memorising.

### Package names

Use the **shortest unambiguous** name within the `@we/` scope.

| Package | Name | Rationale |
| --- | --- | --- |
| `schema-system/shared` | `@we/schema-shared` | Needs prefix — "shared" alone is ambiguous |
| `backend-system/ad4m` | `@we/backend-ad4m` | Needs prefix — "ad4m" alone says nothing about its role |
| `design-system/1-tokens` | `@we/tokens` | Standalone identity — unambiguous without prefix |
| `design-system/3-primitives` | `@we/primitives` | Standalone identity |
| `models` | `@we/models` | Standalone package |

## Grouping directories

Some `-system`s group their variants in a subdirectory (`schema-system/frameworks/solid`) and some do
not (`backend-system/ad4m`). That is not inconsistency; it follows a rule:

> **A grouping directory earns its keep when the variant names don't self-identify from the parent.**

- `backend-system/ad4m` — "ad4m" under a parent called `backend-system` is unambiguously a backend.
  A `backends/` level would stutter and add nothing.
- `schema-system/solid` — "solid" beside "shared" says nothing about *what kind of thing* it is.
  `frameworks/solid` does.

It sharpens as the list grows. `{shared, solid, react, vue}` reads as four peers with `shared`
accidentally alphabetised among them; `{shared, frameworks/}` reads as *the contract* and *its
bindings*. It also survives a future non-framework sibling — add `codegen/` to a flat list and the
directory becomes a grab-bag.

The cost is one extra `pnpm-workspace.yaml` glob per grouped system. Legibility while reading beats
brevity while globbing.

**Current state:** `frameworks/` in `schema-system` and `block-system`; flat in `backend-system` and
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
                          ▲
                    schema-shared
```

- **Dependencies point inward** toward the contract packages.
- **No sideways edges.** No `templates → modules`, no `modules → modules`, no `backend-* → shell`.
  Where such an edge existed it was inverted rather than tolerated: `installSpaceSdna` takes the
  module-owned models as an argument instead of reading the host's registry.
- `@we/shell-*`, `@we/schema-shared`, `@we/backend-shared`, `@we/module-shared` and `@we/*-solid`
  **must not import `@coasys/*`**. A package under `module-system/` may, **iff** its `defineModule`
  declares `backends: ['ad4m']` — that enforces the documented escape hatch rather than pretending it
  does not exist.

`@we/schema-shared` re-exports `@we/backend-shared`; the reverse would be circular, so
`@we/module-shared` (which depends on both) is where anything genuinely straddling them belongs.

## Packages that carry assets are consumed as source

A package whose source imports assets (`.jpg`, `.glb`, `.svg`) must export `src/` and have **no build
step** — the two packages under `templates/` are the current examples.

Pre-bundling such a package resolves its asset imports at *package* build time, emitting the files
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
`@we/models` peer-depends on `@coasys/ad4m`; every module peer-depends on `@we/module-shared`. The
failure this prevents is documented in `bundledModules.ts`: a bundle carrying its own reactive
runtime gets a *second* one, and reactivity silently stops crossing the boundary.

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
