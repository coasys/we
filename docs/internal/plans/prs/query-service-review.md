# `$query` Service — Pre-Implementation Review

Review of the [query-service plan](query-service.md) against the actual codebase. Each section is a discussion point to resolve before writing code.

---

## 1. Model Registry — Where Does It Live?

**Plan says:** Create a new model registry (~25 lines) mapping model names to classes.

**Codebase reality:** 6 registries already exist, but none are keyed by Ad4mModel class name:

| Registry      | Package                            | Keyed by                          | Purpose                                                |
| ------------- | ---------------------------------- | --------------------------------- | ------------------------------------------------------ |
| Block         | `block-system/shared/registries/`  | Lexical node type (`"paragraph"`) | Node type → Ad4mModel class + display/input components |
| Template      | `app-framework/shared/registries/` | Template ID (`"twitter"`)         | ID → TemplateSchema objects                            |
| Component     | `app-framework/solid/registries/`  | Component name (`"Accordion"`)    | Name → SolidJS component functions                     |
| Layer Factory | `app-framework/solid/registries/`  | Factory name                      | Cesium globe layers                                    |
| Launcher UI   | `app-framework/shared/registries/` | Property name                     | Boot screen / app settings schemas                     |
| Theme         | `app-framework/shared/registries/` | Theme name (`"dark"`)             | Theme metadata                                         |

The block registry is closest (it _has_ Ad4mModel classes) but it's keyed by Lexical node type and scoped to blocks only. Non-block models (Space, Agent, Post, etc.) wouldn't belong there.

**Decision:** New model registry in `app-framework/src/shared/registries/modelRegistry.ts`.

This follows the established pattern: `app-framework/registries/` is where all app-level registries live. `@we/models` defines what models _are_ (class definitions); `app-framework/registries` defines what's _available to the app_ at runtime. Same separation as components: classes in `@we/components`, registry in `app-framework/registries/componentRegistry`.

---

## 2. `$query` Design — Prop-Level Data Source

### Architecture fit

The schema token system has a clean taxonomy:

| Category         | Tokens                                                     | Purpose               |
| ---------------- | ---------------------------------------------------------- | --------------------- |
| **Data sources** | `$store`, context refs (`$item.name`)                      | Read reactive data    |
| **Transforms**   | `$concat`, `$map`, `$pick`, `$if`, `$eq`, `$ne`, `$not`, `$and`, `$or` | Shape values          |
| **Control flow** | `$each`, `$if` (node), `$routes`                           | Decide what renders   |
| **Side effects** | `$action`                                                  | Call store methods    |

`$query` is a **data source** — it reads model data from Ad4m, just as `$store` reads framework state. It belongs at the prop level, alongside `$store`. One new token, zero new architectural concepts.

### Single form: prop-level only, always returns `T[]`

```json
{ "$query": { "model": "Task", "where": { "status": "active" }, "order": { "createdAt": "DESC" } } }
```

No node annotation form. No dual-use. `$query` sources data. `$each` handles rendering and context binding. Existing tokens compose naturally.

**List display:**

```json
{
  "type": "$each",
  "props": {
    "items": { "$query": { "model": "Task", "order": { "createdAt": "DESC" } } }
  },
  "children": [{ "type": "Card", "props": { "title": "$item.title" } }]
}
```

**Single item display** — `$each` with one result renders one template:

```json
{
  "type": "$each",
  "props": {
    "items": { "$query": { "model": "Task", "where": { "id": "abc-123" } } },
    "as": "task"
  },
  "children": [{
    "type": "Column",
    "children": [
      { "type": "Badge", "props": { "label": "$task.status" } },
      { "type": "Card", "props": { "title": "$task.title", "description": "$task.description" } }
    ]
  }]
}
```

- `$each` already provides context binding via `as` — all descendants access `$task.*`
- Zero results = nothing renders (natural empty state, no `undefined` binding)
- Same pattern for both single and list — one mental model for AI authors
- Composes freely with existing tokens: `{ "$map": { "items": { "$query": {...} }, "select": {...} } }`

**Why not a node annotation form:**

- No other data source lives at the node level — that would be a new architectural concept
- `$each` already handles context binding and iteration — duplicating that in `$query` is redundant
- Fewer forms = smaller AI decision surface = fewer misconfigurations
- Forward-compatible: if `$bind` (general-purpose context scoping) is added later, `$query` doesn't change

### Async in a sync dispatcher

