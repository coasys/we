/**
 * Contribution surfaces fragment — the router from an intent to the slot it belongs in.
 *
 * Included in IDE instruction files (CLAUDE.md, AGENTS.md, copilot-instructions.md, cursor rules)
 * alongside `architecture` and `dev-patterns`, and intentionally EXCLUDED from the in-app AI context
 * (schemaContext.ts): an AI editing JSON templates in the browser is already standing in exactly one
 * of these surfaces and has no use for the other eighteen.
 *
 * ## Keep this a router, not a manual
 *
 * The authoring rules for every surface here already exist, in that package's `CONVENTIONS.md`.
 * Restating any of them would put each rule in two places, and the drift is one-directional: the
 * file beside the code gets updated when the code changes and this one does not, so the copy here
 * would end up teaching a convention the codebase had abandoned. That is the exact failure
 * `mergeStoreEntries` fails the build over, one layer up.
 *
 * So each row earns its place by holding what a `CONVENTIONS.md` cannot: which of nineteen files to
 * open, the registration step (an unregistered view is written, correct, and invisible), and the
 * cheapest check. Everything else is a path.
 *
 * The long-form version — with the reasoning, the reference examples and the distribution status —
 * is docs/contributing/surfaces.md, and `ai-context.test.ts` holds the two in agreement about which
 * surfaces exist.
 *
 * Hand-authored. When a surface is added, moved, or gains a registration step, update by hand.
 */

