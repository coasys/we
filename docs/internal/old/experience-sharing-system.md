> **Archived: superseded design.** Superseded by v2 (sibling file), and both predate the
> current template/theme marketplace implementation. Historical context only.

# Experience Sharing & Distribution System

Design for making schemas, component packages, and app stores shareable and installable between WE peers — enabling the experience ecosystem described in the architecture overview.

## Context

The [architecture overview](../../architecture/overview.md) describes a vision where:

- Builders publish **experiences** (schema + component packages + app stores) that any WE user can open, remix, and integrate
- Users can splice elements from one experience into another via "JSON surgery"
- Competing apps share the same data via `$query` against shared block types
- Component packages install dynamically when a schema references them

The [module development guide](../../guides/module-development.md) sketches a heavyweight module format (stores + components + AD4M languages + lifecycle hooks + config).

**Neither of these are implemented.** The current codebase has:

- A static component registry (hardcoded imports in `componentRegistry.tsx`)
- No `$query` token implementation (the dispatcher in `@we/schema-shared` handles `$store`, `$action`, `$expr`, `$if`, `$map`, `$pick` — no `$query`)
- No dynamic package loading or registration
- No `defineAppStore()` API
- No peer-to-peer schema/package distribution
- Block models exist (`TextBlock`, `ImageBlock`, `CollectionBlock` in `@we/block-models`) but nothing bridges them to the schema renderer reactively

This plan covers the infrastructure needed to close those gaps.

## Relationship to App Framework Refactor

The [app-framework-refactor](./app-framework-refactor.md) is a prerequisite cleanup. Specifically:

- **P1 (seed injection)** and **P3 (remove integration infra)** clear the ad-hoc launcher machinery that currently occupies the space where package loading should live
- **P6 (core/app boundary)** creates the internal seam where `registerComponents()` / `registerStore()` APIs belong — as `core/` public surfaces

This plan should be sequenced _after_ P1/P3, and can run in parallel with P4-P7.

---

## Design Principles

1. **AD4M-native distribution.** Packages are AD4M expressions, not npm packages. The same mechanism that distributes data distributes code. No central registry required — discovery happens through shared perspectives.

2. **Schemas are data, packages are code.** Schemas (JSON) can be shared freely between peers — they're inert descriptions. Component packages (JS bundles) contain executable code and require trust/consent before installation.

3. **Lazy instantiation.** Stores and components are registered when a package is installed but instantiated only when first referenced by a rendering schema. No wasted resources.

4. **Graceful degradation.** If a schema references an uninstalled package, WE renders a placeholder with an install prompt — not a crash. Core block types and built-in components always work.