Both `ModelQueryBuilder.subscribe()` and `Model.findAll()` return Promises. `resolveProp()` is synchronous.

**Solution:** Create a signal initialized to `[]`, kick off the async query in the background, return the signal immediately. Signal updates when results arrive. Standard SolidJS async-data pattern.

### Subscribe vs one-shot

Not every query needs a live subscription. `subscribe` boolean flag (default `true`):

```json
{ "$query": { "model": "TextBlock", "where": { "status": "published" } } }
{ "$query": { "model": "TextBlock", "where": { "type": "config" }, "subscribe": false } }
```

- **`subscribe: true`** → `Model.query(perspective, params).subscribe(setter)` — builder required (subscribe only exists on builder)
- **`subscribe: false`** → `Model.findAll(perspective, params).then(setter)` — static method, no builder, no cleanup

Both accept the same `Query` object. Future upstream AD4M work may unify these (see [ad4m-static-subscribe plan](ad4m-static-subscribe.md)).

### `$query` params

| Param       | Type    | Default  | Effect                             |
| ----------- | ------- | -------- | ---------------------------------- |
| `model`     | string  | required | Model class name → registry lookup |
| `where`     | object  | `{}`     | Filter conditions                  |
| `order`     | object  | —        | Sort order                         |
| `limit`     | number  | —        | Max results                        |
| `offset`    | number  | —        | Skip N results                     |
| `include`   | object  | —        | Eager-load relations               |
| `parent`    | object  | —        | Scope by parent                    |
| `subscribe` | boolean | `true`   | Live subscription vs one-shot      |

**Decision:** Agreed. `$query` is a prop-level data source only — always returns `T[]`. No node annotation form, no flags. Use `$each` for both single-item and list display (context binding via `as`). Follows the existing token taxonomy: `$store` reads framework state, `$query` reads model data. One new token, zero new concepts.

---

## 3. Subscription Cleanup — Who Calls `dispose()`?

**Plan says:** Nothing — cleanup isn't addressed.

**Codebase reality:** `ModelQueryBuilder` requires `.dispose()` to teardown subscriptions. Without it, subscriptions leak when components unmount or when navigating between spaces.

**Solution:** Use Solid's `onCleanup()` at the resolver level. When a component using `$query` is destroyed, its ownership context triggers cleanup, which calls `builder.dispose()`.

**Implication:** The `$query` resolver _creates side effects_ (subscriptions + cleanup). This is different from all other resolvers which are pure transforms. This affects where the code can live — see point 6.

**Decision:** Agreed. `onCleanup(() => builder.dispose())` in the resolver's ownership context. Ad4m has zero auto-cleanup — `dispose()` is mandatory (stops 30s keepalive timer, unsubscribes WebSocket listener, frees backend resources). One-shot queries (`subscribe: false`) need no cleanup. This makes `$query` the second side-effectful token after `$action` — see point 6 for where that code lives.

---

## 4. Null Perspective During Load

**Plan says:** The query service injects the current perspective so schemas don't need to know about it.

**Codebase reality:** `SpaceStore.perspective` is `Accessor<PerspectiveProxy | null>` — it's `null` during the loading phase (before `getSpace()` resolves). It also changes when navigating between spaces.

**Implications:**

- Subscriptions can't start until perspective is non-null
- When perspective changes (space navigation), existing subscriptions must be disposed and new ones created
- This argues for wrapping the subscription logic in a `createEffect` that tracks perspective reactively

**Decision:** Agreed. The `$query` resolver wraps its subscription in a `createEffect` tracking `perspective()`. While null → signal holds empty `T[]`. On change → `onCleanup` fires (disposes old subscription), new subscription starts against the new perspective. Idiomatic Solid — handles both the loading gap and space navigation seamlessly.

---

## 5. Where Does the Query Service Live?

**Plan says:** ~120 lines, no package specified.

**Recommendation:**

| Piece             | Package                            | Reason                                                  |
| ----------------- | ---------------------------------- | ------------------------------------------------------- |
| Model registry    | `@we/models/src/registry.ts`       | Framework-agnostic, lives with models                   |
| Query service     | `@we/schema-system` (solid layer)  | Depends on `createSignal`, `onCleanup`, SolidJS context |
| `$query` resolver | `@we/schema-system` (shared layer) | Pure routing logic, delegates to service                |
| QueryProvider     | `@we/schema-system` (solid layer)  | SolidJS context provider                                |

