# External Perspective Model Rendering

## Overview

Enable the AI schema generator to discover, understand, and query data models from any AD4M perspective — including those created by third-party apps like Flux — and generate WE schema templates that render that data on the fly. This is the escape hatch beyond the WE block system for cases where an app's data doesn't map to the common grammar.

---

## Problem

The current `$query` token requires model classes to be pre-registered in WE's global `modelRegistry` at build time. Only WE-native models (`CollectionBlock`, `TextBlock`, `Signal`, etc.) are registered. Third-party app models (e.g. Flux's `Channel`, `Message`, `Conversation`) live in separate npm packages and are never imported by WE.

This means the AI cannot currently generate templates that query data from embedded or linked apps. It has no knowledge of those models' property names, predicates, or data shapes.

The ideal outcome: open any AD4M perspective, read its models directly from the perspective itself, and generate a schema template that renders the contents — with zero pre-registration or WE-side coordination required.

---

## Background: What's Already in Place

### SHACL shapes are stored in every perspective

Every time an AD4M app registers a model (e.g. Flux registers `Channel`), it writes SHACL shape definitions as links into the perspective. `PerspectiveProxy` already exposes:

- `getAllShacl()` — returns `Array<{ name: string, shape: SHACLShape }>` for every registered class
- `getShacl(name)` — returns the full `SHACLShape` for a single class

`SHACLShape` contains: target class URI, property names, their predicate URIs, datatypes, cardinality (`maxCount: 1` = scalar, omitted = collection), `writable`, `resolveLanguage`, and typed relation targets (`class`).

### `Ad4mModel.fromJSONSchema()` exists (but is the wrong tool here)

AD4M core already has a mechanism to synthesise a fully functional `Ad4mModel` subclass at runtime. However, `fromJSONSchema()` was designed for the case where predicates are **not explicitly known** — it spends most of its code inferring predicate URIs from namespace patterns, `x-ad4m` metadata, or title inference.

A `SHACLShape` is different: it already stores the exact predicate URI in `path` for every property. No inference is needed. The only actual work is populating the same WeakMap metadata registries (`setPropertyRegistryEntry`, `setRelationRegistryEntry`) that `fromJSONSchema()` calls at its very end after all the inference. A direct `fromSHACL()` path skips all the intermediate steps.

### The MCP server's `get_models` is intentionally thin

The AD4M MCP `get_models` tool returns only class names (a `string[]`). The dynamic tool generation in `dynamic.rs` calls `shacl::load_classes()` with full property metadata, but that's internal to Rust — not exposed to TypeScript consumers. Using MCP from within WE would also be wrong architecturally: WE has a live `PerspectiveProxy` in-process; routing through HTTP is wasteful indirection.

### `$query` already has a `perspectiveStore` field

```json
{ "$query": { "model": "Channel", "perspectiveStore": "adamStore.currentPerspective" } }
```

The field is declared in `packages/schema-system/shared/src/types.ts` and resolved in `SchemaRenderer.tsx` — it dot-walks any store path (e.g. `adamStore.currentPerspective`) to obtain a `PerspectiveProxy`, then passes it to `findAll()` / `subscribe()`. The routing mechanism is complete.

What does **not** yet exist: `adamStore.currentPerspective` itself (PR B adds it), and the UUID-aware model lookup needed to resolve synthesised classes (PR C wires it in). The `$query` token does not need to change.

---

## Proposed Solution

Four focused changes across AD4M and WE, in dependency order.

---

### Change 1 — AD4M: `fromSHACL()` + `getModelClasses()` + `getModelManifest()`

Three new additions to AD4M core, each with a distinct purpose:

#### `Ad4mModel.fromSHACL(shape, name)` — direct class synthesis

A new static method that creates a fully functional `Ad4mModel` subclass from a `SHACLShape` directly, bypassing all the namespace/predicate inference machinery in `fromJSONSchema()`.

`SHACLPropertyShape.path` is the exact predicate URI. There is nothing to infer. The method reads each property's `path`, `maxCount`, `minCount`, `writable`, `resolveLanguage` fields and writes them directly to the WeakMap metadata registries (`setPropertyRegistryEntry`, `setRelationRegistryEntry`) — identically to what `fromJSONSchema()` does at the very end, after all its inference code.

