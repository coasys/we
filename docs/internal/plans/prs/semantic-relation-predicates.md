# Semantic Relation Predicates (AD4M + Flux Migration)

## Overview

Replace the implicit `ad4m://has_child` fallback for untyped `@HasMany` relations with a requirement for explicit `through` predicates. This makes every declared relation manifest-visible, queryable via `include` and `parent`, and semantically self-describing. The `has_child` predicate becomes an explicit opt-in for genuinely polymorphic containers rather than an accidental default.

---

## Problem

`@HasMany(() => Model)` without a `through` option currently:

1. **Stores nothing useful in metadata** — `predicate` is `undefined` in the relation metadata
2. **Is silently skipped by SHACL gen** — `shacl-gen.ts` has `if (!relMeta.predicate) continue`, so the relation never appears in the SHACL shape
3. **Is invisible to `getModelManifest()`** — which builds from SHACL, so no `relatedModel` is set
4. **Breaks `resolveParentPredicate()`** — returns `undefined` or throws when the AI tries to use `parent` queries
5. **Breaks `include`** — since all these relations share `has_child`, hydrating any one of them pulls back all child types indiscriminately

The net effect: channels in Flux have 9 `@HasMany` relations that are entirely invisible to the manifest, meaning the AI cannot reference any of them in `$query`, `include`, or `parent`.

### Why `has_child` was used

Using `has_child` as the implicit predicate for all child relations allows "get all children at once" without knowing predicate names. Any app can traverse children by querying `(source=<id>, predicate=has_child)`. It felt like interoperability.

### Why it's the wrong approach

- **Type discrimination requires a second lookup.** After retrieving `has_child` children you must fetch each child's `entry_type` flag to know what it is. With semantic predicates the type is already in the link predicate — no second roundtrip.
- **Generic traversal works without it.** A wildcard SPARQL query (`SELECT ?pred ?child WHERE { GRAPH ?g { <id> ?pred ?child . } }`) retrieves all children with their types, filtered to non-literal targets. This is more informative than `has_child` and equally universal.
- **`include` is entirely broken.** Since all relations share the same predicate, `include: { conversations: true }` would return messages, posts, tasks — every child regardless of type.
- **`parent` queries fail.** `resolveParentPredicate` returns `undefined` for these relations.
- **Selective queries require manual SPARQL.** Flux's `allItems()`, `unprocessedItems()`, `totalItemCount()` all exist specifically to work around the model system's inability to query these relations properly. With semantic predicates these methods collapse into standard `include` or `$query` calls.

---

## Proposed Design

### Core principle

`@HasMany` without an explicit `through` is an **error**, not a default. The developer must state what the link means. `has_child` becomes a deliberate choice:

```typescript
// WRONG — will warn/error
@HasMany(() => Conversation)
conversations: Conversation[] = [];

// RIGHT — polymorphic container (intentional shared predicate)
@HasMany(() => Conversation, { through: 'ad4m://has_child' })
conversations: Conversation[] = [];

// BETTER — semantic predicate, fully queryable
@HasMany(() => Conversation, { through: 'flux://has_conversation' })
conversations: Conversation[] = [];
```

### "Get all children of any type" without `has_child`

With semantic predicates, generic traversal is done via wildcard SPARQL, scoped to declared relation predicates from the model registry:

```sparql
SELECT ?pred ?child WHERE {
  GRAPH ?g { <channelId> ?pred ?child . }
  FILTER(?pred IN (<flux://has_conversation>, <flux://has_message>, <flux://has_post>, ...))
}
```

The predicate list comes from `getRelationsMetadata(Channel)` — no hardcoding. Results are already type-discriminated by `?pred`. This replaces `allItems()` entirely.

### Selective multi-relation queries

Fetch any subset of relations using `include`:

```json
{ "$query": { "model": "Channel", "include": { "messages": true, "posts": true, "tasks": true } } }
```

AD4M batches these into parallel SPARQL lookups. Results have `.messages`, `.posts`, `.tasks` hydrated as separate arrays. No additional machinery needed.

### Chronologically merged multi-type streams

For the `allItems()` / "feed" pattern (flat list ordered by timestamp across types), a new `includeUnion` operator would be the clean long-term solution:

```json
{ "$query": { "model": "Channel", "includeUnion": ["messages", "posts", "tasks"] } }
```

Returns a flat array of mixed instances ordered by timestamp, implemented as a SPARQL UNION. This is a future `ad4m` feature — not blocking the predicate migration.

---

## Changes Required

### `ad4m/core` (Phase 1 — non-breaking, adds deprecation warning)

**`decorators.ts`**

- When `@HasMany` is called without `through`, emit a `console.warn` deprecation: `"@HasMany on <ClassName>.<fieldName> has no 'through' predicate. This will become a hard error in a future version. Use { through: 'ad4m://has_child' } if you need generic containment, or a semantic predicate like { through: 'myns://has_conversation' }."`
- Store `predicate: 'ad4m://has_child'` as the runtime default (preserving existing behaviour while warning)

**`shacl-gen.ts`**

- Change `if (!relMeta.predicate) continue` to pass through relations with `predicate === 'ad4m://has_child'` but tag their SHACL property with `sh:description "shared-predicate"` or an equivalent annotation, so `getModelManifest()` can set a `sharedPredicate: true` flag on those entries

**`PerspectiveProxy.getModelManifest()`**