**Open question:** The resolver in `shared/` would need to call the service in `solid/`. This means either:

- The resolver in shared takes the service as a parameter (injected by the Solid layer)
- The resolver lives entirely in the Solid layer, and the dispatcher has a hook for framework-specific resolvers

**Decision:** Descriptor pattern. Shared layer has a `resolveQueryProp()` that does token parsing, validation, and model registry lookup — returns a `QueryDescriptor` (pure data, no effects). Each framework's renderer detects `$query`, calls the shared resolver to get the descriptor, then implements the subscription lifecycle using its native primitives. Model registry stays in `app-framework/src/shared/registries/modelRegistry.ts` per Point 1.

| Piece | Layer | Responsibility |
| --- | --- | --- |
| `resolveQueryProp()` | shared | Parse token, validate params, lookup model class → return `QueryDescriptor` |
| `QueryDescriptor` type | shared | `{ modelClass, params, subscribe }` — pure data |
| `QueryToken` type + Zod | shared | Type-checking and schema validation |
| `$query` detection + subscription | solid (SchemaRenderer) | `createSignal` + `createEffect` + `onCleanup` + `builder.subscribe/dispose` |
| Model registry | app-framework (shared) | Model name → class map |

---

## 6. How Does `$query` Get Perspective + Cleanup?

This is the biggest design decision. The current dispatcher signature is:

```ts
resolveProp(value, stores, context, memo, depth);
```

All existing resolvers are pure transforms (no side effects, no async). `$query` breaks both rules.

**Options:**

### A) Thread through existing params

Pass perspective via `stores.spaceStore.perspective` (already there) and cleanup via a new `context.$onCleanup` function. Keep `$query` routing in the dispatcher like all other tokens.

- **Pro:** Least disruptive, dispatcher remains the single routing point
- **Con:** Pollutes context with framework-specific lifecycle hooks

### B) Special case in SchemaRenderer

Handle `$query` in `SchemaRenderer.tsx`'s per-prop memo setup, before the standard `resolveProp` call. Never goes through the dispatcher.

- **Pro:** Clean separation — side-effectful resolution stays in the framework layer
- **Con:** Breaks the "dispatcher routes all tokens" invariant, `$query` becomes invisible to shared-layer tooling

### C) Resolver returns a marker, SchemaRenderer processes it

The shared-layer resolver returns a `{ __query: params }` marker. SchemaRenderer detects it and sets up the subscription with proper lifecycle.

- **Pro:** Shared layer stays pure, Solid layer handles effects
- **Con:** Two-phase resolution adds complexity

**Recommendation:** **(A)** — perspective is already in stores, and threading `$onCleanup` through context is a one-line addition at the `RenderSchema` call site.

**Decision:** Option **(C revised)** — Descriptor pattern. The shared-layer `resolveQueryProp()` is purely functional: parses the token, validates params, looks up the model class from the registry, and returns a `QueryDescriptor` (pure data object — no effects, no framework imports). SchemaRenderer detects `$query` in a prop value, calls `resolveQueryProp()` for the descriptor, then sets up the subscription lifecycle using native Solid primitives (`createSignal`, `createEffect`, `onCleanup`). No injection of framework hooks. No `$onCleanup` in context. Perspective comes from `stores.spaceStore.perspective` which SchemaRenderer already has access to.

