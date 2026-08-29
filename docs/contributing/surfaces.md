# Contribution surfaces

Every slot WE accepts a contribution into — what each one is for, what shape it takes, where its
rules live, how it gets registered, and how it reaches other people.

This page exists because the knowledge was complete and unfindable. Every system here has a README
and most have a `CONVENTIONS.md`, but they are organised by _package_, which only helps somebody who
already knows the layering. A contributor — or an agent working on their behalf — arrives with an
intent ("we want a different feed", "calls should be transcribable") and needs the intent routed to
a slot before any of that documentation is reachable.

So this page is a **router, not a manual**. Each entry is a few lines and a pointer. The authoring
rules stay in the `CONVENTIONS.md` beside the code, which is the only place they can stay correct.

---

## Choosing a surface

The spine of every decision here is one rule, from
[`@we/template-kit`'s conventions](../../packages/templates/kit/CONVENTIONS.md):

> **Code owns only what data cannot express.** Behaviour and focus management, accessibility
> semantics, browser APIs, measurement, performance-critical rendering — that is the whole list.
> Everything above it is arrangement, and arrangement stays data.

Almost every "which surface?" question is that rule applied at a different altitude. Work down this
list and stop at the first row that fits; the earlier rows are cheaper for everyone, and a
contribution one rung too high permanently costs more than it should.

| You want to…                                                               | Surface                        | Why not the next rung down                                                                    |
| -------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| Change how one space looks                                                 | **Theme**                      | A template fork to change colours abandons every later improvement to the template            |
| Change what one section of a space _is_                                    | **View**                       | Forking a whole shell to change one page makes every upstream fix a merge conflict            |
| Change a space's whole chrome, arrangement and route table                 | **Shell template**             | —                                                                                             |
| Reuse an arrangement across templates                                      | **Fragment**                   | A component would make it opaque to the editor and unforkable by the people using it          |
| Add a stateless piece of UI that needs measurement, focus or a browser API | **Primitive** or **component** | A fragment cannot express behaviour; this is the line the rule above draws                    |
| Add schema boilerplate that is component-agnostic                          | **Schema operator**            | A fragment would bake design-system knowledge into something meant to be neutral              |
| Add a new kind of content a user composes into a page                      | **Block type**                 | —                                                                                             |
| Add a stateful capability a community turns on                             | **Feature module**             | Modules hold state and talk to ports; if yours holds neither, it is a fragment or a component |
| Add a new source of nodes, or a new arrangement, in a graph                | **Graph plugin**               | A module would rebuild the engine; expanders and layouts plug into the one that exists        |
| Add a new kind of thing that gets stored                                   | **Model**                      | —                                                                                             |
| Ship a differently-shaped deployment of WE                                 | **Seed**                       | Nothing needs to be written at all — a seed selects from what exists                          |
| Run WE on data that isn't AD4M                                             | **Backend adapter**            | —                                                                                             |

Three of these pairs come apart in ways worth knowing, because each has been got wrong at least once:

- **Component vs fragment.** `AvatarStack` is a component (it does overlap maths); the count beside
  it is a fragment. `we-modal` is a primitive (focus trap, top layer); the confirm dialog inside it
  is a fragment. The question is never "how complicated is it" — it is "does it need to _do_
  something, or only be _arranged_ a certain way".
- **Fragment vs operator.** When the repetition is a `value`/`onInput` wiring pattern, ask whether
  it is component-agnostic first. `field` stayed a fragment because _which event carries the value_
  is design-system knowledge, and an operator would smuggle that table into the schema resolver.
- **Module vs everything else.** A feature module is the rung above blocks: a bundle of **stateful
  capability** that installs into a space. `@we/module-notes` and `@we/module-call` contain no
  framework code at all — every piece of their UI is a schema fragment. If what you have is
  presentation, it is not a module.

And one rule that overrides all of the above: **never extract speculatively.** Three real uses of
the same shape, or a divergence that is already a bug. Two is a coincidence. This applies to every
row of the table, not just fragments.

**The reuse units, on their axes.** Four of the rows above — fragment, primitive, component, widget — are all "a reusable piece of UI",
and their names say nothing about what separates them. Untangling them has cost real time more than
once, and `@we/widgets` ended up as `export {}` because its definition never distinguished it from
its neighbours. The names are kept (they are in every import path), but they are placed here on the
two axes that actually decide which one a thing is:

|                                   | **Arrangement only** (data)         | **Needs a browser API** (code)                                                                |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| **Framework-neutral**             | Fragment — expands to plain nodes   | Primitive — a Lit element                                                                     |
| **Bound to the host's framework** | _(does not exist: data is neutral)_ | Component — a Solid function; Widget — a component whose props are a whole feature's protocol |

Read it as two questions, in order. _Does it need to do something, or only be arranged?_ If
arranged: a fragment, whatever the framework, because data is neutral by construction. If it must
do something: _can it be neutral?_ A focus trap, a top layer, measurement and keyboard handling can
— that is a primitive. Only what needs the host's reactive framework in its implementation (a
component that takes callbacks and renders children through it) is a component; a widget is a
component large enough to own a protocol of its own (`GraphView` and its plugin catalogue), and
lives with the feature it belongs to.