```typescript
// In Ad4mModel:
static fromSHACL(shape: SHACLShape, name: string): typeof Ad4mModel
```

Properties with `hasValue` (flag constraints) are excluded — they are type discrimination markers, not data properties. Properties without a `name` field on the `SHACLPropertyShape` are skipped. Collections (`maxCount` absent or `> 1`) become `setRelationRegistryEntry` entries with `kind: 'hasMany'`; scalars become `setPropertyRegistryEntry` entries.

#### `PerspectiveProxy.getModelClasses()` — one call, ready-to-register classes

Combines `getAllShacl()` + `fromSHACL()` behind a single call. Returns a `Record<string, typeof Ad4mModel>` keyed by class name, ready to pass directly to `registerDynamicModels()` in WE. No mapping, no intermediate format.

```typescript
// In PerspectiveProxy:
async getModelClasses(): Promise<Record<string, typeof Ad4mModel>>
```

#### `PerspectiveProxy.getModelManifest()` — AI prompt context only

A separate, purpose-built serialisation for injecting into the AI prompt. Returns a clean, human-readable JSON structure that describes models without SHACL vocabulary. This is not used for class synthesis — only for the AI to understand what models exist and what properties they have.

```typescript
export interface ModelManifestProperty {
  name: string;           // "name", "body", "participants"
  predicate: string;      // "flux://has_name" — the actual triple predicate
  type: 'string' | 'number' | 'boolean' | 'uri';  // normalised from xsd: + nodeKind
  isCollection: boolean;  // maxCount > 1 or absent → true; maxCount === 1 → false
  required: boolean;      // minCount >= 1
  writable: boolean;
  resolveLanguage?: string;
  relatedModel?: string;  // populated from SHACLPropertyShape.class — e.g. "Message", "User"
}

export interface ModelManifestEntry {
  name: string;           // "Channel" — usable directly as $query model name
  targetClass: string;    // "flux://Channel"
  properties: ModelManifestProperty[];
}

// In PerspectiveProxy:
async getModelManifest(): Promise<ModelManifestEntry[]>
```

**Implementation:** calls `getAllShacl()` and maps each `SHACLPropertyShape` to `ModelManifestProperty` (normalising `xsd:string`/`sh:Literal` → `'string'`, `sh:IRI` → `'uri'`, `xsd:integer`/`xsd:decimal` → `'number'`, `xsd:boolean` → `'boolean'`). Properties with `hasValue` are excluded. The `class` field on `SHACLPropertyShape` (the target model name for typed relations — e.g. `flux://Message`) is stripped to just the local name and stored as `relatedModel`.

**Why `relatedModel` matters:** without it, relation properties appear as `messages (uri, collection)` — opaque to the AI. With it: `messages (Message[], collection)`. The AI can then reason about the object graph, know which other models are reachable, and generate nested templates that use `$query` on related model classes. Class names like `Channel`, `Message`, `Post`, `User` carry deep domain semantics the AI already understands; typed relations complete the picture.

The Rust `ShaclClass` / `ShaclProperty` types in `mcp/shacl.rs` are structurally equivalent to `ModelManifestEntry` — both are normalised views over the same SHACL links, readable without SHACL vocabulary knowledge.

---

### Change 2 — WE: Per-perspective model registry

The current global `modelRegistry` is the wrong scope for dynamic classes. `Channel` means different things (different predicates) in different perspectives.

**Changes to `packages/app-framework/src/shared/registries/modelRegistry.ts`:**

```typescript
type ModelClass = typeof Ad4mModel & (new (...args: any[]) => Ad4mModel);

// Existing — WE-native models only, registered at module load
const modelRegistry: Record<string, ModelClass> = {};

// New — dynamic models scoped by perspective UUID
const perspectiveModelRegistry = new Map<string, Record<string, ModelClass>>();

// Existing (unchanged)
export function registerModel(name: string, modelClass: ModelClass): void { ... }

// New — register a batch of synthesised classes for a specific perspective
export function registerDynamicModels(
  perspectiveUuid: string,
  models: Record<string, ModelClass>
): void {
  perspectiveModelRegistry.set(perspectiveUuid, models);
}

// New — UUID-aware lookup, falls back to global registry
export function getModelForPerspective(
  name: string,
  perspectiveUuid?: string
): ModelClass | undefined {
  if (perspectiveUuid) {
    const local = perspectiveModelRegistry.get(perspectiveUuid)?.[name];
    if (local) return local;
  }
  return modelRegistry[name];
}
```

