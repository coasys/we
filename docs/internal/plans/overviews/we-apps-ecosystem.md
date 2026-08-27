# Plan: WE Apps Ecosystem — Templates, Blocks, Components & Marketplace

> Consolidated plan for how users build, share, customise, and distribute WE apps (templates/experiences) and their constituent parts (blocks, components, themes). Supersedes previous experience-sharing system docs.

> **Status (Aug 2026): design document, partly overtaken.** Its four marketplace tiers predate
> views, template fragments, feature modules, graph plugins and globe layers — the current inventory
> is [`docs/contributing/surfaces.md`](../../../contributing/surfaces.md), which lists nineteen
> surfaces. `defineAppStore()` was never built; module stores are `createStore(deps)` published under
> `modules.<id>.*` (`packages/module-system/shared/src/module.ts`). The `$query` layer and the
> capability/trust model did ship — see `templateSurface.ts`. Several links point at per-PR plans
> deleted as they landed. Read it for the distribution reasoning, not as a description of the code.

---

## Vision

A WE app is a **schema + its data dependencies**. Schemas are JSON — freely shareable, AI-editable, forkable. Data lives in AD4M perspectives via block models. The core component library handles most UI needs. `$query` eliminates data-fetching stores, `$localState` + `$validate` eliminate form stores, and `$local`/`$setLocal` cover most ephemeral UI state — so custom stores are only needed for genuinely complex cross-component interaction state (undo/redo, drag-and-drop with DOM measurement, real-time playback, etc.).

Users can:

- **Browse** a gallery of built-in and community templates
- **Activate** a template → sectioned copy stored in AD4M (see [schema-customization-architecture](schema-customization-architecture.md))
- **Customise** via AI or manual editing (section-level granularity)
- **Fork** someone else's app into their own version
- **Extract** a widget/route/section and splice it into their own dashboard
- **Share** full apps or individual sections with others
- **Publish** to a marketplace for others to discover

AI agents assist throughout — building schemas, editing sections, validating output — via MCP tools backed by `@we/ai-context` (see [ai-context-package](ai-context-package.md) and [mcp-tools](mcp-tools.md)).

---

## Core Principle: Schema Tokens Eliminate Most Custom Stores

This is the single most important architectural insight. The schema system's declarative tokens handle the vast majority of app state without custom store code:

- **Data-fetching state** → `$query` binds schemas to AD4M data reactively
- **Form input state** → `$localState` / `$local` / `$setLocal` manage ephemeral form values scoped to component lifecycle
- **Form validation** → `$validate` declares rules (required, pattern, min/max) directly on inputs; the renderer manages touched/dirty/error state automatically
- **UI toggles & selection** → `$localState` covers booleans, active IDs, selected arrays
- **Computed/derived values** → `$map`, `$pick`, `$if` compose existing state without stores

Custom stores (`defineAppStore()`) are for genuinely complex interaction state that is ephemeral, shared across components, and requires imperative logic — things like undo/redo history, drag-and-drop with DOM constraints, audio playback queues.

### Example: Spotify clone state analysis

| State concern        | How it's handled                                                    | Custom store needed? |
| -------------------- | ------------------------------------------------------------------- | -------------------- |
| Track list           | `$query: { model: "AudioBlock" }`                                   | No                   |
| Playlists            | `$query: { model: "CollectionBlock", where: { role: "playlist" } }` | No                   |
| Creating tracks      | `$action: "query.create"`                                           | No                   |
| Current route        | `$store: "routeStore.currentRoute"` (built-in)                      | No                   |
| Theme/styling        | Theme section or `$store: "themeStore"` (built-in)                  | No                   |
| Audio playback       | Component-internal (HTML5 audio element)                            | No                   |
| Play queue / shuffle | Cross-component ephemeral state                                     | **Yes**              |

One custom store (play queue) out of seven state concerns. The rest is handled by `$query` against AD4M data, `$localState` for UI toggles, and built-in framework stores.

### The pattern for most WE apps

```
WE App = Block Types + Schema + (optionally) Custom Components + (rarely) Custom Store
```

Where:

- **Block Types** = AD4M data models, reusable across apps
- **Schema** = JSON UI definition (the actual "app")
- **Custom Components** = UI pieces not in the core library (rare if core is comprehensive)
- **Custom Store** = complex ephemeral cross-component interaction state (undo/redo, drag-and-drop, playback queues). Custom stores are common for highly interactive apps but unnecessary for content-display and form-based apps.

---

## The Four Marketplace Tiers

The marketplace has natural tiers ordered by frequency/complexity:

### Tier 1: Templates & Sections (JSON) — most common

These are the "apps." Pure JSON, freely shareable, no code execution concerns. With the [sectioned architecture](schema-customization-architecture.md), you can share:

- **Full templates** — complete app (all sections)
- **Individual sections** — a single route, sidebar layout, theme, or panel
- **Section groups** — e.g. "my entire navigation setup"

A template declares its dependencies:

```json
{
  "meta": {
    "name": "Harmony Music",
    "description": "A music player experience",
    "author": "did:key:z6Mk...",
    "version": "1.0.0",
    "schemaVersion": "1.0",
    "forkedFrom": null
  },
  "dependencies": {
    "blocks": ["AudioBlock", "PlaylistBlock"],
    "components": [],
    "stores": []
  },
  "sections": ["..."]
}
```

Most templates have `components: []` and `stores: []` — they use core components and `$query` for state.

**Trust model:** Schemas are inert JSON. They can reference components or stores that don't exist, but the system renders a placeholder — never executes untrusted code. Schemas are safe to share freely.

### Tier 2: Block Types (AD4M models) — the data ecosystem

New block types are how the data ecosystem grows. Block types are **reusable across apps** — an AudioBlock is useful to any music experience, a CalendarEventBlock to any calendar.

```typescript
@Model({ name: 'AudioBlock' })
class AudioBlock extends WeNode {
  @Property({ through: 'we://has_title', required: true })
  title: string = '';

  @Property({ through: 'we://has_artist' })
  artist: string = '';

  @Property({ through: 'we://has_audio_url', required: true })
  audioUrl: string = '';

  @Property({ through: 'we://has_duration' })
  duration: number = 0;
}
```

Key benefit: once a block type is added to a perspective, AD4M's SHACL system **automatically generates MCP tools** for it (`audioblock_create`, `audioblock_query`, `audioblock_get`, etc.). An AI agent can immediately CRUD instances without additional work.

**Distribution:** Block models live in `@we/models`, editor components in `@we/components`/`@we/widgets`, and editor wiring in `@we/block-system`. Community block packages ship model + component and call `registerBlock()` from `@we/block-system`. See [block-model-migration](../prs/block-model-migration.md) for the three-layer architecture. Community block types via npm initially, AD4M-native later.

### Tier 3: Components & Widgets (JS bundles) — rare if core is strong

If the core library (`@we/primitives` + `@we/components` + `@we/widgets`) is comprehensive, most apps won't need custom components. But gaps will exist — audio waveform visualiser, code editor, 3D viewer, specialised charts.

These are executable JS bundles, so they require the trust/capability pipeline:

- Capability declarations in manifest
- User consent before installation
- Gated access to stores and query service

**Distribution:** npm/URL initially (ESM dynamic `import()`), AD4M-native later when there's real demand.

### Tier 4: Themes (JSON token overrides) — simplest to share

Just design token overrides. No code, no models. Stored as `theme` sections in the sectioned architecture.

```json
{
  "key": "theme",
  "sectionType": "theme",
  "schemaJson": {
    "colorOverrides": { "primary-500": "#8b5cf6" },
    "fontOverrides": { "heading": "Inter" },
    "spacingScale": 1.0
  }
}
```

Trivially shareable. Can be applied to any template.

---

## `$query` — The Data Binding Layer

### Current state

`$query` is **not yet implemented**. The schema dispatcher currently supports 13 tokens across two categories:

**Prop-level tokens** (resolve within prop values):
`$store`, `$action`, `$concat`, `$map`, `$pick`, `$if`, `$not`, `$eq`, `$ne`, `$and`, `$or`

**Node-level tokens** (appear as `type` on SchemaNode):
`$forEach`, `$routes`

`$expr` has been **removed** — it used `new Function()` for arbitrary JS evaluation, which is unvalidatable, CSP-incompatible, and AI-unfriendly. All uses replaced by `$concat` (string building) and `$if` (fallback logic). See [concat-remove-expr](../prs/concat-remove-expr.md).

Three block models exist: TextBlock, ImageBlock, CollectionBlock (expanding to 13 — see [core-block-types](../prs/core-block-types.md)).

### Token governance

**Tier 1 — Stable core (14 tokens after `$query` lands):**
`$store`, `$action`, `$concat`, `$map`, `$pick`, `$if`, `$not`, `$eq`, `$ne`, `$and`, `$or`, `$forEach`, `$routes`, `$query`

**Tier 2 — Deferred until sections exist:**
`$localState`, `$local`, `$setLocal`, `$validate` — unlock AI-generated interactive forms with built-in validation within schema sections. `$validate` eliminates the most common reason to reach for a custom store (form validation). Gate on: sections exist AND 2+ real templates demonstrate the need.

**Tier 3 — Not tokens (solve differently):**
`$section` (root-level config, not an operator), theme overrides (component props), `$derived` (covered by `$map`/`$pick`).