5. **Two tiers, one format.** Component packages (lightweight: components + optional stores) and modules (heavyweight: + AD4M languages + lifecycle + config) use the same manifest format. A component package is a module where the heavy fields are empty.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Schema (JSON)                               │
│  References: component types, $query, $store, $action           │
│  Declares: dependencies.packages                                │
│  Shareable: freely (it's just data)                             │
└──────────────┬──────────────────────────────────────────────────┘
               │ references
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Package Registry (runtime)                      │
│  Built-in: core components, framework stores                    │
│  Installed: component packages from peers/marketplace           │
│  Dynamic: registration/unregistration at runtime                │
└──────────┬───────────────────────────────┬──────────────────────┘
           │ fetched from                  │ resolved by
           ▼                               ▼
┌─────────────────────┐    ┌──────────────────────────────────────┐
│  AD4M Expression     │    │  Schema Renderer                     │
│  Language            │    │  $query → Reactive Query Service     │
│  (content-addressed  │    │  $store → Package Registry stores    │
│   JS bundles)        │    │  component type → Package Registry   │
└─────────────────────┘    └──────────────────────────────────────┘
```

---

## Phase 1 — Reactive Query Service (`$query`)

**Goal**: Implement the `$query` token so schemas can declaratively bind to Ad4mModel data without hand-written stores.

This is the single most impactful piece — it's what makes "different apps share the same data" real. Without `$query`, every experience needs custom store code just to read blocks.

### The `$query` token

```json
{
  "type": "TrackList",
  "props": {
    "tracks": {
      "$query": {
        "model": "AudioBlock",
        "where": { "semanticRole": { "contains": "music://track" } },
        "order": { "title": "ASC" },
        "limit": 50
      }
    }
  }
}
```

### Query service implementation

A thin bridge (~100 lines) between Ad4mModel and Solid's reactivity:

```typescript
// packages/schema-system/solid/src/queryService.ts
import { createSignal, createMemo, onCleanup } from 'solid-js';

interface QueryParams {
  model: string;
  where?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
  parent?: string;
  through?: string;
}

interface QueryService {
  subscribe(params: QueryParams): () => unknown[];
  find(model: string, id: string): Promise<unknown>;
  create(model: string, props: Record<string, unknown>): Promise<unknown>;
  update(model: string, id: string, props: Record<string, unknown>): Promise<unknown>;
  delete(model: string, id: string): Promise<void>;
}
```

**Three responsibilities:**

1. **Perspective injection** — every Ad4mModel call needs the current perspective. The service injects it so schemas don't need to know about it.
2. **Signal bridging** — Ad4mModel subscriptions fire callbacks. The service wraps them in `createSignal()` so components get reactive updates.
3. **Subscription deduplication** — if two components both query "AudioBlocks with role music://track", one subscription feeds both signal readers. Uses a cache keyed on `hash(model, where, order, limit)`.

### Model registry

`$query` references models by name (`"AudioBlock"`). The query service needs a name→class mapping:

```typescript
// packages/block-system/models/src/registry.ts
import { TextBlock } from './block-types/TextBlock';
import { ImageBlock } from './block-types/ImageBlock';
import { CollectionBlock } from './block-types/CollectionBlock';

export const entityRegistry: Record<string, typeof Ad4mModel> = {
  TextBlock,
  ImageBlock,
  CollectionBlock,
};

// App stores can register additional models
export function registerEntity(name: string, modelClass: typeof Ad4mModel) {
  entityRegistry[name] = modelClass;
}
```

### Integration with schema renderer

Add `$query` to the dispatcher in `@we/schema-shared`:

```typescript
// In dispatcher.ts resolveProp():
if (hasToken(value, '$query', 'object')) return resolveQueryProp(value, queryService, memo);
```

The query service is passed through the same `stores` mechanism — it lives at `stores.__queryService` or is injected via a dedicated provider. The resolver calls `queryService.subscribe(params)` and returns the reactive signal.

### Mutations via `$action`

```json
{ "$action": "query.create", "args": ["AudioBlock", { "title": "New Track" }] }
{ "$action": "query.update", "args": ["AudioBlock", "$arg.id", { "title": "Updated" }] }
{ "$action": "query.delete", "args": ["AudioBlock", "$arg.id"] }
```

The query service is exposed as a pseudo-store named `query` with `create`, `update`, `delete`, `find` methods.

### Files changed / created

- `packages/schema-system/shared/src/propResolvers/query.ts` — new resolver
- `packages/schema-system/shared/src/propResolvers/dispatcher.ts` — add `$query` branch
- `packages/schema-system/shared/src/types.ts` — add `QueryToken` type
- `packages/schema-system/solid/src/queryService.ts` — new: reactive query bridge
- `packages/block-system/models/src/registry.ts` — new: model name→class registry
- `packages/app-framework/src/frameworks/solid/providers/QueryProvider.tsx` — new: provides query service to schema renderer

### Dependencies

- `@coasys/ad4m` (Ad4mModel, perspective API)
- Block model classes from `@we/block-models`

---

## Phase 2 — Dynamic Registration API

**Goal**: Replace the static component registry with a runtime-extensible registry that supports dynamic installation and uninstallation of component packages.

### Package manifest format

```typescript
interface PackageManifest {
  // Identity
  name: string; // e.g. "@we-pkg/music"
  version: string; // semver
  description?: string;
  author?: string;

  // Content
  components: Record<string, ComponentFactory>; // name → render function
  stores?: Record<string, StoreDefinition>; // name → store factory
  models?: Record<string, typeof Ad4mModel>; // name → model class (for $query)
  schemas?: Record<string, SchemaNode>; // name → pre-built schema fragments

  // Heavyweight module fields (optional — empty for component packages)
  languages?: LanguageDefinition[]; // AD4M languages to install
  config?: Record<string, unknown>; // config schema
  initialize?: (config: unknown, ctx: ModuleContext) => Promise<void>;
  cleanup?: (ctx: ModuleContext) => Promise<void>;

  // Security
  capabilities?: string[]; // declared permissions
}
```

A component package only populates `components` and optionally `stores`. A full module populates everything. Same format, two tiers.

### Registration API

```typescript
// packages/app-framework/src/core/registries/packageRegistry.ts

interface PackageRegistry {
  // Install a package (registers its components, stores, models)
  install(manifest: PackageManifest): void;

  // Uninstall a package (removes its registrations)
  uninstall(packageName: string): void;

  // Check what's installed
  isInstalled(packageName: string): boolean;
  getInstalled(): PackageManifest[];

  // Resolve a component by name (checks local registry, then installed packages)
  resolveComponent(name: string): ComponentFactory | undefined;

  // Resolve a store by name (checks framework stores, then package stores)
  resolveStore(name: string): StoreInstance | undefined;
}
```

### Store definition pattern (`defineAppStore`)

```typescript
// Public API for package authors
function defineAppStore(definition: {
  name: string;
  dependencies?: string[]; // e.g. ['query'] — declares what the store needs
  create: (deps: Record<string, unknown>) => Record<string, unknown>;
}): StoreDefinition;
```

Key design decisions:

- **Dependencies declared, not imported.** A store says it needs `query` — the framework provides it at instantiation time. This keeps packages decoupled from framework internals.
- **Lazy instantiation.** `create()` is only called when a `$store` token first references this store. The registry holds the definition; the store provider handles instantiation.
- **Namespace collision prevention.** Two packages can't both register a store named `player`. Second install fails with a clear error.

### Component resolution order

When the schema renderer encounters a component type:

1. Check built-in registry (core components + WE app components)
2. Check installed package registrations
3. If not found → render placeholder with install prompt (graceful degradation)

### Store resolution order

When the schema renderer encounters a `$store` token:

1. Check framework stores (adamStore, routeStore, etc.)
2. Check instantiated package stores
3. If store exists but not yet instantiated → lazy-instantiate via `create(deps)`
4. If store definition not found → log warning, return undefined

### Files changed / created

- `packages/app-framework/src/core/registries/packageRegistry.ts` — new
- `packages/app-framework/src/core/registries/componentRegistry.tsx` — refactor to use packageRegistry as backing store
- `packages/app-framework/src/core/providers/StoreProvider.tsx` — add lazy store instantiation
- `packages/schema-system/solid/src/SchemaRenderer.tsx` — use packageRegistry for component resolution + render placeholder for missing components

---

## Phase 3 — Experience Schema Format

**Goal**: Formalize what an "experience" is — a self-contained, shareable unit that bundles a schema with its dependency declarations.

### Experience schema structure

```typescript
interface ExperienceSchema {
  // Identity
  meta: {
    name: string;
    description?: string;
    author?: string; // DID of the creator
    version?: string;
    icon?: string;
    preview?: string; // URL to screenshot/preview image
  };

  // Dependencies — what needs to be installed for this to render
  dependencies: {
    packages?: string[]; // e.g. ["@we-pkg/music"]
    models?: string[]; // e.g. ["AudioBlock"] — usually covered by packages
  };

  // The actual UI schema (same format as today's template schemas)
  type: string;
  props?: Record<string, unknown>;
  children?: SchemaNode[];
  slots?: Record<string, SchemaNode>;
  routes?: RouteNode[];
}
```

This is intentionally a superset of the existing `TemplateSchema` — an experience is a template with `meta` and `dependencies` added.

### Experience lifecycle

```
Builder creates experience
  → JSON file with dependencies declared

Receiver gets experience (via link, share, neighbourhood)
  → WE parses meta + dependencies
  → Checks which packages are installed
  → Prompts for missing: "This experience uses @we-pkg/music. Install?"
  → User confirms → packages fetched and installed
  → Experience schema renders via existing schema renderer
```

### Experience as a schema scope

The overview describes two schema scopes:

1. **Experience schema** — self-contained app (Spotify alternative, notes app)
2. **User's root schema** — personal workspace, can incorporate elements from multiple experiences

Implementation:

- The root schema is stored in the user's AD4M perspective as a special expression
- Experience schemas are stored either:
  - Locally (in the app's storage, keyed by experience ID)
  - In a perspective (shared with a community/neighbourhood)
- The template store already supports switching between schemas — experiences are just another template source

### Remixing

"Add the music player footer from Harmony to my workspace":

1. AI reads the Harmony experience schema
2. Identifies the `MusicPlayer` component in the `slots.footer` position
3. Extracts the schema fragment + its `$store` / `$query` bindings
4. Checks the user's root schema for a `footer` slot (or creates one)
5. Splices the fragment in
6. Ensures the user has `@we-pkg/music` installed (prompts if not)

This is pure JSON manipulation — the AI operates on schema structure, not code. The key enabler is that `$query` bindings are self-contained (they reference block types by name, not specific data) and `$store` bindings reference package stores by namespace.

### Files changed / created

- `packages/schema-system/shared/src/types.ts` — add `ExperienceSchema` type
- `packages/schema-system/shared/src/validators.ts` — add experience schema validation
- `packages/app-framework/src/core/experienceManager.ts` — new: load, install deps, render experiences

---

## Phase 4 — AD4M-Native Package Distribution

**Goal**: Publish and install component packages via AD4M's language/expression system — no npm, no central registry.

### Why AD4M-native?

AD4M already solves content-addressed, peer-to-peer distribution for languages. The language-language (`lang://`) publishes JavaScript bundles as expressions with content-hash addresses. Component packages are also JavaScript bundles. Use the same mechanism.

### Package as AD4M expression

A published package is an expression containing:

```typescript
{
  manifest: PackageManifest,  // metadata, capabilities, dependency declarations
  bundle: string,             // compiled JS bundle (ESM)
  hash: string                // content hash of the bundle
}
```

Published via a **package language** (analogous to the language-language but for WE packages):

```typescript
// Publish
const address = await ad4m.expression.create(packageLanguageAddress, { manifest, bundle, hash });
// address is now: pkg://Qm...

// Retrieve
const pkg = await ad4m.expression.get(`pkg://${address}`);
```

### Discovery via perspectives

A "marketplace" is a shared perspective (neighbourhood) where agents publish links:

```
marketplace-root --[pkg://has_package]--> pkg://QmMusic123
marketplace-root --[pkg://has_package]--> pkg://QmGovernance456

pkg://QmMusic123 --[pkg://meta]--> { name: "@we-pkg/music", description: "...", author: "did:key:z6Mk..." }
pkg://QmMusic123 --[pkg://version]--> "1.2.0"
pkg://QmMusic123 --[pkg://downloads]--> 1543
```

Anyone can create a marketplace perspective. There can be multiple — curated lists, community-specific, etc. WE can ship with a default one.

### Installation flow

```
User encounters schema with dependency "@we-pkg/music"
  │
  ├── Check local packageRegistry → not installed
  │
  ├── Resolve package address:
  │   ├── Check known marketplace perspectives
  │   ├── Query: links where predicate = "pkg://has_package"
  │   │          and target.meta.name = "@we-pkg/music"
  │   └── Get latest version address
  │
  ├── Fetch expression from AD4M:
  │   └── ad4m.expression.get("pkg://QmMusic123")
  │
  ├── Verify:
  │   ├── Hash matches content
  │   ├── Author DID is valid
  │   └── Capabilities are acceptable
  │
  ├── Prompt user:
  │   └── "@we-pkg/music wants: query:AudioBlock, store:read. Install?"
  │
  ├── User confirms → load bundle:
  │   ├── Evaluate JS module in controlled context
  │   ├── Extract manifest from module exports
  │   └── Call packageRegistry.install(manifest)
  │
  └── Schema re-renders → components now available
```

### Package language implementation

A new AD4M language specifically for WE packages:

```typescript
// bootstrap or installed language
export default function create(context: LanguageContext): Language {
  return {
    name: 'we-package-language',
    expressionAdapter: {
      get: async (address) => {
        // Retrieve package expression by content hash
      },
      putAdapter: {
        createPublic: async (content) => {
          // Validate manifest, store bundle, return content-hash address
        },
      },
    },
    interactions: () => [],
  };
}
```

This could be backed by Holochain (for decentralized storage) or initially by a simpler store (IPFS, centralized gateway during bootstrap) with Holochain as the endgame.

### Offline / cached packages

Once installed, the bundle is cached locally. Packages don't need to be re-fetched on every app start. The local cache maps `packageName@version → bundle + manifest`.

### Files changed / created

- `packages/app-framework/src/core/packageResolver.ts` — new: resolves package names to AD4M expression addresses
- `packages/app-framework/src/core/packageInstaller.ts` — new: fetches, verifies, loads, registers
- `packages/app-framework/src/core/packageCache.ts` — new: local persistence of installed packages
- New AD4M language: `we-package-language` (separate repo or bootstrap language)

---

## Phase 5 — Security Model

**Goal**: Establish trust and permission boundaries for third-party code.

### Capability declarations

Every package manifest declares what it needs:

```typescript
capabilities: [
  'query:AudioBlock', // can query AudioBlock model
  'query:CollectionBlock', // can query CollectionBlock model
  'store:read:adamStore.me', // can read current user identity
  'action:modalStore.openModal', // can open modals
  'network:fetch', // can make HTTP requests
  'ad4m:perspectives:read', // can read AD4M perspectives
];
```

At installation, WE shows the user what the package requests. User can accept or reject.

### Trust levels

| Level         | Source                                 | Verification              | Sandbox               |
| ------------- | -------------------------------------- | ------------------------- | --------------------- |
| **Built-in**  | Ships with WE                          | Implicit trust            | None                  |
| **Verified**  | Signed by known publisher, audited     | DID signature check       | Capability-gated      |
| **Community** | Published in a marketplace perspective | Content hash + author DID | Capability-gated      |
| **Unknown**   | Direct share, no marketplace           | Content hash only         | Full sandbox (future) |

Initially, all third-party packages are **community** level — capability declarations + user consent. Full sandboxing (ShadowRealm, isolated execution) is a future hardening layer.

### Capability enforcement

The package registry wraps store access and query service access with capability checks:

```typescript
// When a package store tries to access the query service:
const gatedQueryService = {
  subscribe(params: QueryParams) {
    if (!manifest.capabilities.includes(`query:${params.model}`)) {
      throw new Error(`Package "${manifest.name}" lacks capability "query:${params.model}"`);
    }
    return realQueryService.subscribe(params);
  },
};
```

### Schema capability inference

When a schema declares dependencies, WE can infer required capabilities from the schema's `$query` and `$store` tokens — and verify they match what the package declares. Mismatch = warning.

---

## Phase 6 — Experience Sharing Between Peers

**Goal**: Enable direct peer-to-peer experience sharing via AD4M neighbourhoods.

### Sharing an experience

```typescript
// User shares an experience to a neighbourhood
const experienceExpression = await ad4m.expression.create(
  experienceLanguageAddress,
  experienceSchema, // JSON — just data
);

await ad4m.perspective.addLink(neighbourhoodUrl, {
  source: 'experience-list',
  predicate: 'we://shared_experience',
  target: experienceExpression,
});
```

### Receiving an experience

When a user joins a neighbourhood that has shared experiences:

1. Query links with predicate `we://shared_experience`
2. Display experience list with meta info (name, description, author, preview)
3. User selects one → dependency resolution kicks in (Phase 4 flow)
4. Experience renders

### Experience forking

"Fork this experience and customize it":

1. Deep copy the experience schema JSON
2. Store as a new expression (new address, user is author)
3. User modifies via AI or direct schema editing
4. Can share the fork back to the neighbourhood

Since schemas are JSON data, forking is just a copy. The fork links back to the original via `meta.forkedFrom`.

### Community template sharing

A community (neighbourhood) can have a default experience:

```
neighbourhood-root --[we://default_experience]--> exp://QmCommunityLayout
neighbourhood-root --[we://available_experiences]--> exp://QmAlternateLayout
```

When a user joins, they get the default experience. They can switch to alternatives or fork and customize.

---

## Implementation Sequence

```
Phase 1: $query + Reactive Query Service
  │  ← Highest impact. Makes data sharing real.
  │     Schemas can bind to block data without custom stores.
  │     Enables "competing apps share the same data" promise.
  │
Phase 2: Dynamic Registration API
  │  ← Enables runtime extensibility.
  │     packageRegistry, defineAppStore, lazy instantiation.
  │     Prerequisite for everything after.
  │
Phase 3: Experience Schema Format
  │  ← Formalizes the shareable unit.
  │     meta + dependencies + schema = one JSON object.
  │     Enables "open this experience" flow.
  │
Phase 4: AD4M-Native Distribution
  │  ← Enables peer-to-peer package sharing.
  │     No npm dependency. Content-addressed. Offline-cached.
  │     Requires building the package language.
  │
Phase 5: Security Model
  │  ← Enables trust boundaries.
  │     Capability declarations, user consent, enforcement.
  │     Can be basic initially, hardened over time.
  │
Phase 6: Peer Experience Sharing
     ← Enables the full ecosystem loop.
        Share experiences + forks in neighbourhoods.
        Community default templates.
```

### What's usable at each phase

| After Phase | What works                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1           | Schemas can `$query` block data declaratively. Two schemas reading the same data "just work."                                           |
| 2           | External component packages can be loaded at runtime. `defineAppStore()` works. Placeholder fallback for missing components.            |
| 3           | Experiences are a formal thing — install prompt for missing deps, remixing via AI. Still requires manual package import (dev workflow). |
| 4           | Packages resolve and install from AD4M network. No npm. First real "install this experience" for end users.                             |
| 5           | Users see capability prompts. Packages can't exceed declared permissions. Safe to install community packages.                           |
| 6           | Full loop: share experience in neighbourhood → peer installs → forking → community templates.                                           |

---

## Open Questions

### 1. Bundle format and size

Component packages contain compiled JS. How big is acceptable? Options:

- **ESM bundles** with tree-shaking — consumers import only what they use
- **Pre-bundled single file** — simpler distribution but larger payloads
- **Source code + build recipe** — maximum flexibility but requires build tooling on the receiving end

Recommendation: Pre-bundled ESM. The package author builds once, everyone consumes the same bundle. Keep packages small by convention (a music player package shouldn't include a 3D rendering engine).

### 2. SolidJS coupling

Component packages currently must export SolidJS components. This means the entire ecosystem is SolidJS-specific. Options:

- **Accept it.** SolidJS is WE's framework. Component packages are SolidJS packages.
- **Web component bridge.** Packages can export web components instead, which the SolidJS renderer wraps. More framework-agnostic but adds complexity.
- **Dual export.** Packages export both SolidJS components and web components. Most flexible but doubles authoring work.

Recommendation: Accept SolidJS coupling initially. The web component bridge is a reasonable future evolution, but premature now. The existing design system already uses Lit web components for primitives — the pattern exists if needed.

### 3. Package versioning and updates

When a package author publishes v2 with breaking schema changes:

- Do experiences referencing v1 break?
- Does WE auto-update packages?
- How are version conflicts handled (two experiences need different versions of the same package)?

Recommendation: Content-addressed distribution helps — v1 and v2 are different expressions. Experiences pin to a specific package address (content hash), not a floating version. Users opt into updates explicitly. Version conflicts are avoided because each experience references a specific hash.

### 4. Store persistence

App stores (like `PlayerStore`) hold ephemeral state. But some state should persist across sessions (queue, preferences). Where does it live?

- **AD4M perspective links** — user's subjective data about their use of the experience
- **Local storage** — simple but not synced
- **Store declares persistence** — `defineAppStore({ persist: ['queue', 'preferences'] })` and the framework handles it

Recommendation: AD4M perspective links for anything that should sync across devices. Local storage for truly ephemeral session state. The `persist` declaration in `defineAppStore` is the right API shape.

### 5. Reconciling the module guide

The existing [module development guide](../../guides/module-development.md) describes a class-based store pattern (`class ProposalStore { ... }`) while the overview describes a functional pattern (`defineAppStore({ create: (deps) => ... })`). These need to be unified.

Recommendation: The functional pattern (`defineAppStore`) is better — it enforces dependency injection, avoids class boilerplate, and makes the store a plain object of signals + methods that the schema renderer can directly resolve via `$store`. Update the module guide to match.