The existing `getModel(name)` is kept unchanged for backwards compatibility (all current callers pass no UUID).

---

### Change 3 — WE: `currentPerspective` as universal perspective signal in `AdamStore`

**New state in `AdamStore`:**

```typescript
currentPerspective: Accessor<PerspectiveProxy | null>;
setCurrentPerspective: (uuid: string) => Promise<void>;
currentPerspectiveModels: Accessor<ModelManifestEntry[]>; // non-WE models only (WE models already in AI system prompt)
```

`currentPerspective` is the **single universal signal** for "what perspective are we currently looking at" — whether that is a WE space, a pure external perspective (e.g. Flux standalone), or a mixed perspective containing both WE space data and third-party app data. It replaces the per-store perspective fetching that currently lives inside `SpaceStore`.

**`setCurrentPerspective(uuid)` logic:**

1. Fetches `PerspectiveProxy` via `adamClient.perspective.byUUID(uuid)` (moves out of SpaceStore)
2. Calls `perspective.getModelClasses()` → `Record<string, typeof Ad4mModel>` — synthesises all SHACL-defined classes
3. Calls `registerDynamicModels(uuid, classes)`
4. Calls `perspective.getModelManifest()` → `ModelManifestEntry[]`, filters out models already in the global `modelRegistry` (WE-native models are pre-registered and already described in the AI system prompt — no need to duplicate), stores remainder in `currentPerspectiveModels`
5. Sets `currentPerspective` signal

**SpaceStore becomes a reactive lens over `currentPerspective`:**

SpaceStore's current `createEffect` watches `routeStore.currentPath()` and fetches the perspective itself via `byUUID`. This is replaced: SpaceStore watches `adamStore.currentPerspective()` and runs its WE-specific hydration layer on top:

```typescript
// SpaceStore — new reactive trigger (replaces route-watching effect)
createEffect(async () => {
  const p = adamStore.currentPerspective();
  if (!p) {
    setSpace(null);
    setPerspective(null);
    return;
  }

  // WE-specific: register WE model schemas, query Space + SignalType
  await Promise.all([
    CollectionBlock.register(p),
    TextBlock.register(p),
    ImageBlock.register(p),
    Signal.register(p),
    SignalType.register(p),
  ]);
  const [spaceModel] = await Space.findAll(p);
  setPerspective(p); // spaceStore.perspective stays valid
  setSpace(spaceModel ?? null); // null if no Space found (raw perspective)
  const signalTypes = await SignalType.findAll(p);
  setSignalTypes(signalTypes);
});
```

For a **pure WE space**: everything works as before — `setSpace` gets a `Space` instance, all space chrome renders.
For a **pure external perspective**: `Space.findAll` returns `[]`, `setSpace(null)` — space chrome hides, perspective route renders.
For a **mixed perspective** (WE space + Flux data): both layers run. SpaceStore hydrates space data. `currentPerspectiveModels` holds the Flux models (WE models filtered out). The AI chat receives both WE space context (from the system prompt) and Flux model context (from `externalModels`) simultaneously — the AI can generate templates that combine WE blocks and Flux data in a single schema.

**Triggering `setCurrentPerspective`:**

- Space navigation: clicking a space card in the sidebar (or HomeRoute) calls `setCurrentPerspective(uuid)` then navigates to `/space/:uuid` — SpaceStore reacts reactively
- Perspective navigation: clicking a raw perspective in the sidebar calls `setCurrentPerspective(uuid)` then navigates to `/perspective/:uuid`
- Future: an embedded app posts `FOCUS_PERSPECTIVE` postMessage

---

### Change 4 — WE: Renderer UUID-aware model lookup + AI context injection

**`packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx`:**

The `perspectiveStore` resolution already extracts a `PerspectiveProxy`. Add a one-liner to extract `.uuid` from it and pass it to the model lookup:

```typescript
// Before (schematic):
const ModelClass = getModel(descriptor.model);

// After:
const perspectiveUuid = resolvedPerspective?.uuid;
const ModelClass = getModelForPerspective(descriptor.model, perspectiveUuid) ?? getModel(descriptor.model);
```

**`packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`:**