**Gating principle for new tokens:** "New tokens require demonstrated need across 3+ real templates, AND cannot be reasonably expressed with existing tokens." Each token adds resolver logic, Zod schema, tests, AI context, and documentation — so the bar is intentionally high.

### Versioning contract

The schema language and its dependencies follow additive-only evolution:

- **Schema language version** (`schemaVersion` in template meta): Semver string, currently `"1.0"`. New tokens increment the minor version (e.g. `"1.1"` when `$localState` lands). Validators use this to warn on tokens that don't exist in the declared version. Old schemas always work with new renderers — new tokens are added, never removed or changed.
- **Block type evolution**: AD4M model fields have defaults, so adding a field to a block type is additive-safe. Old data returns the default value for new fields. `$query` returns it; `$if`/`$not` handle falsy naturally. Removing or renaming fields is a breaking change and requires a new model name.
- **Package versioning**: `PackageManifest.version` uses semver. Templates pin dependency versions. Two templates can reference different package versions simultaneously — the registry loads both. Full migration tooling is future work (Phase 6+), but version fields exist from day one.

### How `$query` works

A new schema token that declaratively binds to AD4M model data:

```json
{
  "type": "TrackList",
  "props": {
    "tracks": {
      "$query": {
        "model": "AudioBlock",
        "where": { "artist": "Radiohead" },
        "order": { "title": "ASC" },
        "limit": 50
      }
    }
  }
}
```

### Query service implementation

A thin bridge (~120 lines) between Ad4mModel and Solid's reactivity:

```typescript
import type { Query, Where, Order, ParentScope, IncludeMap } from '@coasys/ad4m';

// $query params = Ad4mModel's Query type + a model name string.
// No WE-specific Where/Order/ParentScope types — use Ad4mModel's directly.
// The only addition is `model` (Ad4mModel uses class-level .query(), JSON needs a name).
type QueryParams = Query & { model: string };

// Ad4mModel's types for reference (not redefined here):
//   Where:       { [prop]: value | { gt, lt, gte, lte, contains, between, not } }
//   Order:       { [prop]: "ASC" | "DESC" }
//   ParentScope: { id: string; predicate: string } | { model: typeof Ad4mModel; id: string; field?: string }
//   IncludeMap:  { [relation]: true | { where?, order?, limit?, include? } }

interface QueryService {
  subscribe(params: QueryParams): Accessor<unknown[]>;
  create(model: string, data: Record<string, unknown>): Promise<string>;
  update(model: string, id: string, data: Record<string, unknown>): Promise<void>;
  delete(model: string, id: string): Promise<void>;
}
```

**`include` vs `parent` — when to use each:**

- **`include`** — eager-load relations on a model you're already querying: `{ model: "Playlist", include: { tracks: true } }`. Returns Playlist instances with `.tracks` hydrated. Best when you need the parent AND its children together.
- **`parent`** — query child models directly, scoped by a parent ID: `{ model: "AudioBlock", parent: { id: "...", predicate: "playlist://track" } }`. Returns a flat `AudioBlock[]`. Best for `$forEach` where you want the children as the top-level array — e.g. on a detail page where the route param gives you the parent ID.

Two responsibilities:

1. **Perspective injection** — every Ad4mModel call needs the current perspective. The service injects it so schemas don't need to know.
2. **Signal bridging** — Ad4mModel's `.subscribe(callback)` wraps in Solid's `createSignal()` for reactive updates.

Note: subscription deduplication is **already handled by AD4M's backend** — identical queries from the same user reuse one subscription (keyed on `(query, user_email)`). The query service doesn't need to duplicate this.

### Model registry

`$query` references models by name. A name→class mapping is needed:

```typescript
const modelRegistry: Record<string, typeof Ad4mModel> = {
  TextBlock,
  ImageBlock,
  CollectionBlock,
};

export function registerModel(name: string, modelClass: typeof Ad4mModel) {
  modelRegistry[name] = modelClass;
}
```

Ships with the 3 existing block types (imported from `@we/models/blocks`). Community block type packages call `registerModel()` when installed.

### Mutations via `$action`

The query service is exposed as a pseudo-store named `query`:

```json
{ "$action": "query.create", "args": ["AudioBlock", { "title": "New Track", "artist": "Unknown" }] }
{ "$action": "query.update", "args": ["AudioBlock", "$arg.id", { "title": "Updated" }] }
{ "$action": "query.delete", "args": ["AudioBlock", "$arg.id"] }
```

### Why `$query` is the highest-priority piece

It validates the core thesis: "different apps share the same data." Two schemas reading AudioBlocks from the same perspective see the same data reactively. Without `$query`, every app needs custom store code just to read blocks — which kills the composability story.

---