The cell that does not exist is the point of the table: nothing that is arrangement should ever be
framework-bound, and if a "component" turns out to be arrangement it is a fragment written in the
wrong language. For distribution the axes matter more than the names — the left column crosses the
trust boundary as data; the right column merges.

---

## The surfaces

| Surface                                     | What it is                                      | Reaches people by         |
| ------------------------------------------- | ----------------------------------------------- | ------------------------- |
| [Themes](#themes)                           | Token overrides + CSS, as a visual identity     | Install at runtime · repo |
| [Shell templates](#shell-templates)         | A whole space interface, as a schema            | Install at runtime · repo |
| [Views](#views)                             | One section of a space, as a schema             | Install at runtime · repo |
| [Portable fragments](#portable-fragments)   | A named arrangement that expands to plain nodes | Repo                      |
| [WE-domain fragments](#we-domain-fragments) | The same, allowed to name WE's stores           | Repo                      |
| [Design tokens](#design-tokens)             | Spacing, colour, radius… and the semantic roles | Repo                      |
| [Primitives](#primitives)                   | Lit web components — framework-neutral currency | Repo                      |
| [Components](#components)                   | Solid layout and composite components           | Repo                      |
| [Widgets](#widgets)                         | The highest design-system layer                 | Repo                      |
| [Block types](#block-types)                 | A kind of content a user composes into a page   | Repo                      |
| [Schema operators](#schema-operators)       | New vocabulary in the schema language           | Repo                      |
| [Stores](#stores)                           | Shell state and actions — schema-facing API     | Repo                      |
| [Models](#models)                           | A kind of thing that gets stored                | Repo                      |
| [Feature modules](#feature-modules)         | A stateful capability a community turns on      | Repo (bundled)            |
| [Graph plugins](#graph-plugins)             | Expanders, layouts, renderers, behaviours       | Repo                      |
| [Globe layers](#globe-layers)               | A layer on the Cesium globe                     | Repo                      |
| [Seeds](#seeds)                             | What a deployment _is_                          | Fork                      |
| [Backend adapters](#backend-adapters)       | WE over something other than AD4M               | Repo                      |
| [Platform hosts](#platform-hosts)           | WE on a new platform                            | Repo                      |

"Install at runtime" means the thing can be published and installed by a person using WE, without
touching this repository. Only two surfaces can do that today — see
[How a contribution reaches other people](#how-a-contribution-reaches-other-people) for why, and for
what is planned.

---

## Data surfaces

### Themes

Token overrides plus optional CSS, layered over any template. The parametric vocabulary is
`ThemeOverrides`; a theme needing hand-written CSS is a theme the parametric system could not
express, and two of the built-ins (`channels`, `timeline`) exist to find out how far it stretches.

- **Lives in** `packages/design-system/2-themes/src/<name>/`
- **Conventions** [2-themes/CONVENTIONS.md](../../packages/design-system/2-themes/CONVENTIONS.md) — "Adding a New Theme"
- **Copy** `packages/design-system/2-themes/src/cyberpunk/` (CSS + parameters) or `THEME_PRESETS.channels` (parameters only)
- **Register** add to `themeRegistry` in `packages/app-shell/src/shared/registries/themeRegistry.ts`
- **Verify** `pnpm --filter @we/themes test` — the contrast and sanitise suites are the real check

### Shell templates

A whole space interface as a JSON node tree: chrome, arrangement, route table. `meta.role` absent
means shell. Mark where sections go with `{ path: '$views' }` rather than hardcoding routes, and
read `spaceStore.viewNav` rather than writing a nav strip from a literal array — the two lists drift
otherwise, and have.

- **Lives in** `packages/templates/showcase/src/` (or `templates/default/` for the built-in space experience)
- **Conventions** [docs/architecture/views.md](../architecture/views.md) for the shell/view split; the schema reference in `CLAUDE.md` for everything else
- **Copy** `packages/templates/showcase/src/DiscordTemplate.schema.ts`
- **Register** add the id to `we-seed.json`'s `templates`, then `pnpm --filter @we/app-shell generate-templates`
- **Verify** `pnpm validate:schemas`, then `pnpm --filter @we/schema-shared role-audit`

### Views

One section of a space rather than the whole interface — `meta.role: 'view'`. The unit exists
because for most communities the intent is "we want a different feed", not "we want a different
application", and before views the smallest forkable thing was the entire shell.

- **Lives in** `packages/templates/views/src/views/<Name>View/`
- **Conventions** [docs/architecture/views.md](../architecture/views.md)
- **Copy** `packages/templates/views/src/views/AboutView/`
- **Register** add to `CATALOGUE` in `packages/app-shell/scripts/generateViewRegistry.mjs`, add the id to `we-seed.json`'s `views`, then `pnpm --filter @we/app-shell generate-views`
- **Verify** `pnpm validate:schemas`

> A view's **id** is a stable public name — it appears in `we-seed.json`, in `Space.enabledViews`
> and in each agent's hidden list. Its file path is an implementation detail. That is why the
> catalogue is written by hand rather than discovered: deriving the id from the path would make
> moving a file a breaking change for every space that had turned that section off.

### Portable fragments

A named, parameterised _shape_ that expands into plain schema nodes at authoring time. The runtime
never knows fragments exist — what ships is JSON indistinguishable from JSON written by hand, which
is what lets a template outlive the kit it was built from.

Portable means **it may not name a store.** `kit.test.ts` reads the source to enforce this. A
fragment naming `spaceStore.members` resolves to nothing on a deployment without that store —
silently — and `package.json` cannot say so.

- **Lives in** `packages/schema-system/kit/src/`
- **Conventions** [templates/kit/CONVENTIONS.md](../../packages/templates/kit/CONVENTIONS.md) — governs both kits
- **Copy** `packages/schema-system/kit/src/states/emptyState.ts`
- **Register** export from `src/index.ts`
- **Verify** `pnpm --filter @we/template-kit test`; update the recipe in `packages/ai-context/src/fragments/patterns.ts` if the expansion changed materially

### WE-domain fragments

The same thing, allowed to name WE's own stores (`profileStore`, `spaceStore`, `runtimeStore`) and
`$agent`. The split into two packages is the kit's honest dependency declaration.

- **Lives in** `packages/templates/kit/src/we/`
- **Conventions** [templates/kit/CONVENTIONS.md](../../packages/templates/kit/CONVENTIONS.md)
- **Copy** `packages/templates/kit/src/we/agentByline.ts`
- **Register** export from `src/index.ts`
- **Verify** `pnpm --filter @we/template-kit test`

---

## Vocabulary surfaces

These are the developer layer. Lowest volume, and load-bearing: modules define the vocabulary, and
the vocabulary sets the ceiling on what every template above can express.

### Design tokens

Spacing, colour, typography, radius, z-index — and the semantic role variables, which are the half
that matters. A theme pins **roles**, not scale positions, so a value naming a step cannot hear what
a theme decided and is invisible to the contrast layer entirely.

- **Lives in** `packages/design-system/1-tokens/src/`
- **Conventions** [1-tokens/CONVENTIONS.md](../../packages/design-system/1-tokens/CONVENTIONS.md) — "Adding a New Token", and "Roles vs scale positions"
- **Register** nothing; the CSS is generated and snapshot-tested
- **Verify** `pnpm --filter @we/tokens test`, then rebuild downstream: `pnpm --filter @we/tokens --filter @we/themes build`

### Primitives

Atomic Lit web components (`we-button`, `we-input`, …). Framework-neutral, which is what makes them
the currency the schema renderer can mount in any framework without a per-framework wrapper.

- **Lives in** `packages/design-system/3-primitives/src/primitives/`
- **Conventions** [3-primitives/CONVENTIONS.md](../../packages/design-system/3-primitives/CONVENTIONS.md) — event naming, base class, the variant/size pattern
- **Copy** `packages/design-system/3-primitives/src/primitives/badge.ts`
- **Register** nothing by hand — the custom-elements manifest is generated by `pnpm --filter @we/primitives build`, and `@we/ai-context` reads it from there
- **Verify** `pnpm --filter @we/primitives test`, then `pnpm --filter @we/ai-context generate-context` so the new element reaches the component registry in `CLAUDE.md`

### Components

Solid layout and composite components (`Column`, `Row`, `Grid`, `Card`, `AvatarStack`). Split as
`.types.ts` (agnostic) + `.solid.tsx` (framework), so a second framework adapter implements the
types rather than re-deriving them.

- **Lives in** `packages/design-system/4-components/src/components/<group>/`
- **Conventions** [design-system/CONVENTIONS.md](../../packages/design-system/CONVENTIONS.md) — especially "Does this deserve to be code at all?"
- **Copy** `packages/design-system/4-components/src/components/people/AvatarStack/`
- **Register** add to `componentRegistry.tsx` in `packages/app-shell/src/frameworks/solid/registries/`
- **Verify** `pnpm --filter @we/components test`, then `generate-context`

### Widgets

The highest design-system layer — composition above widgets is the schema system's job. Currently
empty by design: its one widget was retired once `@we/template-kit`'s rail fragments replaced it,
and **feature widgets live with their module family**, not here. Read that as a strong prior that
what you have is a fragment or a module rather than a widget.

- **Lives in** `packages/design-system/5-widgets/src/`
- **Conventions** [design-system/CONVENTIONS.md](../../packages/design-system/CONVENTIONS.md) — "Widget-Specific Patterns"

### Block types

A composable content unit a user arranges within a page — text, image, embed, code, task, event.
Blocks are stored as models, so a new block type is usually a new model too.

- **Lives in** `packages/block-system/shared/src/` (registration, model) + `frameworks/solid/src/` (input + display components)
- **Conventions** [block-system/CONVENTIONS.md](../../packages/block-system/CONVENTIONS.md) — "Adding a New Block Type", and read "Common Mistakes" before starting
- **Copy** the `image` block registration in `packages/block-system/shared/src/core-blocks.ts`
- **Register** `registerBlock()` in `core-blocks.ts`; components via `registerCoreBlockComponents()`
- **Verify** `pnpm --filter @we/block-shared test` and `pnpm --filter @we/block-solid typecheck`

### Expression functions

Computation the expression language's library lacks. The grammar itself — references, operators,
comprehensions — is closed and is not a contribution surface; what grows is the function library
(`count`, `filter`, `plural`, `pick`, …), and every function is available to every template ever
written, so removing one is breaking. Pure and total only: wrong-typed input answers with the empty
value of its kind, never a throw. Three real uses before adding one, as for a component.

- **Lives in** `packages/schema-system/shared/src/expressions/functions.ts`
- **Conventions** [schema-system/CONVENTIONS.md](../../packages/schema-system/CONVENTIONS.md) — "Adding a function to the expression library"
- **Copy** `plural` in `functions.ts`
- **Register** `defineFunction({ name, category, params, doc, example, impl })` — the registry is the declaration; the validator, the evaluator and the generated context all read it
- **Verify** `pnpm --filter @we/schema-shared test`, then `generate-context` (the library table in the schema reference comes from the registry)

A function this deployment alone needs is a **host source** instead — registered in
`packages/app-shell/src/shared/sources/index.ts`, catalogued under "Host functions" in the generated
context, and known to the validator from there.

### Stores

State and actions the app shell holds — and, because every member is reachable from a template via
`$store`/`$action`, **schema-facing public API**. Name members for template authors rather than for
the code that calls them, and treat a removal as breaking.

This surface has the strictest registration on the page, and both halves fail the build rather than
failing quietly, which is deliberate: a store member is vocabulary, and undeclared vocabulary is
either invisible or dangerous.

- **Lives in** `packages/app-shell/src/frameworks/solid/stores/`
- **Conventions** [app-shell/CONVENTIONS.md](../../packages/app-shell/CONVENTIONS.md) — the provider nesting order is load-bearing: a store may read stores above it, never below
- **Register** classify it in [`templateSurface.ts`](../../packages/app-shell/src/shared/registries/templateSurface.ts) — an unclassified member fails `templateSurface.test.ts` — **and** describe it in `packages/ai-context/src/fragments/stores.ts`, where a stale entry fails `generate-context`
- **Verify** `pnpm --filter @we/app-shell test`, then `generate-context`

> Classification is a security decision, not bookkeeping. Before the allowlist existed, every member
> of every store was in the bag a template rendered against — 388 of them, including
> `runtimeStore.trustAgent`, `accountStore.removeAccount` and the agent settings holding the API key.
> A template that merely _painted_ could log you out or trust an attacker's DID. Put a new member in
> the narrowest group that works.

### Models

A kind of thing that gets stored. The **manifest is the source of truth** and the decorated AD4M
classes are build artifacts — edit the manifest, then run both generators.

- **Lives in** `packages/entities/src/manifest/`
- **Conventions** [entities/CONVENTIONS.md](../../packages/entities/CONVENTIONS.md), and
  [docs/architecture/relations.md](../architecture/relations.md) **before adding any relation between two entities**
- **Copy** `packages/entities/src/manifest/Signal.ts`
- **Register** `pnpm --filter @we/entities generate:types` **and** `pnpm --filter @we/backend-ad4m generate:classes`
- **Verify** `pnpm --filter @we/backend-ad4m test` — `coreManifest.test.ts` holds the generated classes and the manifest in exhaustive agreement, so a stale generation fails there

---

## Capability surfaces

### Feature modules

A bundle of **stateful capability** that installs into a space: calls, notes, transcription, the
globe, the graph. A module declares what it contributes and the shell decides where it renders.
A module never imports the shell; the shell never imports a module directly.

Prefer contributing **schema fragments over components**. A module with no framework imports cannot
suffer the second-runtime problem — an externally-loaded bundle carrying its own copy of a reactive
framework gets a second one, and reactivity silently stops crossing the boundary, with no error.
Fragments-first is what will make dynamic loading tractable later.

- **Lives in** `packages/module-system/<id>/`
- **Conventions** the contract itself — `packages/module-system/shared/src/module.ts` is deliberately exhaustive and is the documentation
- **Copy** `packages/module-system/notes/` — it takes nothing from the host and imports no framework, so it is the honest minimal case
- **Register** add to `bundledModules` in `packages/app-shell/src/shared/registries/bundledModules.ts`, and add the id to `we-seed.json`'s `modules`
- **Verify** `pnpm --filter @we/module-shared test`, `pnpm validate:schemas` (it covers `module-system/`)

> A module needing a specific backend declares it (`backends: ['ad4m']`). Everything else stays
> backend-neutral through the ports, and `@coasys/*` may not be imported anywhere else.

### Graph plugins

An **expander** answers "what is adjacent to this kind of node" and the engine does the rest — dedup,
expansion state, collapse, layout, rendering. Adding a new source of nodes is an expander, not a
change to the core. Layouts, renderers and behaviours plug in the same way.

- **Lives in** `packages/graph-system/expanders/src/` (or `layouts/src/`)
- **Conventions** [graph-system/CONVENTIONS.md](../../packages/graph-system/CONVENTIONS.md) — read "What gets exposed" and "Invariants worth protecting" first
- **Copy** `packages/graph-system/expanders/src/collection.ts`
- **Register** export from the package index, **and add an entry to `GRAPH_PLUGIN_CATALOG`** in `packages/module-system/graph/src/catalog.ts`
- **Verify** `pnpm --filter @we/graph-core test`, then `generate-context`

> The catalog step is not optional bookkeeping. Props tell an author that `layout.type` is a string;
> nothing in a prop list says which strings exist, and a plugin nobody can name might as well not be
> registered. The globe is the cautionary case — its layer protocol is good, and no catalog of layer
> names ever reaches the generated context, so an LLM cannot author a globe template.

### Globe layers

A layer on the Cesium globe — surface layers (points, country outlines, H3 hexagons) and background
layers (skybox, stars, solar system).

- **Lives in** `packages/module-system/globe/layers/src/planet/` or `background/`
- **Conventions** [globe/layers/README.md](../../packages/module-system/globe/layers/README.md) and its `EXAMPLES.md`
- **Register** export from `src/index.ts`
- **Verify** `pnpm --filter @we/globe-layers typecheck`

---

## Foundation surfaces

### Seeds

What a deployment _is_: which modules, templates and views ship, which apps are embedded, how the
executor is wired, what the shell is white-labelled to. Nothing needs to be written — a seed selects
from what exists. White-labeling a deployment is a matter of swapping the seed.

- **Lives in** `we-seed.json`; examples in `seed-examples/`
- **Conventions** [getting-started/seed-system.md](../getting-started/seed-system.md); the shape's source of truth is `packages/app-shell/src/types/seed.ts`
- **Verify** `pnpm validate:seed`

### Backend adapters

WE over something that isn't AD4M. Implement the ports in `@we/backend-shared` — `DataSource` +
`QueryAdapter`, ephemeral, presence, transcription, model manifest — and register your model
implementations in the entity proxy registry. Consumers never learn which backend they are on.

- **Lives in** `packages/backend-system/<name>/`
- **Conventions** [backend-system/shared/README.md](../../packages/backend-system/shared/README.md)
- **Copy** `packages/backend-system/inmemory/` — the reference implementation, and how stores test without an executor
- **Verify** `pnpm --filter @we/backend-inmemory test` as the shape to match

### Platform hosts

WE on a new platform. A host is thin: a `PlatformAdapter` (where am I running) and a
`BackendConnector` (how do I reach the data layer), over `@we/app-shell`.

- **Lives in** `apps/<name>/`
- **Copy** `apps/we-web/` — the smallest of the three
- **Verify** `pnpm --filter <app> build`

---

## Verifying your work

Four checks cover most surfaces, and three of them are not widely known:

```sh
pnpm validate:schemas                          # every .schema.ts in shell, default, views, showcase, modules
pnpm --filter @we/schema-shared role-audit     # colours naming a scale position where a role belongs
pnpm --filter @we/schema-shared surface-audit  # what each surface-sunken is actually sitting on
pnpm validate:seed                             # we-seed.json against its schema
```

`role-audit` and `surface-audit` import and walk the **composed** tree, so they attribute nodes a
fragment from another package contributed — which no grep over source can do. Run them after any
template, view or fragment change.

Then scope the rebuild to what you touched. A full `pnpm build` walks the monorepo and takes
minutes; reserve it for the end. But **do** rebuild — a stale `dist` is invisible and costs more
time than the build saves. See "Rebuilding — scope it to what changed" in `CLAUDE.md`.

**Do not stand up a full AD4M executor to check a UI change.** Typecheck, validate, run the package's
tests, and read the composed output. Most of what an executor would tell you is already asserted
somewhere cheaper.

---

## How a contribution reaches other people

This is the part to be honest about, because the gap between the design and the implementation is
wide and is easy to mistake for a documentation problem.

**Templates and themes are genuinely installable today.** They are pure data, they are distributed
as AD4M expressions, and they pass through a real trust boundary on the way in:

- [`templateSurface.ts`](../../packages/app-shell/src/shared/registries/templateSurface.ts) is the
  allowlist of what a template may name, grouped into capabilities written in the words a person
  would read at install time. Anything not granted is _absent_ rather than blocked, so a hostile
  template gets no error channel to probe.
- [`templateAcceptance.ts`](../../packages/app-shell/src/shared/templateAcceptance.ts) is the ingest
  gate: structurally broken schemas are refused outright, and references past the tier are admitted
  but reported, because a quietly half-broken template looks exactly like one that is fine.

**Everything else on this page ships by merging into this repository.** Feature modules are bundled
rather than dynamically loaded. The reason used to be given as the second-runtime problem above; that
is solved — `createStore(deps)` injects the reactivity primitives — and the reason that remains is
trust: a store factory is arbitrary JavaScript with access to the ports the host hands it, and the
capability model covers what a _schema_ may name, not what code may do.

So: **three of nineteen surfaces have an out-of-repo path** (templates, themes, views), and a module
author must clone the monorepo. That is the real ceiling on outside contribution right now, and it is
a code problem rather than a docs one.

How it changes is the subject of
[internal/plans/module-marketplace.md](../internal/plans/module-marketplace.md), which places every
surface on this page on a **distribution ladder** — pure data, declared data + fragments, sandboxed
embed, host-provided capability kernels, code — and says which rung each can reach and what moves
it. The short version: sections, content types and (with research) modules can come down the ladder;
primitives, components, plugins and stores are code and stay merge-only by decision. Nothing
`import()`s a bundle from an expression, at any rung. **When the marketplace grows a type enum, it is
derived from this page's list and carries the rung**, so the slots people can contribute, the slots
the marketplace distributes, and what an install screen says is being trusted stay one list.

---

## Where you're standing

WE is not a framework where developers build modules and everyone else consumes them. The widest
rungs need no code at all, and the volume is inverted from what a developer expects.

**Using WE, no code.** Reshape your own space; build a template or theme that fits how your group
actually works, in the browser, and share it. This is the highest-volume and most under-served
contribution in the ecosystem. Nothing on this page is required reading.

**Authoring templates and themes seriously.** You want the schema reference — the Component Registry,
Design Tokens and Schema Operators sections of `CLAUDE.md`, which are generated from the code and are
always current. Then [Themes](#themes), [Shell templates](#shell-templates) and [Views](#views) above.

**Contributing to this repo.** Start at [docs/architecture/codebase-map.md](../architecture/codebase-map.md)
for the layering, then the surface you want above, then that surface's `CONVENTIONS.md`. Branch from
`dev`, never `main`. Read [CONTRIBUTING.md](../../CONTRIBUTING.md) for the workflow.

**Building a deployment on WE.** You mostly want [Seeds](#seeds) — and to discover that you need
fewer new surfaces than you expected, since a seed selects from what already exists.

---

## Keeping this page honest

A hand-maintained list of surfaces drifts. `packages/ai-context/src/tests/ai-context.test.ts` asserts
that every `CONVENTIONS.md` in the repo is referenced here and that every path this page names
exists, so a new authoring-rules file or a moved reference example fails the test until this page
catches up.

That is the same discipline the rest of the repo uses on its own documentation —
`templateSurface.test.ts` failing on an unclassified store member, `generate-context` failing on a
`fragments/stores.ts` entry that no longer resolves. A list nothing checks is a list that is wrong
within two months.

The router in `packages/ai-context/src/fragments/contribution-surfaces.ts` is a compressed version of
this page and ships in `CLAUDE.md` / `AGENTS.md`. **When you add a surface here, add its row there
too** — it is deliberately short, so it stays a table of pointers rather than a second copy of this
page.