When building the per-message payload, conditionally append model context if `adamStore.currentPerspectiveModels()` is non-empty:

```typescript
const manifest = adamStore.currentPerspectiveModels();
const externalModelsContext =
  manifest.length > 0
    ? formatManifestForPrompt(manifest) // see below
    : '';

// Appended to the user message alongside currentSchema
content: JSON.stringify({
  request: msg.content,
  currentSchema: schemaWithIds,
  ...(externalModelsContext && { externalModels: externalModelsContext }),
});
```

**`formatManifestForPrompt(manifest)`** produces something like:

```
External perspective models available via perspectiveStore: 'adamStore.currentPerspective':

Channel — flux://Channel
  • name (string, required, writable) — predicate: flux://has_name
  • description (string, writable) — predicate: flux://has_description
  • participants (User[], collection) — predicate: flux://participant
  • messages (Message[], collection) — predicate: flux://has_message

Message — flux://Message
  • body (string, required, writable) — predicate: flux://body
  • reactions (Reaction[], collection) — predicate: flux://reaction
  ...

Use $query with model: '<ClassName>' and perspectiveStore: 'adamStore.currentPerspective' to query these.
```

This injects the AI context dynamically at send-time, scoped to the current perspective. No static manifests, no hand-authored integration files.

---

### Change 5 — WE: Sidebar Perspectives group

**`packages/app-framework/src/shared/schemas/shell/Sidebar.schema.ts`:**

Two targeted changes to the existing sidebar schema:

**1. Context-aware top item.** The current-space item shows the space name when in a WE space, or `else: 'Root'`. Extend this to three states:

- WE space active → space name + `map-pin-area` icon (unchanged)
- Focus perspective active (no space) → `adamStore.currentPerspective.name` + `intersect-three` icon
- Neither → `'Home'` + `house-line` icon, clicking navigates to `/`

**2. New Perspectives group** (between the current-space item and the Templates group):

```json
{
  "type": "group",
  "id": "perspectives",
  "label": "Perspectives",
  "collapsed": true,
  "items": {
    "$map": {
      "items": { "$store": "adamStore.allPerspectives" },
      "select": {
        "id": "$item.uuid",
        "icon": {
          "$if": {
            "condition": "$item.sharedUrl",
            "then": "globe",
            "else": {
              "$if": {
                "condition": { "$store": "spaceStore.space" },
                "then": "folder",
                "else": "intersect-three"
              }
            }
          }
        },
        "label": "$item.name",
        "active": { "$eq": ["$item.uuid", { "$store": "adamStore.currentPerspective.uuid" }] },
        "onClick": [
          { "$action": "adamStore.setCurrentPerspective", "args": ["$item.uuid"] },
          {
            "$if": {
              "condition": "$item.sharedUrl",
              "then": { "$action": "routeStore.navigate", "args": [{ "$concat": ["/space/", "$item.uuid"] }] },
              "else": { "$action": "routeStore.navigate", "args": [{ "$concat": ["/perspective/", "$item.uuid"] }] }
            }
          }
        ]
      }
    }
  }
}
```

The group is `collapsed: true` by default — `CollapsibleSidebar` already supports this via `group.collapsed`. Uses `allPerspectives` (not a filtered subset) so every perspective is reachable. Visual differentiation: `globe` for shared spaces (has `sharedUrl`), `folder` for personal spaces, `intersect-three` for raw perspectives. Navigation targets `/space/:uuid` for spaces (SpaceStore chrome applies) and `/perspective/:uuid` for raw perspectives (external template route). Both paths call `setCurrentPerspective` first — SpaceStore reacts from there.

---

### Change 6 — WE: `/perspective/:uuid` route

**New route in `DefaultTemplate`** (`packages/app-framework/src/shared/schemas/DefaultTemplate/routes/PerspectiveRoute/index.ts`):

The first time a user navigates to `/perspective/:uuid` there is no saved template for that perspective. The route renders an empty state that:

1. Shows the perspective name and a brief description of what was found (model count)
2. Opens the AI chat panel automatically (or shows a prominent CTA button that does)
3. Pre-seeds the opening message: _"I found these models in this perspective: Channel, Message, Post. What would you like to see?"_ — generated from `currentPerspectiveModels`

Once the AI generates and saves a template, subsequent visits to the same UUID render that template instead (resolved via `templateStore` by UUID key).