## `defineAppStore()` — For Complex Interaction State

Most state is data (`$query`), form state (`$localState`/`$validate`), or already handled by framework stores (route, theme, modal, space). `defineAppStore()` covers the remaining case: **ephemeral, client-side state shared across components that requires imperative logic**.

```typescript
defineAppStore({
  name: 'audioPlayer',
  dependencies: ['query'],
  create: (deps) => {
    const [currentTrack, setCurrentTrack] = createSignal(null);
    const [queue, setQueue] = createSignal([]);

    return {
      currentTrack,
      queue,
      play: (track) => {
        setCurrentTrack(track); /* HTML5 audio */
      },
      next: () => {
        /* advance queue */
      },
      enqueue: (track) => {
        setQueue((q) => [...q, track]);
      },
    };
  },
});
```

Key design decisions:

- **Dependencies declared, not imported.** A store says it needs `query` — the framework provides it. Packages never import framework internals.
- **Lazy instantiation.** `create()` only called when a `$store` token first references this store.
- **Collision prevention.** Two packages can't register the same store name.
- **For complex interaction state only.** If a builder finds themselves needing a custom store, they should first check if `$query` + `$localState` + computed props (`$map`, `$pick`) can express the state. `$localState` handles selection, toggles, and form inputs. `$validate` handles form validation. Custom stores are for state that is genuinely cross-component AND imperative: playback queues, drag-and-drop with DOM measurement, undo/redo history, real-time collaboration cursors.

---

## Dynamic Component Registration

The schema renderer needs a registry that supports runtime add/remove for third-party components.

### Current state

The component registry is a static `Record<string, Component>` — hardcoded imports.

### Target

```typescript
const builtInComponents: Record<string, Component> = {/* core library */};
const installedComponents: Record<string, Component> = {};

export function resolveComponent(name: string): Component | undefined {
  return builtInComponents[name] ?? installedComponents[name];
}

export function registerComponent(name: string, component: Component): void {
  installedComponents[name] = component;
}

export function unregisterComponent(name: string): void {
  delete installedComponents[name];
}
```

When the renderer can't resolve a component type, it renders a placeholder:

```
┌──────────────────────────────┐
│  ⚠ Missing: AudioWaveform    │
│  [Install @we-pkg/audio]     │
└──────────────────────────────┘
```

Later, when package loading exists, the placeholder gets an install button.

---

## Package Format & Distribution

### Package manifest

A component/store package exports a manifest:

```typescript
interface PackageManifest {
  name: string; // "@we-pkg/audio"
  version: string;
  description: string;
  author: string; // DID

  blocks?: BlockRegistration[]; // Block type registrations (model + editor component)
  models?: Record<string, typeof Ad4mModel>; // Models without editor components (query-only)
  components?: Record<string, Component>; // Extra UI components for schema use
  stores?: StoreDefinition[]; // App stores to register

  capabilities?: string[]; // Declared permissions
}

interface BlockRegistration {
  type: string; // 'AudioBlock'
  model: typeof Ad4mModel; // AudioBlock class
  editorComponent: Component; // SolidJS component for the editor
}
```

A block package populates `blocks` (model + editor component). A data-only package populates `models` (no editor integration — query-only via `$query`). A component package populates `components`. A full experience package might have all four. Same format, different populations.

### Distribution phases

**Phase 1: npm / URL-based (works today)**

Packages hosted as ESM bundles on npm, GitHub Pages, or any URL. Loaded via dynamic `import()`:

```typescript
const pkg = await import('https://cdn.example.com/@we-pkg/audio/1.0.0/index.js');
const manifest = pkg.default as PackageManifest;

// Register everything the package provides
for (const block of manifest.blocks ?? []) {
  registerBlock(block); // registers model + editor component
}
for (const [name, model] of Object.entries(manifest.models ?? {})) {
  registerModel(name, model); // query-only, no editor component
}
for (const [name, component] of Object.entries(manifest.components ?? {})) {
  registerComponent(name, component);
}
for (const store of manifest.stores ?? []) {
  registerStore(store);
}
```

Why URL-first:

- Works today (browsers do `import('https://...')` natively)
- Validates the entire registration pipeline
- Packages can be hosted anywhere
- No AD4M language development required

**Phase 2: AD4M-native (later, when demand warrants)**

Packages as AD4M expressions, distributed peer-to-peer through shared perspectives. Same manifest format, different transport. Migrates naturally from URL-based by adding `pkg://` as a source type alongside `https://`.

### Local package cache

Installed packages cached in IndexedDB so they don't re-fetch on every app start:

```typescript
interface CachedPackage {
  name: string;
  version: string;
  bundle: string; // serialised JS
  manifest: PackageManifest;
  installedAt: string;
  source: string; // original URL
}
```

