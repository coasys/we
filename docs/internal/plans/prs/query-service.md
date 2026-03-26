# PR Plan: `$query` Reactive Query Service

## Summary

Implement `$query` as a new prop-level schema token that declaratively binds to AD4M model data. Build the reactive query service bridging Ad4mModel subscriptions to SolidJS signals. Add model registry.

## Motivation

`$query` is the keystone of the apps ecosystem — it validates the core thesis that "different apps share the same data." Two schemas reading AudioBlocks from the same perspective see the same data reactively. Without `$query`, every app needs custom store code just to read blocks, which kills composability.

## Depends on

- **Block Model Migration (#5)** — models must be in `@we/models` so the model registry can import them cleanly

## Unblocks

- Declarative data binding in schemas — no custom store code for reads
- `$forEach` with live AD4M data — reactive lists of blocks
- `$action: "query.create/update/delete"` for mutations from schemas
- Multiple schemas sharing the same data reactively
- The entire apps ecosystem thesis

## Scope

### 1. Model Registry (~25 lines)

```typescript
import type { Ad4mModel } from '@coasys/ad4m';

const modelRegistry: Record<string, typeof Ad4mModel> = {
  TextBlock,
  ImageBlock,
  CollectionBlock,
};

export function registerModel(name: string, modelClass: typeof Ad4mModel) {
  modelRegistry[name] = modelClass;
}

export function getModel(name: string): typeof Ad4mModel | undefined {
  return modelRegistry[name];
}
```

Ships with the 3 existing block types (imported from `@we/models/blocks`). Community block type packages call `registerModel()` when installed.

### 2. Reactive Query Service (~120 lines)

```typescript
import type { Query, Where, Order, ParentScope, IncludeMap } from '@coasys/ad4m';

// $query params = Ad4mModel's Query type + a model name string.
// No WE-specific Where/Order/ParentScope types — use Ad4mModel's directly.
type QueryParams = Query & { model: string };

interface QueryService {
  subscribe(params: QueryParams): Accessor<unknown[]>;
  create(model: string, data: Record<string, unknown>): Promise<string>;
  update(model: string, id: string, data: Record<string, unknown>): Promise<void>;
  delete(model: string, id: string): Promise<void>;
}
```

Two responsibilities:

1. **Perspective injection** — every Ad4mModel call needs the current perspective. The service injects it so schemas don't need to know.
2. **Signal bridging** — Ad4mModel's `.subscribe(callback)` wraps in Solid's `createSignal()` for reactive updates.

Uses Ad4mModel's types directly (`Where`, `Order`, `ParentScope`, `IncludeMap` from `@coasys/ad4m`). The only WE addition is `model: string` since JSON schemas can't reference classes.

Subscription deduplication is **already handled by AD4M's backend** — identical queries reuse one subscription. The query service doesn't need to duplicate this.

**`include` vs `parent` — when to use each:**

- **`include`** — eager-load relations on a model you're already querying: `{ model: "Playlist", include: { tracks: true } }`. Returns parent instances with children hydrated.
- **`parent`** — query children directly, scoped by parent ID: `{ model: "AudioBlock", parent: { id: "...", predicate: "playlist://track" } }`. Returns flat `AudioBlock[]`. Best for `$forEach` where you want children as the top-level array.

### 3. `$query` Token Resolver (~30 lines)

Register `$query` as a prop-level token in the schema dispatcher. When encountered, calls `queryService.subscribe(params)` and returns the reactive signal.

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

### 4. Query Mutations via `$action` (~25 lines)

Expose the query service as a pseudo-store named `query`:

```json
{ "$action": "query.create", "args": ["AudioBlock", { "title": "New Track" }] }
{ "$action": "query.update", "args": ["AudioBlock", "$arg.id", { "title": "Updated" }] }
{ "$action": "query.delete", "args": ["AudioBlock", "$arg.id"] }
```

### 5. QueryProvider (~20 lines)

SolidJS context provider that makes the query service available to the schema renderer. Instantiated once at the app root with the current perspective.

## What's NOT in scope

- `defineAppStore()` — ecosystem Phase 4, much later
- Dynamic component registration — separate concern
- `$localState` — Tier 2 token, separate PR (#4)

## Estimated new code

~220 lines total.

## Testing

- [ ] End-to-end: block composer creates TextBlock → `$query` in schema reactively shows it
- [ ] Unit: model registry CRUD
- [ ] Unit: query service signal creation and teardown
- [ ] Integration: `$action: "query.create"` creates a block, `$query` list updates reactively

## Key assumption to validate

Ad4mModel `.subscribe()` reliably delivers real-time updates that bridge cleanly to `createSignal()`. If this is flaky, the entire reactive data binding story breaks. This PR is designed to test that assumption.