This route does not need to be complex — the AI does the heavy lifting. The key pieces:

- Read perspective name from `adamStore.currentPerspective.name`
- Show model names from `adamStore.currentPerspectiveModels` as a badge list so the user can see what's available
- A single "Generate template" / "Open AI Chat" button wired to `aiStore.openWithSeed` (new or existing action)

---

## What Does NOT Change

- The `$query` token definition and resolver — no changes
- `getModel()` and `registerModel()` — kept exactly as-is, existing callers unaffected
- Hydration, subscriptions, `findAll()`, `$each` — all existing downstream query machinery unchanged
- **`SpaceStore`'s public API** — `spaceStore.perspective`, `.space`, `.signalTypes`, `.signalTypesBySlug`, `.upsertSignal` and all existing actions are unchanged; the 100+ schema references to `spaceStore.*` continue to work without modification
- No `PerspectiveStore` — `currentPerspective` lives in `AdamStore` alongside `allPerspectives`
- No UUID in model names — clean names like `'Channel'` throughout
- No MCP calls from within WE — direct `PerspectiveProxy` access in-process

**What does change internally (no external API impact):**

- `SpaceStore` stops watching `routeStore.currentPath()` directly; instead reacts to `adamStore.currentPerspective()`
- `SpaceStore.getSpace()` no longer calls `adamClient.perspective.byUUID()` — the perspective arrives via `currentPerspective`
- Space navigation (sidebar click, HomeRoute card click) calls `setCurrentPerspective(uuid)` before or instead of navigating

---

## Work Breakdown

### PR A — AD4M: `fromSHACL()`, `getModelClasses()`, `getModelManifest()` (prerequisite)

- [ ] Add `Ad4mModel.fromSHACL(shape: SHACLShape, name: string)` static method to `Ad4mModel.ts` — reads `SHACLPropertyShape.path`/`maxCount`/`minCount`/`writable`/`resolveLanguage` directly into `setPropertyRegistryEntry`/`setRelationRegistryEntry`; skips `hasValue` flag properties; applies `Model({ name })` decorator
- [ ] Add `PerspectiveProxy.getModelClasses()` — calls `getAllShacl()`, maps each entry through `Ad4mModel.fromSHACL()`, returns `Record<string, typeof Ad4mModel>`
- [ ] Add `ModelManifestProperty`, `ModelManifestEntry` types and `PerspectiveProxy.getModelManifest()` — normalised serialisation for AI prompt context
- [ ] Unit tests for `fromSHACL`: scalar vs collection, required, writable, resolveLanguage, flag exclusion, properties without `name` skipped
- [ ] Unit tests for `getModelManifest`: `xsd:string` → `'string'`, `sh:IRI` → `'uri'`, `xsd:integer` → `'number'`, `xsd:boolean` → `'boolean'`, `class` URI → `relatedModel` local name
- [ ] Export `ModelManifestProperty`, `ModelManifestEntry` from `@coasys/ad4m` index

**Files:** `ad4m/core/src/model/Ad4mModel.ts`, `ad4m/core/src/perspectives/PerspectiveProxy.ts`, `ad4m/core/src/index.ts`

---

### PR B — WE: Per-perspective registry + `AdamStore`/`SpaceStore` refactor + Sidebar UX

- [ ] Extend `modelRegistry.ts` with `registerDynamicModels` + `getModelForPerspective`
- [ ] Add `currentPerspective`, `currentPerspectiveModels`, `setCurrentPerspective` to `AdamStore` — `setCurrentPerspective` fetches perspective via `byUUID`, runs `getModelClasses()` + `registerDynamicModels()`, runs `getModelManifest()` filtered to non-WE models, sets signal
- [ ] Refactor `SpaceStore`: remove route-watching `createEffect`; add `createEffect` watching `adamStore.currentPerspective()` — runs WE SHACL registration + `Space.findAll` + `SignalType.findAll`; sets `space` to `null` if no Space found
- [ ] Update space navigation call sites (sidebar space items, HomeRoute space cards) to call `adamStore.setCurrentPerspective(uuid)` before navigating
- [ ] Update `Sidebar.schema.ts`: context-aware top item (space / focus perspective / home) + collapsible Perspectives group over `allPerspectives` with icon differentiation and smart routing
- [ ] Update `stores.ts` fragment in `@we/ai-context` to document new `adamStore` state/actions