On app start, load cached packages and re-register their components/stores/models.

---

## Capability & Trust Model

### Trust tiers

| Level         | Source                       | Verification              | Sandbox               |
| ------------- | ---------------------------- | ------------------------- | --------------------- |
| **Built-in**  | Ships with WE                | Implicit trust            | None                  |
| **Verified**  | Signed by known publisher    | DID signature check       | Capability-gated      |
| **Community** | Published in marketplace     | Content hash + author DID | Capability-gated      |
| **Unknown**   | Direct share, no marketplace | Content hash only         | Full sandbox (future) |

### Capability declarations

```typescript
capabilities: [
  'query:AudioBlock', // can query this model
  'query:CollectionBlock',
  'store:read:routeStore', // can read route store
  'action:modalStore.openModal', // can call this action
];
```

- At install: show capabilities to user, require consent
- At runtime: query service and store access are proxied through capability checks — **strict enforcement from day one** (undeclared access throws, never silently succeeds)
- The proxy intercepts every call regardless, so enforcement is the same cost as logging — no reason to defer it

### Schema vs. package trust distinction

**Schemas (JSON) are always safe.** They can reference missing components or stores — the system renders placeholders, never crashes, never executes code. Schemas travel freely.

**Packages (JS) are code.** They require user consent and capability enforcement before installation. This is the security boundary.

### Accepted risk: browser-privilege execution

Capability proxies gate **framework-provided APIs** (query service, store access, action dispatch). They cannot prevent a package from accessing browser globals:

- `document.cookie`, `localStorage`, `sessionStorage`
- `fetch()`, `XMLHttpRequest`, `WebSocket`
- DOM manipulation outside its own component tree
- `window`, `navigator`, global state

**This is an accepted risk for now.** The mitigation strategy is layered:

1. **Capability consent UI** — users see what a package requests before installing. Packages from unknown sources get a stronger warning.
2. **Marketplace curation** — published packages are reviewed. Community packages have author DID + content hash for accountability.
3. **Schema-first architecture** — most apps are pure schema (JSON) and never execute package code at all. The attack surface is limited to users who actively install JS packages.
4. **Future: iframe sandbox** — if demand warrants it, packages can be loaded in a sandboxed iframe with `postMessage`-based API bridge. This is complex (no direct DOM rendering, async communication overhead) and only worth building if the trust model proves insufficient. Not planned for any current phase.

**Guidance for users:** Only install packages from trusted sources. Verified and community marketplace packages are safer than direct-share unknown packages. When in doubt, stick to schema-only templates.

---

## End-to-End Example: Spotify Clone

### Your friend builds it

