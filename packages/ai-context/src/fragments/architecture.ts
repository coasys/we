/**
 * Architecture orientation fragment.
 *
 * Like dev-patterns, this is included in IDE instruction files
 * (copilot-instructions.md, CLAUDE.md, cursor rules) but intentionally EXCLUDED
 * from the in-app AI context (schemaContext.ts) — an AI editing JSON templates
 * doesn't need the codebase's project/runtime/package internals.
 *
 * This is the high-level map an agent needs BEFORE working on the codebase (as
 * opposed to authoring schemas): what WE is, what it runs on (AD4M), the core
 * product concepts, how the packages layer, and how a schema becomes DOM. Keep it
 * concise — it's a map, not a manual. Deep dives belong in docs/ARCHITECTURE.md.
 *
 * Hand-authored (narrative, slow-changing, not derivable from code). When the
 * product model, runtime, package roles, or render pipeline change, update by hand.
 */

export const architecture = `
## Architecture Orientation (codebase work — not for JSON schema authoring)

### What WE is

WE is a **composable module ecosystem for building decentralized applications** — the UI
layer of a three-part stack: **WE** (design system + module marketplace) on **AD4M** (data,
meaning, agent coordination) on **Holochain** (trust/validation/sync). Contributors build
*modules* (tokens → elements → components → widgets → pages → templates, plus blocks, themes,
and feature modules), not monolithic apps. A deployment is described by a **seed file**
(\`we-seed.json\`): which modules to include, how to arrange/theme them, and platform settings.
UIs are **JSON schemas** rendered live against a component registry — no bespoke UI code for
standard patterns. (Flux is the reference application built on WE.) See VISION.md for the full
rationale.

### Runtime: built on AD4M

WE's data layer is **AD4M** — an agent-centric, local-first, peer-to-peer meta-ontology.
Data is yours, stored locally and synced P2P (via Holochain) with no central server. The Solid
app (\`@we/app-framework\`, hosted by the web/electron/tauri targets) talks to an **AD4M executor**
(the ad4m runtime; \`@coasys/ad4m\` + \`ad4m-connect\`) that holds perspectives and syncs
neighbourhoods. Stores (\`adamStore\`, \`spaceStore\`, …) wrap the AD4M client and expose reactive
state to schemas.

Glossary (these terms pervade stores, models, and \`$query\`/\`perspective\` in schemas):
- **Agent / DID** — a user identity; addressed by a DID (\`adamStore.me.did\`).
- **Perspective** — a local knowledge graph (links/triples). Each Space is backed by one;
  \`adamStore.currentPerspective\` is the active one, \`rootPerspective\` holds we-root models.
- **Neighbourhood** — a *shared* perspective, synced peer-to-peer. A shared Space is a neighbourhood.
- **SDNA (Social DNA)** — SHACL schemas installed into a perspective that define its data model.
  WE's models are SDNA-typed; \`initializeAsWeSpace\` installs WE's Space SDNA into a foreign perspective.
- **Expression / Language** — an AD4M content object addressed by a URL, stored/retrieved via a
  Language plugin (e.g. images go through FILE_STORAGE_LANGUAGE → an expression URL).
- **Model (Ad4mModel)** — WE's ORM over perspective links (\`Space.create\`, \`findAll\`, \`include\`, …);
  SDNA/SHACL-typed classes. See dev-patterns for CRUD conventions.

### Core product concepts

- **Space** — a community/context, backed by an AD4M perspective. *Personal* (local) or *shared*
  (a neighbourhood). Has a default template + theme.
- **Template** — a full UI **schema** (the JSON node tree). A Space renders a Template. Installable/shareable.
- **Theme** — token overrides + CSS layered over a template for visual identity. Installable/shareable.
- **Block** — a composable content unit (TextBlock, ImageBlock, EmbedBlock, …) authored via the block
  composer and stored as models. Blocks compose into posts/pages.
- **Signal** — a per-community reaction/vote. A \`SignalType\` (created per space) defines it; \`Signal\`
  instances attach to any \`WeNode\`.

### Package Map

| Package | Dir | Role | Framework coupling |
|---|---|---|---|
| \`@we/tokens\` | design-system/1-tokens | Design tokens (spacing, color, radius, …) as CSS vars / JS | Agnostic |
| \`@we/themes\` | design-system/2-themes | Theme definitions layered over tokens | Agnostic |
| \`@we/primitives\` | design-system/3-primitives | UI primitives (\`we-button\`, \`we-input\`, …) | **Lit web components — agnostic** |
| \`@we/components\` | design-system/4-components | Layout & composite components (Column, Row, Card, …) | Solid (\`.types.ts\` + \`.solid.tsx\`) |
| \`@we/widgets\` | design-system/5-widgets | Large feature widgets (globe, graph, sidebar) | Solid |
| \`@we/design-utils\` | design-system/utils | Shared DS-props → style computation; token resolvers | Neutral core + \`/solid\` binding |
| \`@we/design-types\` | design-system/types | Shared DS prop/type definitions | Agnostic |
| \`@we/schema-shared\` | schema-system/shared | Schema semantics: prop resolvers, validation, registry types, reactivity port | **Agnostic** |
| \`@we/schema-solid\` | schema-system/frameworks/solid | The schema renderer (walks the tree, mounts components) | Solid (thin adapter) |
| \`@we/block-shared\` | block-system/shared | Block content types + serialization | Agnostic |
| \`@we/models\` | packages/models | AD4M data models (Space, Block subclasses, …) | Agnostic |
| \`@we/app-framework\` | packages/app-framework | App shell, stores, built-in template schemas, AD4M wiring | Solid |
| \`@we/ai-context\` | packages/ai-context | Generates this reference (CLAUDE.md et al.) from code + fragments | Build tool |

Apps (\`apps/we-web\`, \`apps/we-electron\`, \`apps/we-tauri\`) are thin hosts over \`@we/app-framework\`.

### The Three Seams (why the layering holds)

1. **Primitives are the framework-neutral currency.** \`@we/primitives\` are Lit web components, so
   they render as plain custom-element tag strings in any framework. The schema renderer sets their
   props/events generically — no per-framework wrapper is needed for the render path. (Typed
   per-framework *declarations* are generated from the Custom Elements Manifest for hand-authored
   code — a DX layer, not a runtime one.)

2. **Schema semantics live in \`@we/schema-shared\`, parameterized by a reactivity port.** All token
   resolution (\`$store\`, \`$if\`, \`$query\`, \`$local\`, \`$action\`, …) is in \`propResolvers/\`.
   \`resolveProp(value, stores, context, memo)\` takes a framework-injected memoization function
   (\`memo\`), and \`markReactive()\` (see \`propResolvers/reactive.ts\`) tags accessors so a renderer
   knows a prop is reactive. The entire schema engine AND its reactivity wiring are framework-neutral;
   a framework only injects its signal primitive.

3. **The renderer is a thin per-framework adapter over a component registry.** \`@we/schema-solid\`
   walks the schema tree, resolves props with Solid's \`createMemo\` as \`memo\`, maps
   \`$each\`/\`$if\`/\`$routes\` onto \`<For>\`/\`<Show>\`/\`<Dynamic>\`, and mounts each node — a tag string
   for primitives, a registered component for layer-4/5. Adding a framework = a new adapter of this
   shape, NOT re-implementing the semantics.

### Render Pipeline (schema JSON → DOM)

1. A schema node has \`type\` (component/tag name), \`props\`, \`children\`, optional
   \`routes\`/\`slots\`/\`$localState\`/\`$queries\`.
2. Props are resolved by the shared dispatcher (\`propResolvers/dispatcher.ts\`): token objects
   (\`$store\`, \`$if\`, \`$query\`, …) become values or reactive accessors via the injected \`memo\`;
   event-handler arrays resolve lazily at call time.
3. The renderer looks up \`type\` in the \`ComponentRegistry\` — a custom-element tag for
   \`@we/primitives\`, a framework component for \`@we/components\`/\`@we/widgets\`.
4. It mounts the node, binds resolved accessors as reactive props, wires custom events, and recurses
   into children. Block-level \`$\`-types (\`$each\`, \`$if\`, \`$single\`, \`$animate\`, \`$routes\`) map to the
   framework's control-flow primitives.

### Where to look

- Change how a token/operator resolves → \`packages/schema-system/shared/src/propResolvers/\`.
- Change tree-walking / mounting / control flow → \`packages/schema-system/frameworks/solid/src/\`.
- Add/adjust a primitive → \`packages/design-system/3-primitives/src/\` (Lit).
- Add/adjust a layout/composite component → \`packages/design-system/4-components/src/\` (Solid).
- DS-props → CSS logic (shared) → \`packages/design-system/utils/src/index.ts\`; Solid binding → \`.../src/solid/index.ts\`.
- Stores / app shell / AD4M wiring / built-in templates → \`packages/app-framework/src/\`.
- Data models (Space, blocks) → \`packages/models/src/\` (see packages/models/CONVENTIONS.md).

For deeper detail (data sync/persistence, block & editor internals, the local dev/test loop),
see docs/ARCHITECTURE.md.
`;
