> **Archived: superseded design.** Predates the current template/theme marketplace
> implementation (templateStore/themeStore + marketplace datasets). Historical context only.

# Experience Sharing & Distribution System (v2)

Revised plan grounded in the actual codebase state, with a pragmatic phasing that validates architectural assumptions early and defers speculative infrastructure until demand warrants it.

## What Changed From v1

The [original plan](./experience-sharing-system.md) described 6 phases building toward AD4M-native package distribution and peer-to-peer experience sharing. This revision makes three structural changes:

1. **Deferred AD4M-native distribution.** The v1 plan coupled package loading to a custom AD4M expression language — a months-long undertaking with high uncertainty. This revision uses URL-based ESM loading first (works today, validates the pipeline), with AD4M-native as a future migration once the package ecosystem has real demand.

2. **Split the dynamic registration phase.** v1 bundled `PackageManifest`, `defineAppStore()`, lazy store instantiation, and placeholder rendering into one phase. This revision separates dynamic component registration (small, immediate value) from store registration (harder, different concerns).

3. **Added the block model gap.** v1 didn't address the fact that only 3 of the ~14 described block types exist, and none have `semanticRole`. This revision adds a parallel track for block model evolution driven by real use cases, not upfront specification.

## Current State (March 2026)

What exists:

| Capability         | Status                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Schema renderer    | **Working** — 13 tokens ($store, $action, $expr, $if, $map, $pick, $eq, $ne, $not, $and, $or, $routes, $forEach) |
| Component registry | **Static** — hardcoded imports in `componentRegistry.tsx`, ~20 components                                        |
| Block models       | **3 types** — TextBlock, ImageBlock, CollectionBlock (via Ad4mModel)                                             |
| Block composer     | **Working** — Lexical-based, creates blocks via `Ad4mModel.save()` in batches                                    |
| Store system       | **Working** — 7 Solid.js context providers, wired to schema renderer via `stores` object                         |
| Ad4mModel API      | **Available** — full CRUD, query builder with `.where()/.order()/.limit()/.subscribe()`, SurrealDB-backed        |

What doesn't exist:

| Capability                     | Gap                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `$query` token                 | Not implemented — no way for schemas to bind to block data declaratively                |
| `semanticRole`                 | Not on any block model — "two experiences query the same data" isn't possible yet       |
| Dynamic component registration | No `register()` / `unregister()` API on the component registry                          |
| `defineAppStore()`             | No API for third-party store definitions                                                |
| Package loading                | No dynamic `import()` pipeline, no manifest format                                      |
| Experience format              | `TemplateSchema` has basic `meta` (name, description, icon) but no `dependencies` field |
| Package distribution           | Nothing — no URLs, no AD4M expressions, no marketplace                                  |

## Design Principles

1. **Validate before building.** Each phase should test an architectural assumption. Phase 1 tests whether Ad4mModel subscriptions bridge cleanly to Solid signals. Phase 2 tests whether dynamic component loading actually works at runtime. Don't invest in Phase N+1 until Phase N's assumption is confirmed.

2. **Schemas are data, packages are code.** Schemas (JSON) can be shared freely — they're inert. Component packages (JS bundles) contain executable code and require trust/consent before installation.

3. **Lazy everything.** Stores instantiated on first `$store` reference. Components resolved on first render. Packages fetched on first missing dependency encounter. No upfront loading of things that might not be needed.

4. **Graceful degradation.** If a schema references an uninstalled package, render a placeholder with install prompt — not a crash. Core blocks and built-in components always work.