**1. Define data models** (if AudioBlock isn't already core):

```typescript
@Model({ name: 'AudioBlock' })
class AudioBlock extends WeNode {
  @Property({ through: 'we://has_title', required: true }) title: string = '';
  @Property({ through: 'we://has_artist' }) artist: string = '';
  @Property({ through: 'we://has_audio_url', required: true }) audioUrl: string = '';
  @Property({ through: 'we://has_duration' }) duration: number = 0;
}
```

**2. (Maybe) define one custom store** for playback queue:

```typescript
defineAppStore({
  name: 'audioPlayer',
  dependencies: ['query'],
  create: (deps) => ({
    currentTrack: createSignal(null),
    queue: createSignal([]),
    play: (track) => {
      /* ... */
    },
    next: () => {
      /* ... */
    },
  }),
});
```

**3. Write the schema** — uses `$query` for all data, core components for UI:

```
Sections:
  meta                    → { name: "Harmony Music", description: "..." }
  layout                  → Row with sidebar + main content + $routes
  navigation:left         → Sidebar with playlists, library, search
  route:/                 → Home: featured playlists, recently played
  route:/playlist/:id     → Playlist detail with $query for tracks
  route:/search           → Search across AudioBlocks
  panel:nowPlaying        → Currently playing track + controls
  theme                   → Dark purple theme overrides
```

Each section is ~50-150 lines of JSON. The `/playlist/:id` route uses `parent` to query AudioBlocks linked to this playlist — the route param provides the parent ID naturally:

```json
{
  "type": "Column",
  "children": [
    {
      "type": "$forEach",
      "items": {
        "$query": {
          "model": "AudioBlock",
          "parent": { "id": { "$store": "routeStore.params.id" }, "predicate": "playlist://track" }
        }
      },
      "template": {
        "type": "Row",
        "props": { "gap": "300", "ay": "center" },
        "children": [
          { "type": "we-text", "props": { "content": "$item.title" } },
          { "type": "we-text", "props": { "content": "$item.artist", "color": "neutral-500" } },
          {
            "type": "we-button",
            "props": { "onClick": { "$action": "audioPlayer.play", "args": ["$item"] } },
            "children": ["Play"]
          }
        ]
      }
    }
  ]
}
```

**4. Share it** via AD4M (sections stored in perspective, shared to neighbourhood or DM).

### When you receive it

1. **Shows up in your WE apps section** (template gallery)
2. **Open as-is** → installs the template (copy-on-activate), renders the full Spotify clone
3. **Fork it** → deep copy all sections, customise via AI ("change the theme to blue", "add a lyrics page")
4. **Extract a widget** → take the `panel:nowPlaying` section, splice it into your dashboard layout
5. **AI assists** → agent uses MCP tools to discover components, validate schema, edit sections

### Dependency resolution on receipt

```
Receive "Harmony Music" template
  │
  ├── Declare blocks: [AudioBlock, PlaylistBlock]
  │   ├── AudioBlock in core? → Yes → ✓
  │   └── PlaylistBlock in core? → No → prompt to install block package
  │
  ├── Declare components: [] → all core → ✓
  │
  ├── Declare stores: [audioPlayer]
  │   └── audioPlayer bundled with template? → Yes → register on install
  │
  └── All deps resolved → activate template → render
```

If a dependency can't be resolved, the template still renders — missing components show placeholders, missing stores log warnings but don't crash.

---

## AI Integration

The [ai-context](ai-context-package.md) and [MCP tools](mcp-tools.md) plans connect directly to this ecosystem:

### How AI builds a WE app

1. Agent gets slim orientation prompt (schema system overview, operators, available tools)
2. Agent calls `list_components` → knows available UI pieces
3. Agent writes schema JSON sections using `$query` for data binding
4. Agent calls `validate_schema` → verifies each section is valid
5. Agent calls section SHACL tools (`schemasection_create`, `schemasection_set_schemajson`) to save

### How AI edits an existing app

1. User says "make the globe page header purple and add a search bar"
2. Agent calls `schemasection_query` → lists available sections
3. Agent calls `schemasection_get` for `route:/globe` → gets ~50 lines of JSON
4. Agent calls `list_components` → discovers available components (finds `we-input` supports search)
5. Agent calls `get_component("we-input")` → learns its props (placeholder, value, onInput, etc.)
6. Agent modifies the JSON
7. Agent calls `validate_schema` → confirms it's valid
8. Agent calls `schemasection_set_schemajson` → writes back
9. UI re-renders reactively

### How AI helps the marketplace

- `validate_schema` ensures shared templates are valid before publishing
- Component/token/store knowledge tools help AI write schemas using the right primitives
- Block type MCP tools (auto-generated by SHACL) let AI create sample data for new templates

---

## Implementation Phases

> **Scope note:** These phases describe the long-term ecosystem build-out. For the concrete PR execution plan — which PRs to build, in what order, with what dependencies — see the [PR Implementation Roadmap](pr-roadmap.md). The roadmap covers Phases 1 and 3 in detail; Phases 2, 4, 5, and 6 will get PR plans when prerequisite phases validate their assumptions.

### Phase 1: `$query` + Reactive Query Service

**What:** Implement `$query` as a new schema token. Build the reactive query service bridging Ad4mModel subscriptions to Solid signals. Add model registry.

**Why first:** Validates the core thesis — "different apps share the same data." Everything else depends on this working.

**Assumption tested:** Ad4mModel `.subscribe()` reliably delivers real-time updates that bridge cleanly to `createSignal()`.

**Prerequisite:** Block model migration — see [block-model-migration](block-model-migration.md).

**Scope:**

- [ ] Model registry (~25 lines)
- [ ] Reactive query service (~120 lines)
- [ ] `$query` resolver + dispatcher integration (~30 lines)
- [ ] Query mutations via `$action` pseudo-store
- [ ] QueryProvider for schema renderer
- [ ] End-to-end test: block composer creates TextBlock → `$query` reactively shows it

**Estimated new code:** ~220 lines (plus the model move refactor).

### Phase 2: Dynamic Component Registration

**What:** Refactor the static component registry to support runtime add/remove. Add placeholder rendering for missing components.

**Why second:** Prerequisite for third-party components. Small change, immediate value.

**Scope:**

- [ ] Refactor componentRegistry to `resolveComponent()` + `registerComponent()` + `unregisterComponent()`
- [ ] Placeholder component for missing types
- [ ] Schema renderer uses `resolveComponent()` instead of direct registry lookup

**Estimated changes:** ~55 lines.

### Phase 3: Schema Customization (sectioned storage)

**What:** Implement the [schema-customization-architecture](schema-customization-architecture.md) — sectioned storage in AD4M, `$section` token, template gallery, section sharing.

**Why third:** This is the storage and sharing layer for templates. Enables the copy-on-activate, per-section AI editing, and section sharing flows.

**Scope:** See [schema-customization-architecture](schema-customization-architecture.md) for full details.

### Phase 4: `defineAppStore()` + Package Loading

**What:** API for third-party store definitions. URL-based ESM package loading pipeline. Package manifest format. Local cache.

**Why fourth:** Only needed once apps exist that require custom ephemeral state or custom components. By this point, Phase 1-3 have validated that most apps work without custom stores.

**Scope:**

- [ ] `defineAppStore()` API (~15 lines)
- [ ] Store registry with lazy instantiation (~50 lines)
- [ ] Package loader (fetch URL → parse manifest → register components/stores/models) (~100 lines)
- [ ] Package cache (IndexedDB) (~60 lines)
- [ ] Experience manager (dependency resolution, install flow) (~80 lines)
- [ ] Upgrade MissingComponent placeholder with install button

**Estimated new code:** ~325 lines.

### Phase 5: Capability Enforcement

**What:** Packages declare capabilities. Users see what a package requests before installing. Runtime enforcement proxies.

**Why fifth:** Only needed when untrusted packages are a real concern — i.e., when the marketplace has community packages.

**Scope:**

- [ ] Capability format definition
- [ ] Install-time consent UI
- [ ] Gated query service and store access proxies (strict enforcement — undeclared access throws)

### Phase 6: Marketplace + Distribution

**What:** A shared AD4M perspective (neighbourhood) where users discover and install templates, blocks, components, and themes.

**Why last:** Needs the full pipeline (Phases 1-5) working before distribution adds value.

**Scope:**

- [ ] Marketplace perspective conventions (link predicates for packages, templates, blocks, themes)
- [ ] Browse/search UI for marketplace content
- [ ] Publish flow (from installed template → marketplace)
- [ ] Rating/review mechanism (optional, via AD4M expressions)
- [ ] Migration path from URL-based to AD4M-native package distribution

---

## What's Usable at Each Phase

| After Phase | What works                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1           | Schemas bind to block data via `$query`. Two schemas reading the same data share it reactively. Block composer → schema rendering is end-to-end. |
| 2           | Third-party components can be registered at runtime. Graceful placeholder for missing components.                                                |
| 3           | Templates stored as sections in AD4M. Per-section AI editing. Template gallery. Section sharing between users.                                   |
| 4           | Packages with custom stores and components load from URLs. Dependency resolution on template install. Full "receive → install → customise" flow. |
| 5           | Users see capability prompts. Packages can't exceed declared permissions. Safe to install community packages.                                    |
| 6           | Full marketplace: discover, install, publish, rate. Templates, blocks, components, and themes all browsable.                                     |

---

## Block Type Evolution

### Architecture: three layers, one generic editor node

Block types have three cleanly separated layers:

1. **Model** (AD4M) — pure data, no editor knowledge. `AudioBlock`, `PollBlock`, etc. Reusable by any consumer: schema renderer, editor, API, AI agents.
2. **Block Component** (SolidJS) — renders UI for the block. Works in the editor, in schema-rendered apps, anywhere. Editor-agnostic.
3. **Editor integration** (Lexical) — embeds the Block Component in the composition surface.

For editor integration, a single **`GenericBlockNode`** (Lexical `DecoratorNode`) handles all non-text blocks. It stores the block type name and model ID, looks up the component from the block registry at render time, and renders it. New block types register with zero Lexical code:

```typescript
registerBlock({ type: 'PollBlock', model: PollBlock, component: PollChart });
// GenericBlockNode handles the rest — no custom Lexical node needed
```

The only block requiring a dedicated Lexical node is **TextBlock**, because inline rich text formatting (bold, italic, links, nested marks) requires Lexical's internal text node system. Every other block is "render this component at this document position" — handled generically.

### Missing block handling

When a schema or composition references a block type the user doesn't have installed:

- **Schema renderer:** shows a placeholder with an install button (same as missing components)
- **Editor:** `GenericBlockNode` renders a placeholder if the block type isn't in the registry
- **Cross-community interop:** a community using a `PollBlock` shares content with one that doesn't have it → recipient sees placeholder, installs the block package, content renders immediately

TextBlock is the one special case for editor interop. If a community using Tiptap receives Lexical-format `TextBlock` data, they'd need a converter or the Lexical `TextBlock` package installed. In practice this is rare — editor choice is a platform decision, not per-community.

**TextBlock is the catch-all for rich text content.** Paragraphs, headings, quotes, lists, callouts, and dividers are all TextBlock variants distinguished by the `type` field. This avoids model proliferation for content that is fundamentally "styled text." AD4M's graph storage means null fields don't cost storage.

**CodeBlock is separate** because it's genuinely distinct: monospace, syntax highlighting, no inline rich text, and `language` is queryable metadata.

### Core block types (13)

| #   | Block           | Category     | Key fields                                                                                                     |
| --- | --------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | TextBlock       | Existing     | `text`, `type` (paragraph/heading/quote/list/callout/divider), `tag`, `textFormat`, `variant`, `icon`, `style` |
| 2   | ImageBlock      | Existing     | `src`, `altText`, `width`, `height`                                                                            |
| 3   | CollectionBlock | Existing     | `display`, `direction`, `columns`, `gap`                                                                       |
| 4   | AudioBlock      | Media        | `title`, `artist`, `audioUrl`, `duration`, `albumArt`                                                          |
| 5   | VideoBlock      | Media        | `title`, `url`, `duration`, `thumbnail`, `provider`                                                            |
| 6   | FileBlock       | Media        | `name`, `url`, `mimeType`, `size`                                                                              |
| 7   | EventBlock      | Structured   | `title`, `startDate`, `endDate`, `location`, `allDay`                                                          |
| 8   | TaskBlock       | Structured   | `title`, `status`, `priority`, `dueDate`, `assignee`                                                           |
| 9   | LocationBlock   | Structured   | `name`, `latitude`, `longitude`, `address`                                                                     |
| 10  | LinkBlock       | Rich content | `url`, `title`, `description`, `thumbnail`                                                                     |
| 11  | CodeBlock       | Rich content | `code`, `language`, `title`                                                                                    |
| 12  | TagBlock        | Organisation | `name`, `color` (relationship-based, not a Lexical node)                                                       |
| 13  | EmbedBlock      | Embedding    | `url`/`entityId`, `entityType`, `displayMode`                                                                  |

See [core-block-types](../prs/core-block-types.md) for full model definitions, component mapping, and implementation plan.

### Future blocks (marketplace)

Niche block types grow from community demand: TableBlock, PollBlock, DrawingBlock, ChartBlock, RecipeBlock, etc. These ship as community packages, not core.

Each new block type automatically gets SHACL MCP tools, so AI agents can immediately CRUD instances.

---

## Relationship to Other Plans

| Plan                                                                      | How it connects                                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [schema-customization-architecture](schema-customization-architecture.md) | Phase 3 of this plan. Provides sectioned storage, `$section` token, template gallery, sharing.                        |
| [ai-context-package](ai-context-package.md)                               | Provides component/token/store knowledge for AI agents building and editing schemas.                                  |
| [mcp-tools](mcp-tools.md)                                                 | Exposes knowledge tools + section CRUD tools for AI agents. SHACL auto-generates block CRUD tools.                    |
| [core-block-types](../prs/core-block-types.md)                            | Expands block set from 3 to 13. Defines new models + editor components. Prerequisite for rich app archetypes.         |
| [component-library-expansion](../prs/component-library-expansion.md)      | Fills gaps in the core component library. P0 set (Select, Table, Grid, Card, etc.) needed for schema-first viability. |
| [block-model-migration](../prs/block-model-migration.md)                  | Moves existing 3 blocks to `@we/models`. Prerequisite for core-block-types and `$query`.                              |
| [query-service](../prs/query-service.md)                                  | Implements `$query` token and reactive query service. The keystone data binding layer for the apps ecosystem.         |
| [schema-validation](../prs/schema-validation.md)                          | Extends existing Zod validation from structural to semantic. AI feedback loop — prevents broken schemas.              |
| [concat-remove-expr](../prs/concat-remove-expr.md)                        | Adds `$concat` token, removes `$expr`. Eliminates `new Function()` from schema system.                                |

---

## Open Questions

1. ~~**Core block type set**~~ — Resolved. 13 core blocks defined in [core-block-types](../prs/core-block-types.md).
2. **`$query` subscription reliability** — does Ad4mModel's `.subscribe()` handle perspective switches, reconnections, and large result sets cleanly? Phase 1 is designed to test this.
3. **Package size limits** — ESM bundles for custom components: how big is acceptable? Tree-shaking vs. single-file bundles?
4. **Store serialisation** — if a user forks a template that includes a custom store, does the store definition travel with the template? Or must it be installed separately as a package?
5. **Marketplace governance** — who curates the default marketplace perspective? Community-driven? WE team? Both?
6. **Namespace conventions** — `@we-pkg/audio` for community packages, `@we/widgets` for core. Is this clear enough? What about block types?

---

## Future Work (beyond current roadmap)

1. **Schema Inspector** — a dev overlay that lets you click a rendered element and see which schema node produced it, resolved prop values, active `$query` results, and `$store` state. Essential for debugging AI-generated schemas. Becomes relevant once real users author templates (post-Phase D).