**Files:** `packages/app-framework/src/shared/registries/modelRegistry.ts`, `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx`, `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`, `packages/app-framework/src/shared/schemas/shell/Sidebar.schema.ts`, `packages/ai-context/src/fragments/stores.ts`

---

### PR C — WE: Renderer UUID lookup + AI context injection

**Depends on PR A and PR B.**

- [ ] Update `SchemaRenderer.tsx` to pass perspective UUID to `getModelForPerspective`
- [ ] Add `formatManifestForPrompt()` to AiStore (or a new prompts helper)
- [ ] Inject `externalModels` into per-message payload when `currentPerspectiveModels` is non-empty
- [ ] **Update `schema-operators.ts`** — add `perspectiveStore` to the `$query` documentation. Without this, the AI only knows `$query` targets "the local perspective" and will never emit `perspectiveStore` even when it receives external model context. Minimal addition:
  ```
  perspectiveStore: "adamStore.currentPerspective"  — target a different perspective; omit to use the current space perspective
  ```
- [ ] **Update `chatSystemPrompt.ts`** — document the `externalModels` field in the User Message Format section. The AI needs to know: when `externalModels` is present, those models live in the focus perspective and must be queried with `perspectiveStore: 'adamStore.currentPerspective'`. A simple note is enough:
  ```
  externalModels?: string  — present when a non-WE perspective is in focus. Lists its models with
                             property names, types, and predicates. Use $query with
                             perspectiveStore: 'adamStore.currentPerspective' to query them.
                             DO NOT query these models without perspectiveStore — they are not in the space perspective.
  ```
- [ ] Update `chatSystemPrompt.ts` to mention `externalModels` field and how to use it
- [ ] Add `/perspective/:uuid` route to DefaultTemplate — empty state showing model list from `currentPerspectiveModels` + AI chat CTA
- [ ] Manual test: click a raw perspective in sidebar, verify route loads, ask AI to render data, verify working `$query`

**Files:** `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx`, `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`, `packages/app-framework/src/shared/prompts/chatSystemPrompt.ts`, `packages/ai-context/src/fragments/schema-operators.ts`, `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/PerspectiveRoute/index.ts`

---

## Open Questions

1. **Synthesis fidelity for custom getter expressions** — properties with hand-written Prolog `getter` expressions (e.g. `Message.isPopular`) won't have correct query behaviour when synthesised via `fromSHACL()` because the SHACL `getter` field stores a pre-computed SPARQL string rather than a Prolog expression. The SPARQL getter is present in `SHACLPropertyShape` and could be wired up as a `prologGetter`-equivalent in future, but for now these properties are synthesised as read-only with a basic triple lookup. They'll appear in AI context via `getModelManifest()` and render correctly; they just won't support computed aggregations.

2. **Subscription behaviour for synthesised classes** — `subscribe: true` in `$query` requires the model class to correctly identify which perspective link changes are relevant. Synthesised classes using `fromJSONSchema()` should inherit the default subscription behaviour. Needs verification in an integration test.

3. **`aiStore.openWithSeed`** — the `/perspective/:uuid` empty state wants to open AI chat with a pre-generated opener message describing the discovered models. Whether this is a new `openWithSeed(message)` action on `aiStore` or just `toggle()` + a reactive initial message derived from `currentPerspectiveModels` is TBD. The simpler path (no new action) is to render the model list in the empty state and let the user type their own prompt, with the `externalModels` context injected automatically.

4. **WE model filtering in `currentPerspectiveModels`** — `setCurrentPerspective` filters out models already in the global `modelRegistry` before storing the manifest, on the assumption those models are already covered by the WE system prompt. If a third-party app happens to define a model with the same name as a WE model (e.g. a custom `TextBlock`), the WE version silently wins. This is acceptable for now; a namespace-aware filter (by `targetClass` URI prefix) would be more robust in future.

5. **Multi-perspective templates** — a template might want to query two perspectives simultaneously (e.g. WE space blocks + Flux messages in separate perspectives). The per-perspective registry handles this naturally — two `$query` tokens with different `perspectiveStore` values, each resolving its own UUID-scoped models. No additional work needed. The mixed-perspective case (both data types in the same perspective, Change 3) is the more common scenario and is handled by the SpaceStore refactor.