5. **Don't speculate on block types.** The overview lists 14 block types. Ship what's needed for real experiences, add types when someone actually builds something that needs them.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Schema (JSON)                               │
│  References: component types, $query, $store, $action           │
│  Declares: dependencies.packages (experience schemas only)      │
│  Shareable: freely (it's just data)                             │
└──────────────┬──────────────────────────────────────────────────┘
               │ references
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Package Registry (runtime)                      │
│  Built-in: core components, framework stores, block models      │
│  Installed: component packages (loaded at runtime)              │
│  Provides: resolveComponent(), resolveStore(), resolveRecord()   │
└──────────┬───────────────────────────────────────────────────────┘
           │ fetched from                  │ resolved by
           ▼                               ▼
┌──────────────────────┐    ┌──────────────────────────────────────┐
│  Package Source       │    │  Schema Renderer                     │
│  (URL or AD4M expr)  │    │  $query → Reactive Query Service     │
│  ESM bundle loaded    │    │  $store → Store Registry             │
│  via dynamic import() │    │  component type → Component Registry │
└──────────────────────┘    └──────────────────────────────────────┘
```

---

## Phase 1 — Reactive Query Service (`$query`)

**Goal**: Schemas bind to Ad4mModel data declaratively. This is the single highest-value piece — it validates the core thesis that "different experiences share the same data."

**Assumption being tested**: Ad4mModel's `.subscribe()` reliably delivers real-time updates that bridge cleanly into Solid's `createSignal()`. If this works, the data layer of the entire architecture is viable. If subscriptions are flaky or have edge cases, we need to know before building anything on top.

### 1a. Model registry

`$query` references models by name. The query service needs a name→class mapping.

```typescript
// packages/block-system/models/src/registry.ts
import { TextBlock } from './block-types/TextBlock';
import { ImageBlock } from './block-types/ImageBlock';
import { CollectionBlock } from './block-types/CollectionBlock';

const entityRegistry: Record<string, typeof Ad4mModel> = {
  TextBlock,
  ImageBlock,
  CollectionBlock,
};

export function resolveRecord(name: string): typeof Ad4mModel | undefined {
  return entityRegistry[name];
}

export function registerEntity(name: string, modelClass: typeof Ad4mModel) {
  if (entityRegistry[name]) {
    throw new Error(`Model "${name}" is already registered`);
  }
  entityRegistry[name] = modelClass;
}
```

~20 lines. Ships with the 3 existing block types. Third-party packages can register additional models via `registerEntity()`.

### 1b. Reactive query service

The bridge between Ad4mModel and Solid's reactivity. Lives in `@we/schema-system/solid` because it's Solid-specific (wraps Ad4mModel callbacks in `createSignal`).

```typescript
// packages/schema-system/solid/src/queryService.ts
interface QueryParams {
  model: string;
  where?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
  parent?: string; // parent block ID for child queries
  through?: string; // relationship predicate (default: "we://contains")
}

interface QueryService {
  // Returns a reactive accessor for query results
  subscribe(params: QueryParams): Accessor<unknown[]>;

  // CRUD — used by $action "query.create" etc.
  find(model: string, id: string): Promise<unknown>;
  create(model: string, props: Record<string, unknown>): Promise<unknown>;
  update(model: string, id: string, props: Record<string, unknown>): Promise<unknown>;
  delete(model: string, id: string): Promise<void>;
}
```

Three responsibilities:

1. **Perspective injection** — every Ad4mModel call needs the current perspective. The service injects it so schemas don't need to know about it. Gets the perspective from `SpaceStore.perspective()` (already in context).

2. **Signal bridging** — Ad4mModel's `.subscribe(callback)` wraps in `createSignal()`:

   ```typescript
   const [data, setData] = createSignal<T[]>([]);
   EntityClass.query(perspective)
     .where(params.where)
     .order(params.order)
     .limit(params.limit)
     .subscribe((results) => setData(results));
   return data; // Solid Accessor<T[]>
   ```

3. **Subscription deduplication** — if two components query the same model + where + order + limit, one SurrealDB subscription feeds both signal readers. Cache key is `hash(model, where, order, limit)`. Cache entries are reference-counted and disposed when no readers remain.

Subscription cleanup is critical: when a component unmounts or perspective changes, subscriptions must be disposed. Use Solid's `onCleanup()` in the resolver.

### 1c. `$query` resolver

Add `$query` as a 14th token in the dispatcher:

```typescript
// packages/schema-system/shared/src/propResolvers/query.ts
export function resolveQueryProp(
  token: { $query: QueryParams },
  queryService: QueryService,
  memo: typeof createMemo,
): Accessor<unknown[]> {
  return queryService.subscribe(token.$query);
}
```

In the dispatcher:

```typescript
if (hasToken(value, '$query', 'object')) return resolveQueryProp(value, stores.__queryService, memo);
```

The query service is passed through the `stores` object as `__queryService` (underscore prefix = internal, not exposed to `$store` resolution).

### 1d. Mutations via `$action`

The query service is exposed as a pseudo-store named `query` with CRUD methods:

```json
{ "$action": "query.create", "args": ["TextBlock", { "text": "Hello", "tag": "p" }] }
{ "$action": "query.update", "args": ["TextBlock", "$arg.id", { "text": "Updated" }] }
{ "$action": "query.delete", "args": ["TextBlock", "$arg.id"] }
```

### 1e. QueryProvider

Wraps the query service creation and provides it to the schema renderer:

```typescript
// packages/app-framework/src/frameworks/solid/providers/QueryProvider.tsx
export function QueryProvider(props: { children: JSX.Element }) {
  const spaceStore = useSpaceStore();
  const queryService = createQueryService(() => spaceStore.perspective());
  // ... pass to schema renderer via stores
}
```

### 1f. Validation: Block Composer → $query loop

The first end-to-end test of the architecture: user creates a TextBlock in the block composer → a schema with `$query: { model: "TextBlock" }` reactively shows the new block. This tests the full subscribe → signal → re-render path.

### Files

| File                                                                      | Action | Lines |
| ------------------------------------------------------------------------- | ------ | ----- |
| `packages/block-system/models/src/registry.ts`                            | New    | ~25   |
| `packages/schema-system/shared/src/propResolvers/query.ts`                | New    | ~30   |
| `packages/schema-system/shared/src/propResolvers/dispatcher.ts`           | Edit   | ~3    |
| `packages/schema-system/shared/src/types.ts`                              | Edit   | ~10   |
| `packages/schema-system/solid/src/queryService.ts`                        | New    | ~120  |
| `packages/app-framework/src/frameworks/solid/providers/QueryProvider.tsx` | New    | ~30   |

Total: ~220 lines of new code.

### Risks

- **Ad4mModel `.subscribe()` reliability.** If SurrealDB subscriptions drop or duplicate, the reactive data layer is unreliable. Mitigation: build Phase 1 first, test with real subscriptions before proceeding.
- **Perspective lifecycle.** When a user switches space (different perspective), all subscriptions need to be torn down and re-created. Solid's reactivity handles this if the perspective is a signal, but we need to verify cleanup works cleanly.
- **Query performance.** `.where()` conditions go through SurrealDB. Complex queries against large perspectives could be slow. Not a problem at current scale, but worth monitoring.

---

## Phase 2 — Dynamic Component Registration

**Goal**: The schema renderer resolves components through a registry that supports runtime add/remove. This is the prerequisite for third-party components.

**Assumption being tested**: Components can be added to the registry after initial page load and the schema renderer picks them up for subsequent renders.

### 2a. Registry refactor

The current `componentRegistry.tsx` is a static object:

```typescript
export const componentRegistry: Record<string, Component> = {
  'we-text': ...,
  'we-button': ...,
  Column: ...,
  // etc.
};
```

Refactor to support dynamic registration:

```typescript
// packages/app-framework/src/frameworks/solid/registries/componentRegistry.tsx
const builtInComponents: Record<string, Component> = {
  'we-text': ...,
  // ... all existing registrations stay here
};

const installedComponents: Record<string, Component> = {};

export function resolveComponent(name: string): Component | undefined {
  return builtInComponents[name] ?? installedComponents[name];
}

export function registerComponent(name: string, component: Component): void {
  if (builtInComponents[name]) {
    throw new Error(`Cannot override built-in component "${name}"`);
  }
  installedComponents[name] = component;
}

export function unregisterComponent(name: string): void {
  delete installedComponents[name];
}
```

The schema renderer changes from `registry[node.type]` to `resolveComponent(node.type)`.

### 2b. Placeholder component

When the renderer can't resolve a component type, instead of rendering nothing (or crashing), render a placeholder:

```typescript
function MissingComponent(props: { type: string }) {
  return (
    <div style="padding: 1rem; border: 1px dashed var(--we-color-border); border-radius: 8px; text-align: center;">
      <we-text variant="body-sm" color="muted">
        Component "{props.type}" is not installed
      </we-text>
    </div>
  );
}
```

Later (Phase 4) this gets an install button. For now it's a clear visual indicator that something's missing.

### Files

| File                                                                           | Action | Lines |
| ------------------------------------------------------------------------------ | ------ | ----- |
| `packages/app-framework/src/frameworks/solid/registries/componentRegistry.tsx` | Edit   | ~30   |
| `packages/schema-system/solid/src/SchemaRenderer.tsx`                          | Edit   | ~10   |
| `packages/schema-system/solid/src/components/MissingComponent.tsx`             | New    | ~15   |

Total: ~55 lines changed.

---

## Phase 3 — App Stores + `defineAppStore()`

**Goal**: Third-party packages can define stores that the schema renderer resolves via `$store`. Stores are lazily instantiated and dependency-injected.

**Assumption being tested**: Stores defined after framework boot can be resolved by the existing `$store` machinery without changes to the schema renderer's core prop resolution.

### Store definition API

```typescript
// packages/app-framework/src/core/defineAppStore.ts
interface StoreDefinition {
  name: string;
  dependencies?: string[]; // e.g. ['query'] — framework provides at instantiation
  create: (deps: Record<string, unknown>) => Record<string, unknown>;
}

export function defineAppStore(definition: StoreDefinition): StoreDefinition {
  return definition; // identity function — validates shape, provides type safety
}
```

### Store registration + lazy instantiation

```typescript
// packages/app-framework/src/frameworks/solid/registries/storeRegistry.ts
const storeDefinitions: Record<string, StoreDefinition> = {};
const storeInstances: Record<string, Record<string, unknown>> = {};

export function registerStore(definition: StoreDefinition): void {
  if (storeDefinitions[definition.name] || frameworkStores[definition.name]) {
    throw new Error(`Store "${definition.name}" is already registered`);
  }
  storeDefinitions[definition.name] = definition;
}

// Called by $store resolver when encountering an unknown store name
export function resolveAppStore(name: string): Record<string, unknown> | undefined {
  if (storeInstances[name]) return storeInstances[name];

  const def = storeDefinitions[name];
  if (!def) return undefined;

  // Resolve dependencies
  const deps: Record<string, unknown> = {};
  for (const dep of def.dependencies ?? []) {
    if (dep === 'query') deps.query = queryService;
    else deps[dep] = resolveAppStore(dep);
  }

  const instance = def.create(deps);
  storeInstances[name] = instance;
  return instance;
}
```

Key design decisions:

- **Dependencies declared, not imported.** A store says it needs `query` — the framework provides it. Packages never import framework internals.
- **Lazy instantiation.** `create()` only called on first `$store` reference. No startup cost for installed-but-unused stores.
- **Collision prevention.** Two packages can't register the same store name. Second install fails with a clear error.
- **No unregister for stores.** Unlike components, stores may hold state and subscriptions. Removing a store while a schema is using it creates undefined behavior. Installed stores persist until page reload.

### Integration with `$store` resolver

The existing `resolveStoreProp` in `propResolvers/store.ts` walks `stores.{name}.{path}`. Extend it to check `resolveAppStore(name)` as a fallback:

```
$store: "player.currentTrack"
  → stores.player? yes → return stores.player.currentTrack
  → stores.player? no → resolveAppStore("player") → lazy-instantiate → return .currentTrack
```

### Files

| File                                                                      | Action | Lines |
| ------------------------------------------------------------------------- | ------ | ----- |
| `packages/app-framework/src/core/defineAppStore.ts`                       | New    | ~15   |
| `packages/app-framework/src/frameworks/solid/registries/storeRegistry.ts` | New    | ~50   |
| `packages/schema-system/shared/src/propResolvers/store.ts`                | Edit   | ~15   |

Total: ~80 lines.

---

## Phase 4 — Experience Format + Package Loading

**Goal**: Experiences are a formal, shareable unit with declared dependencies. Missing packages load from URLs.

This phase bundles the experience format and URL-based package loading because neither is useful without the other: an experience without dependency resolution is just a template, and package loading without a dependency declaration is manual developer tooling.

### Experience schema type

Superset of existing `TemplateSchema`:

```typescript
interface ExperienceSchema extends SchemaNode {
  meta: {
    name: string;
    description?: string;
    author?: string; // DID or display name
    version?: string;
    icon?: string;
    preview?: string; // URL to screenshot
    forkedFrom?: string; // address of parent experience (for forks)
  };
  dependencies?: {
    packages?: PackageDependency[];
  };
}

interface PackageDependency {
  name: string; // e.g. "@we-pkg/music"
  source: string; // URL to ESM bundle (initially), later also pkg:// address
  hash?: string; // content hash for integrity verification
}
```

### Package manifest format

What a loaded ESM bundle must export:

```typescript
// What a package author builds and hosts
interface PackageManifest {
  name: string; // "@we-pkg/music"
  version: string;
  description?: string;
  author?: string;

  // What the package provides
  components?: Record<string, Component>; // name → SolidJS component
  stores?: Record<string, StoreDefinition>; // name → defineAppStore() result
  models?: Record<string, typeof Ad4mModel>; // name → model class

  // Security
  capabilities?: string[]; // declared permissions
}

// ESM bundle default export
export default {
  name: '@we-pkg/music',
  version: '1.0.0',
  components: { MusicPlayer, TrackList, PlaylistSidebar },
  stores: { player: PlayerStore },
  capabilities: ['query:AudioBlock', 'query:CollectionBlock'],
} satisfies PackageManifest;
```

### Package loading pipeline

```
Experience opened with dependency "@we-pkg/music"
  │
  ├── Check: resolveComponent("MusicPlayer") → found? → render normally
  │
  ├── Not found → check dependency declaration for source URL
  │
  ├── Fetch + load:
  │   ├── Verify URL is HTTPS (no HTTP, no data: URIs, no file:)
  │   ├── dynamic import(url) → get ESM module
  │   ├── Validate exports match PackageManifest shape
  │   ├── Verify hash if provided
  │   └── Check declared capabilities against schema's $query/$store usage
  │
  ├── Prompt user:
  │   └── "@we-pkg/music wants access to: AudioBlock, CollectionBlock. Install?"
  │
  ├── User confirms → register:
  │   ├── registerComponent() for each component
  │   ├── registerStore() for each store
  │   ├── registerEntity() for each model
  │   └── Cache bundle locally (IndexedDB, keyed by name@version+hash)
  │
  └── Re-render → MissingComponent placeholders replaced with real components
```

### Why URLs first, not AD4M-native

Building a custom AD4M expression language for package distribution requires:

- Language implementation (Holochain or IPFS backend)
- Content-addressed storage integration
- Marketplace perspective conventions
- Language installation/bootstrapping
- Testing peer-to-peer bundle retrieval

This is months of work with high uncertainty. URL-based loading:

- Works today (browsers do `import('https://...')` natively)
- Validates the entire registration pipeline
- Packages can be hosted anywhere (GitHub Pages, IPFS gateway, personal server)
- Migrates to AD4M-native later by adding `pkg://` as another source type alongside HTTPS

### Local package cache

Installed packages are cached in IndexedDB so they don't need to be re-fetched on every app start:

```typescript
interface CachedPackage {
  name: string;
  version: string;
  hash: string;
  bundle: string; // the JS source
  installedAt: number; // timestamp
  source: string; // original URL
}
```

On app start, load cached packages and re-register their components/stores/models. No network needed.

### Files

| File                                                               | Action | Lines |
| ------------------------------------------------------------------ | ------ | ----- |
| `packages/schema-system/shared/src/types.ts`                       | Edit   | ~25   |
| `packages/schema-system/shared/src/validators.ts`                  | New    | ~40   |
| `packages/app-framework/src/core/packageLoader.ts`                 | New    | ~100  |
| `packages/app-framework/src/core/packageCache.ts`                  | New    | ~60   |
| `packages/app-framework/src/core/experienceManager.ts`             | New    | ~80   |
| `packages/schema-system/solid/src/components/MissingComponent.tsx` | Edit   | ~20   |

Total: ~325 lines.

---

## Phase 5 — Capability Enforcement

**Goal**: Packages can't exceed declared permissions. Users see what a package requests before installing.

### Capability format

```typescript
capabilities: [
  'query:AudioBlock', // can query this model
  'query:CollectionBlock',
  'store:read:adamStore.me', // can read this store path
  'action:modalStore.openModal', // can call this action
];
```

### Enforcement points

1. **At install time**: Show capabilities to user, require consent.
2. **At query time**: Query service proxy checks `query:{model}` capability before executing.
3. **At store access time**: Store resolver proxy checks `store:read:{path}` before returning.

```typescript
function createGatedQueryService(realService: QueryService, capabilities: string[], packageName: string): QueryService {
  return {
    subscribe(params) {
      const cap = `query:${params.model}`;
      if (!capabilities.includes(cap)) {
        console.warn(`Package "${packageName}" accessed "${cap}" without declaring it`);
        // Warn in dev, block in production
      }
      return realService.subscribe(params);
    },
    // ... same for find, create, update, delete
  };
}
```

Initially: warn-only enforcement (dev mode). Strict blocking comes when the ecosystem is mature enough that packages reliably declare their capabilities.

### Files

| File                                               | Action | Lines |
| -------------------------------------------------- | ------ | ----- |
| `packages/app-framework/src/core/capabilities.ts`  | New    | ~60   |
| `packages/app-framework/src/core/packageLoader.ts` | Edit   | ~20   |

Total: ~80 lines.

---

## Phase 6 — AD4M-Native Distribution (when demand warrants)

**Goal**: Migrate from URL-based to AD4M-native package distribution for true peer-to-peer sharing.

**Deferred until**: There are ≥5 real packages hosted at URLs and ≥2 experiences shared between different users. Until then, URL-based loading is sufficient and the distribution mechanism is not the bottleneck.

### What this adds

- **Package language**: A custom AD4M expression language backed by content-addressed storage (Holochain or IPFS). Packages published as expressions with `pkg://Qm...` addresses.
- **Marketplace perspectives**: Shared AD4M perspectives where agents publish package links. Anyone can create a marketplace. WE ships with a default one.
- **`PackageDependency.source`** gains a `pkg://` scheme alongside `https://`.
- **Peer discovery**: Resolve package names through marketplace perspectives instead of hardcoded URLs.

### What stays the same

Everything from Phases 1–5. The package manifest format, registration API, capability model, and experience schema format are distribution-agnostic. Switching from HTTPS to `pkg://` is a transport change, not an architecture change.

---

## Phase 7 — Peer Experience Sharing

**Goal**: Share experiences directly via AD4M neighbourhoods. Community templates. Forking.

**Deferred until**: Phase 6 is complete (requires AD4M-native distribution for packages).

### What this adds

- **Experience expressions**: Publish experience schemas as AD4M expressions.
- **Neighbourhood sharing**: `we://shared_experience` links in shared perspectives.
- **Community defaults**: `we://default_experience` on neighbourhood root.
- **Forking**: Deep copy an experience schema, store as new expression with `meta.forkedFrom` link.

This is pure JSON sharing (schemas are data, not code), so it's technically simple once the package distribution (Phase 6) handles the code dependency resolution.

---

## Parallel Track — Block Model Evolution

Block models evolve independently of the sharing infrastructure. The principle: **add block types when real experiences need them, not before.**

### Immediate (can do now, independent of all phases)

**Add `semanticRole` to the base Block model:**

```typescript
// packages/block-system/models/src/Block.ts
@Model({ name: 'Block' })
export class Block extends Ad4mModel {
  @Property({ through: 'we://block_type', required: true })
  type: string = '';

  @Property({ through: 'we://semantic_role' })
  semanticRole: string[] = [];

  // ... existing comments, reactions
}
```

This is a small change with outsized impact — it enables "query all blocks with a specific meaning" which is the foundation of the data-sharing thesis. Without it, two experiences can't query the same data differently.

**Question: Should semanticRole be on the base `Block`, or on specific block types?** Cases for both:

- On `Block`: every block type gets it automatically, queries can span block types ("all content tagged music://favourite")
- On specific types: more explicit, less noise on types that don't need it

Recommendation: Put it on `Block`. The cross-type query ability is too valuable.

### When someone builds a music experience

Add `AudioBlock`:

```typescript
@Model({ name: 'AudioBlock' })
export class AudioBlock extends Ad4mModel {
  @Property({ through: 'we://audio_block_title', required: true })
  title: string = '';

  @Property({ through: 'we://audio_block_src', required: true })
  src: string = '';

  @Property({ through: 'we://audio_block_duration' })
  duration: number = 0;

  @Property({ through: 'we://audio_block_mime_type' })
  mimeType: string = '';
}
```

Register in the model registry. The block composer doesn't need to know about it immediately — audio blocks are created via `$action: "query.create"` from experience schemas or app store logic.

### Block type admission criteria

A new block type is warranted when:

1. It needs a **genuinely different renderer** (a different kind of thing on screen)
2. It has **standardized properties** that multiple experiences would query
3. It **can't be composed** from existing blocks + semanticRole

Things that DON'T warrant a new block type:

- A recipe (composition of TextBlocks + ImageBlocks + ChecklistBlocks in a CollectionBlock)
- A bookmark (TextBlock with semanticRole `web://bookmark` and a URL in the text)
- Genre metadata (TextBlock with semanticRole `music://genre`)

---

## Implementation Sequence

```
Parallel Track (block models)          Main Track (sharing infrastructure)
─────────────────────────────          ──────────────────────────────────

Add semanticRole to Block ─────────┐
                                   │
                                   ├── Phase 1: $query + Reactive Query Service
                                   │     → Validates: Ad4mModel subscriptions → Solid signals
                                   │     → Unlocks: schema-only development (Level 1 onramp)
                                   │     → Test: BlockComposer creates block → $query sees it
                                   │
                                   ├── Phase 2: Dynamic Component Registration
                                   │     → Validates: runtime component add/remove works
                                   │     → Unlocks: third-party components can be loaded
                                   │
                                   ├── Phase 3: defineAppStore() + Lazy Instantiation
                                   │     → Validates: third-party stores resolve via $store
                                   │     → Unlocks: Level 2-3 onramp (custom components + logic)
                                   │
Add block types as needed ─────────┤
(AudioBlock, VideoBlock, etc.)     ├── Phase 4: Experience Format + URL Package Loading
                                   │     → Validates: full install loop (fetch → verify → register)
                                   │     → Unlocks: experiences are shareable, deps auto-resolve
                                   │
                                   ├── Phase 5: Capability Enforcement
                                   │     → Validates: packages can't exceed declared permissions
                                   │     → Unlocks: safe to install community packages
                                   │
                                   ├── Phase 6: AD4M-Native Distribution (deferred)
                                   │     → When: ≥5 packages, ≥2 users sharing experiences
                                   │
                                   └── Phase 7: Peer Experience Sharing (deferred)
                                         → After Phase 6
```

### What's usable at each milestone

| After        | What works                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| semanticRole | Blocks can be tagged with meaning. Foundation for cross-experience data sharing.                                                                   |
| Phase 1      | Schemas declaratively bind to block data via `$query`. Two schemas reading the same data "just work." BlockComposer → $query → render loop proven. |
| Phase 2      | Components can be added at runtime. Missing components show placeholder.                                                                           |
| Phase 3      | Third-party stores work. `defineAppStore()` API exists. Full Level 1-3 onramp functional.                                                          |
| Phase 4      | Experiences are a real unit — open one, missing packages auto-install from URLs. First real sharing between users.                                 |
| Phase 5      | Capability prompts on install. Packages can't silently read data they didn't declare.                                                              |
| Phase 6+     | Full decentralized loop: AD4M-native packages, marketplace perspectives, peer sharing, forking.                                                    |

---

## Relationship to Other Plans

### App framework refactor

The [app-framework-refactor](./app-framework-refactor.md) (P1: inject seed, P3: remove dead integration infra, P4: fix validators/types) is independent cleanup. It's not a prerequisite for this plan — the experience sharing phases can proceed in parallel. The refactored framework will be cleaner to build on, but the current framework is functional enough.

### Architecture overview

The [architecture overview](../../architecture/overview.md) describes the north star. This plan implements it incrementally:

| Overview concept                           | Implemented by                                                |
| ------------------------------------------ | ------------------------------------------------------------- |
| `$query` — declarative data binding        | Phase 1                                                       |
| Dynamic component packages                 | Phase 2 + Phase 4                                             |
| `defineAppStore()`                         | Phase 3                                                       |
| Experience format (meta + deps + schema)   | Phase 4                                                       |
| Capability declarations                    | Phase 5                                                       |
| AD4M-native distribution                   | Phase 6                                                       |
| Peer sharing, forking, community templates | Phase 7                                                       |
| ~14 block types                            | Parallel track (as needed)                                    |
| Remixing via AI                            | Falls out naturally once Phase 4 exists — AI operates on JSON |

### Module development guide

The [module development guide](../../guides/module-development.md) describes a class-based store pattern. This plan uses the functional `defineAppStore()` pattern from the overview. The guide should be updated to match once Phase 3 is implemented.

---

## Open Questions

### 1. SolidJS coupling

Component packages export SolidJS components. The ecosystem is SolidJS-specific. The design system uses Lit web components for primitives, so a web component bridge is technically possible in the future, but premature now. Accept SolidJS coupling — it's WE's framework.

### 2. Store persistence

Some app store state should persist across sessions (audio queue, preferences). Three options:

- AD4M perspective links (syncs across devices)
- Local storage (simple, no sync)
- `defineAppStore({ persist: ['queue'] })` and the framework handles it

Recommendation: Start with local storage for simplicity. Add AD4M perspective persistence as a `persist` option when there's demand for cross-device sync.

### 3. Bundle size

Pre-bundled ESM. Package author builds once, consumers load the bundle. Keep packages small by convention — a music player package shouldn't bundle a 3D engine. No tree-shaking across package boundaries (the package is the unit).

### 4. Content-hash pinning vs. floating versions

Experiences should pin to a specific package hash (content-addressed), not a floating version. This means v1 and v2 of a package are different bundles. Experiences referencing v1 continue working. Users opt into updates explicitly. This is how the AD4M-native distribution model (Phase 6) will work anyway — start the convention now with URL-based loading.

### 5. `$query` vs. `$store` — when to use which

Clear guidance for schema authors:

- **`$query`** — for reading/writing block data. Declarative. No code needed. Reactive via Ad4mModel subscriptions.
- **`$store`** — for non-data state (playback, navigation, UI state) or logic that can't be expressed as a query (audio playback, WebRTC, canvas).
- **`$action`** — calls methods on either (mutations, side effects).

If you're just showing data, use `$query`. If you need behaviour, write a store.