- For relations with `sharedPredicate: true`, include them in the manifest output with `relatedModel` set and `implicit: true` flag
- This makes them visible to the AI as "exists but has_child — parent only, no include"

### `ad4m/core` (Phase 2 — hard error)

- Remove the `console.warn` fallback, throw instead
- Provides a clean breaking-change signal for a major version bump

### `flux/packages/api` (concurrent with Phase 1)

Add explicit `through` predicates to all `@HasMany` decorators that currently omit them. Two options per relation:

- **`through: 'ad4m://has_child'`** — if Flux intentionally wants the generic container behaviour and doesn't need manifest visibility (e.g. `views: App[]` which is an implementation detail)
- **`through: 'flux://has_<type>'`** — for relations the AI and WE schemas should be able to query natively

Suggested semantic predicates for Flux's Channel (using existing `community` constants where available, or defining new ones):

| Field           | Predicate                                                              |
| --------------- | ---------------------------------------------------------------------- |
| `messages`      | `flux://has_message`                                                   |
| `conversations` | `flux://has_conversation`                                              |
| `childChannels` | `flux://has_child_channel`                                             |
| `boards`        | `flux://has_board`                                                     |
| `taskColumns`   | `flux://has_task_column`                                               |
| `tasks`         | `flux://has_task`                                                      |
| `posts`         | `flux://has_post`                                                      |
| `views`         | `ad4m://has_child` (intentional — app views are implementation detail) |

**Data migration:** Existing perspectives store `has_child` links. During the transition, a dual-query shim in the SPARQL builder can match either the old `has_child` OR the new semantic predicate:

```sparql
FILTER(?pred IN (<flux://has_conversation>, <ad4m://has_child>))
```

This shim can be removed once existing perspectives are considered stale.

### `we/packages/app-framework` (`AiStore.tsx`)

**`formatExternalManifestForPrompt`**

- Relations with `implicit: true` (shared `has_child`) labelled: `- conversations → Conversation (parent query only — shared has_child predicate, no include)`
- Relations with full semantic predicates labelled: `- conversations → Conversation (include or parent)`

### `we/packages/ai-context`

Update `schema-operators.ts` and `store-patterns.ts` once Flux predicates are explicit:

- Remove the caveat that Flux relations are unavailable for `parent` queries
- Add Flux-specific examples using `parent` and `include` for Channel relations

---

## Migration Path for Existing Perspectives

Flux perspectives in production contain `has_child` links. Three options:

1. **Dual-query shim (recommended):** Query both `has_child` AND the new semantic predicate using SPARQL UNION/FILTER. Zero migration cost, slight query overhead, can be dropped later.
2. **Write-through migration:** On next write to a relation, also write the new semantic link. Gradual, no bulk migration needed, but dual links exist until all records are touched.
3. **One-time migration script:** Walk all links in known perspectives and add semantic predicate links alongside existing `has_child` links. Can be done at startup on version upgrade.

Option 1 is the safest for a production app.

---

## Interaction with AD4M's Structural Matching (No-Flag Design)

AD4M model identification is deliberately flag-free: a node is an instance of a model if it structurally conforms to its SHACL shape — correct properties with correct predicates. There is no required `entry_type` flag. This enables overlapping models (multiple classes can match the same node) and cross-app interoperability where one app's data can be interpreted by another app's model definition.

Semantic predicates are **complementary** to structural matching, not in conflict with it:

- **Predicate = routing hint.** `flux://has_conversation` tells the query engine which candidate nodes to load before structural matching runs. It narrows the candidate set from "all children" to only those reached via that specific relation — strictly cheaper than loading everything and checking everything against all shapes.
- **Structural matching = authority.** Whether a candidate node actually satisfies the `Conversation` shape is still determined structurally. The predicate is a performance optimisation and a semantic label, not a replacement for shape conformance.
- **Overlapping models still work.** If two model classes both structurally match the same node, the predicate used to reach it provides context — "this node arrived via `flux://has_conversation`, so it's being used as a Conversation here." With `has_child` you'd have the same ambiguity but with no routing hint at all.
- **`@Flag` entries (like Flux's `entry_type`) become optional for discrimination.** The predicate alone is sufficient for the query system to find the right nodes. `@Flag` remains useful as a data integrity constraint or for human-readable graph inspection, but is no longer load-bearing for query correctness.

In short: structural matching handles _what a node is_; semantic predicates handle _how you got to it_. The two mechanisms operate at different layers and reinforce each other.

---

## Negative Tradeoffs

- **Field rename danger:** If a field is renamed and `through` is derived from the field name, old data breaks. Mitigated by requiring explicit `through` — the predicate is in the code and changing it is a visible, intentional act.
- **Flux migration effort:** Every `@HasMany` in the Flux API package needs a `through` added. Small effort but must be done carefully to not break existing writes during the transition.
- **Short-term dual query overhead:** The migration shim queries both predicates until old data is considered stale. Marginal performance cost.

---

## What This Unlocks

Once complete:

- AI can see all Flux model relations in `externalModels` and use `parent` queries for all of them
- `include` works correctly for relations with semantic predicates
- `allItems()`, `unprocessedItems()`, `totalItemCount()` become expressible as standard `$query` operations
- WE schema templates can navigate Flux's Channel → Conversation → Message hierarchy without custom SPARQL
- The model manifest is a complete and accurate picture of the data model