This generalizes cleanly to other frameworks:
- The shared resolver is written once (parsing + validation + model lookup)
- Each framework's renderer implements subscription lifecycle with its native primitives
- No hidden assumptions about hook calling conventions (React hooks can't be called dynamically — injection approach breaks for React)
- The dispatcher never sees `$query` — it stays focused on pure transforms

---

## 7. `$action: "model.*"` — Wiring

**Plan says:** Expose the query service as a pseudo-store named `query` with `.create()`, `.update()`, `.delete()` methods.

**Codebase reality:** The `$action` resolver already does `stores[storeName][methodName]`. If we add `model` to the stores object, `$action: "model.create"` works with zero `$action` resolver changes.

**Where to wire it:** `TemplateProvider.tsx` assembles the stores object — add `model: modelStore` there.

**Type update:** The `Stores` type in `packages/app-framework/src/frameworks/solid/types.ts` has `& Record<string, unknown>` so it works at runtime, but we should add `model?: ModelStore` for type safety.

**Decision:** Agreed with the following refinements:

**Rename `query` → `model`.** Mutations aren't queries. `"model.create"` is semantically accurate and aligns with Ad4m's `@Model` decorator and `$query`'s `model` param. Read side: `$query` with `model: "Task"`. Write side: `$action: "model.create"` with `"Task"` as first arg. Consistent vocabulary.

**The `model` pseudo-store** (~15 lines in TemplateProvider) wraps Ad4m's static mutation methods with automatic perspective injection:

```ts
const modelStore = {
  create: (modelName, data) => getModel(modelName).create(perspective(), data),
  update: (modelName, id, data) => getModel(modelName).update(perspective(), id, data),
  delete: (modelName, id) => getModel(modelName).delete(perspective(), id),
};
```

**Schema usage examples:**

```json
{ "$action": "model.create", "args": ["Task", { "title": "New task" }] }
{ "$action": "model.create", "args": ["Task", "$arg"] }
{ "$action": "model.update", "args": ["Task", "$arg.id", { "status": "done" }] }
{ "$action": "model.update", "args": ["Task", "$arg.id", "$arg"] }
{ "$action": "model.delete", "args": ["Task", "$arg.id"] }
```

**`processArgTokens` recursion:** Extend to walk into nested objects and arrays, resolving `$arg.*` strings at any depth. This enables mixed static+dynamic update patches:

```json
{ "$action": "model.update", "args": ["Task", "$arg.id", { "status": "$arg.newStatus", "title": "$arg.title" }] }
```

This is ~10 lines of code, benefits all `$action` usage (not just model mutations), and is the right long-term design. Include in this PR.

**Async is fine.** Mutation return values (Promises) are ignored by event handlers. Reactive subscriptions handle re-rendering when data changes — natural eventual consistency.

---

## 8. Files to Touch

Based on decisions above, the expected changeset:

| File | Change |
| --- | --- |
| `app-framework/src/shared/registries/modelRegistry.ts` | **New** — model name → Ad4mModel class map (Point 1) |
| `schema-system/shared/src/propResolvers/query.ts` | **New** — `resolveQueryProp()` → returns `QueryDescriptor` (Point 5/6) |
| `schema-system/shared/src/types.ts` | Add `QueryToken` + `QueryDescriptor` types (Point 2/5) |
| `schema-system/shared/src/zodSchemas.ts` | Add `zQueryToken` Zod schema (Point 2) |
| `schema-system/shared/src/propResolvers/action.ts` | Make `processArgTokens` recursive for nested `$arg` (Point 7) |
| `schema-system/frameworks/solid/src/SchemaRenderer.tsx` | Detect `$query` in props, set up subscription lifecycle (Point 6) |
| `app-framework/src/frameworks/solid/providers/TemplateProvider.tsx` | Wire `model` pseudo-store into stores (Point 7) |
| `app-framework/src/frameworks/solid/types.ts` | Add `ModelStore` to `Stores` type (Point 7) |

**Removed from original plan** (not needed per decisions):

| File | Why removed |
| --- | --- |
| `schema-system/frameworks/solid/src/queryService.ts` | No standalone service — subscription logic lives in SchemaRenderer (Point 6) |
| `schema-system/frameworks/solid/src/QueryProvider.tsx` | No context provider needed — no node annotation form (Point 2) |
| `schema-system/shared/src/propResolvers/dispatcher.ts` | `$query` not routed through dispatcher — handled in SchemaRenderer (Point 6) |
| `packages/models/src/registry.ts` | Model registry lives in app-framework, not models package (Point 1) |

**Decision:** Agreed. 8 files touched (4 new, 4 modified). Clean, focused changeset.

---

## 9. Key Assumption — `subscribe()` Reliability

The plan explicitly calls this out: the entire reactive data binding story depends on `Ad4mModel.subscribe()` reliably delivering real-time updates that bridge cleanly to `createSignal()`.

The test suite in `ad4m/tests/js/tests/model/model-subscriptions.test.ts` confirms the API works, but those tests run against a local executor. We should verify behavior with:

- Network latency / disconnection
- Large result sets
- Rapid successive mutations

This is a validation concern, not a blocker — but worth noting that the first implementation should include a simple smoke test.

**Decision:** Not a blocker. Architecture handles degradation gracefully — `createEffect` + `onCleanup` re-subscribes on perspective change, and `subscribe: false` fallback exists for cases where live updates aren't needed. Add a basic integration test (subscribe → mutate → verify callback fires) as part of this PR. Deeper reliability testing (latency, large result sets, rapid mutations) is a follow-up concern once the happy path is proven.