export const contributionSurfaces = `
## Contribution Surfaces (codebase work — not for JSON schema authoring)

Where a change belongs. Work down the routing table and stop at the first row that fits: the earlier
rows are cheaper for everyone, and a contribution one rung too high costs more forever.

The spine of every one of these decisions is a single rule, from \`packages/templates/kit/CONVENTIONS.md\`:

> **Code owns only what data cannot express.** Behaviour and focus management, accessibility
> semantics, browser APIs, measurement, performance-critical rendering — that is the whole list.
> Everything above it is arrangement, and arrangement stays data.

### Routing — intent to surface

| The intent | The surface |
|---|---|
| Change how a space looks | **Theme** |
| Change what one section of a space *is* | **View** |
| Change a space's whole chrome, arrangement and route table | **Shell template** |
| Reuse an arrangement across templates | **Fragment** |
| Stateless UI needing measurement, focus or a browser API | **Primitive** (Lit) or **component** (Solid) |
| Component-agnostic schema boilerplate | **Schema operator** |
| A new kind of content composed into a page | **Block type** |
| A stateful capability a community turns on | **Feature module** |
| A new source of nodes, or arrangement, in a graph | **Graph plugin** |
| A new kind of thing that gets stored | **Model** |
| State or an action a template needs to reach | **Store** |
| A differently-shaped deployment | **Seed** (write nothing — select what exists) |

Three distinctions that have each been got wrong at least once:

- **Component vs fragment.** \`AvatarStack\` is a component (overlap maths); the count beside it is a
  fragment. \`we-modal\` is a primitive (focus trap, top layer); the confirm dialog inside it is a
  fragment. The question is never how complicated it is — it is whether it must *do* something or
  merely be *arranged*.
- **Fragment vs operator.** \`field\` stayed a fragment because *which event carries the value* is
  design-system knowledge; an operator would smuggle that table into the schema resolver.
- **Module vs everything else.** A module is **stateful capability** that talks to ports.
  \`@we/module-notes\` and \`@we/module-call\` contain no framework code at all — every piece of their
  UI is a schema fragment. Presentation is not a module.

And overriding all of them: **never extract speculatively.** Three real uses of the same shape, or a
divergence that is already a bug. Two is a coincidence.

### The surfaces

Each row: where it lives → its rules → **what registers it** → what checks it. The registration
column is the one that gets skipped, and its failure is silent — a view that is written but not in
the seed's list is correct code that never appears.

| Surface | Lives in | Rules | Register | Verify |
|---|---|---|---|---|
| Theme | \`design-system/2-themes/src/<name>/\` | its \`CONVENTIONS.md\` | \`themeRegistry.ts\` | \`--filter @we/themes test\` |
| Shell template | \`templates/showcase/src/\` | \`docs/architecture/views.md\` | seed \`templates\` + \`--filter @we/app-shell generate-templates\` | \`validate:schemas\`, \`role-audit\` |
| View | \`templates/views/src/views/\` | \`docs/architecture/views.md\` | \`CATALOGUE\` in \`generateViewRegistry.mjs\` + seed \`views\` + \`generate-views\` | \`validate:schemas\` |
| Portable fragment | \`schema-system/kit/src/\` | \`templates/kit/CONVENTIONS.md\` | export from \`index.ts\` | \`--filter @we/template-kit test\` |
| WE-domain fragment | \`templates/kit/src/we/\` | \`templates/kit/CONVENTIONS.md\` | export from \`index.ts\` | \`--filter @we/template-kit test\` |
| Design token | \`design-system/1-tokens/src/\` | its \`CONVENTIONS.md\` | — (generated, snapshot-tested) | \`--filter @we/tokens test\` |
| Primitive | \`design-system/3-primitives/src/primitives/\` | its \`CONVENTIONS.md\` | — (CEM generated by its build) | \`--filter @we/primitives test\`, then \`generate-context\` |
| Component | \`design-system/4-components/src/components/\` | \`design-system/CONVENTIONS.md\` | \`componentRegistry.tsx\` | \`--filter @we/components test\`, then \`generate-context\` |
| Block type | \`block-system/shared/\` + \`frameworks/solid/\` | \`block-system/CONVENTIONS.md\` | \`registerBlock()\` in \`core-blocks.ts\` | \`--filter @we/block-shared test\` |
| Schema operator | \`schema-system/shared/src/propResolvers/\` | \`schema-system/CONVENTIONS.md\` (6-step checklist) | \`dispatcher.ts\` + \`OperatorToken\` union + \`index.ts\` | \`--filter @we/schema-shared test\`, then document in \`fragments/schema-operators.ts\` |
| Store | \`app-shell/src/frameworks/solid/stores/\` | \`app-shell/CONVENTIONS.md\` | classify in \`templateSurface.ts\` **and** describe in \`fragments/stores.ts\` — both fail the build if you don't | \`--filter @we/app-shell test\`, then \`generate-context\` |
| Model | \`models/src/manifest/entities/\` | \`models/CONVENTIONS.md\` + \`docs/architecture/relations.md\` | \`--filter @we/models generate:types\` **and** \`--filter @we/backend-ad4m generate:classes\` | \`--filter @we/backend-ad4m test\` |
| Feature module | \`module-system/<id>/\` | \`module-system/shared/src/module.ts\` (the contract is the documentation) | \`bundledModules.ts\` + seed \`modules\` | \`--filter @we/module-shared test\`, \`validate:schemas\` |
| Graph plugin | \`graph-system/expanders/src/\`, \`layouts/src/\` | \`graph-system/CONVENTIONS.md\` | package index **and** \`GRAPH_PLUGIN_CATALOG\` in \`module-system/graph/src/catalog.ts\` | \`--filter @we/graph-core test\`, then \`generate-context\` |
| Globe layer | \`module-system/globe/layers/src/\` | its \`README.md\` / \`EXAMPLES.md\` | export from \`index.ts\` | \`--filter @we/globe-layers typecheck\` |
| Seed | \`we-seed.json\` | \`docs/getting-started/seed-system.md\` | — | \`pnpm validate:seed\` |
| Backend adapter | \`backend-system/<name>/\` | \`backend-system/shared/README.md\` | entity proxy registry | model the \`inmemory\` package |
| Platform host | \`apps/<name>/\` | — | — | \`--filter <app> build\` |

Widgets (\`design-system/5-widgets\`) are the nineteenth and are **currently empty by design**: the one
widget there was retired once template-kit's rail fragments replaced it, and feature widgets live
with their module family. Treat that as a strong prior that what you have is a fragment or a module.

**A store member is public API, and classifying it is a security decision.** Every member is
reachable from any template via \`$store\`/\`$action\`, so name it for template authors and treat removal
as breaking. Before \`templateSurface.ts\` existed, all 388 members were in the bag a template rendered
against — including \`runtimeStore.trustAgent\` and the settings holding the API key — so a template
that merely *painted* could trust an attacker's DID. Put a new member in the narrowest group that
works.

**The graph catalog entry is not bookkeeping.** Props tell an author that \`layout.type\` is a string;
nothing in a prop list says which strings exist, so a plugin nobody can name might as well not be
registered. The globe is the cautionary case — its layer protocol is good, no catalog of layer names
reaches the generated context, and so an LLM cannot author a globe template.

### Distribution — what is real

**Templates and themes install at runtime**, from a stranger, through a real trust boundary:
\`templateSurface.ts\` allowlists what a template may name (grouped into capabilities written in the
words a person reads at install time; anything not granted is *absent* rather than blocked, leaving
no error channel to probe), and \`templateAcceptance.ts\` refuses structurally broken schemas outright
while admitting-and-reporting references past the tier.

**Every other surface ships by merging into this repo.** Feature modules are bundled rather than
dynamically loaded — deliberately: a dynamically-loaded bundle carrying its own reactive runtime gets
a *second* one, and reactivity silently stops crossing the boundary. Blocks and components have a
design in \`docs/internal/plans/module-marketplace.md\` and no implementation.

Two of nineteen surfaces have an out-of-repo path. Do not describe the marketplace as though it
covers the rest.

The long-form guide — reference example per surface, the reasoning, the full distribution status —
is \`docs/contributing/surfaces.md\`. \`CONTRIBUTING.md\` covers the workflow.
`;
