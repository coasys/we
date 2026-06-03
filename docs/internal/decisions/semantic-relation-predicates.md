# Semantic Relation Predicates (AD4M + Flux Migration)

## The Core Argument

Flux uses `ad4m://has_child` as the implicit predicate for all `@HasMany` relations. The original reasoning was sound: if every parent–child link uses the same predicate, walking the full model tree is trivial — one query, no schema knowledge required. This document argues that wildcard SPARQL queries make that reasoning obsolete, and that replacing `has_child` with semantic predicates gives you everything tree-walking needs _plus_ selective querying and graph readability that `has_child` can't provide.

---

## Why `has_child` Made Sense

The appeal of a universal child predicate is that generic traversal is cheap:

```sparql
SELECT ?child WHERE { <nodeId> <ad4m://has_child> ?child . }
```

No model schema needed. Any tool, agent, or app can map the full child set of any node with a single query pattern. In an open, interoperable graph where you might not have the schema for every model, this is genuinely useful.

---

## Why a Wildcard Query is Just as Good — and More Informative

With semantic predicates, the equivalent generic traversal reads all outgoing IRI-valued links via raw SPARQL (e.g. through `perspective.query()`):

```sparql
SELECT ?pred ?child WHERE {
  GRAPH ?g { <nodeId> ?pred ?child . }
  FILTER(isIRI(?child))
}
```

Or, scoped to declared relation predicates from model metadata (eliminates property noise):

```sparql
SELECT ?pred ?child WHERE {
  GRAPH ?g { <nodeId> ?pred ?child . }
  FILTER(?pred IN (<flux://has_conversation>, <flux://has_message>, <flux://has_task>, ...))
}
```

The predicate list can be derived from `getRelationsMetadata(Model)` — no hardcoding. These queries return the same child nodes as the `has_child` version, but also return `?pred` — so you immediately know what _type_ of child each node is without a secondary lookup. The `has_child` approach requires fetching each child's properties and matching against SHACL shapes to determine type. The wildcard approach gives you type for free, in the same query.

**The wildcard is strictly more informative than `has_child`, with no extra cost.**

> **Note:** These wildcards are raw SPARQL today. To make the model DSL a full replacement for the `has_child` tree-walking pattern, an `includeAll` operator needs to be added to the `$query` / `include` DSL — this is included in the required changes below.

---

## What Semantic Predicates Add on Top

Once relations have distinct predicates, you can do what `has_child` makes impossible: fetch only the children you actually need.

### Targeted fetch

```json
{ "$query": { "model": "Channel", "include": { "conversations": true } } }
```

With `has_child`, this query must load every child of the Channel node (messages, tasks, posts, board columns — everything) and then filter by structural conformance. With `flux://has_conversation`, it loads only conversations. The saving scales with how many unrelated child types exist.

### Unambiguous parent traversal

```json
{ "$query": { "model": "Conversation", "parent": { "model": "Channel", "field": "conversations" } } }
```

With `has_child`, `resolveParentPredicate` resolves every field to the same predicate. If a Channel has two `@HasMany` relations pointing at the same target class, the field scan is non-deterministic. With semantic predicates, each field has a unique predicate — the scan is always correct, and explicit `field` always disambiguates.

### Self-describing graph

A `has_child` graph:

```
<channelId> <ad4m://has_child> <nodeA>
<channelId> <ad4m://has_child> <nodeB>
<channelId> <ad4m://has_child> <nodeC>
```

A semantic predicate graph:

```
<channelId> <flux://has_conversation> <nodeA>
<channelId> <flux://has_message>      <nodeB>
<channelId> <flux://has_task>         <nodeC>
```

Any agent, debugger, or cross-app integration can read the second form without loading any schema. The type is encoded in the link itself.

---

## What Actually Happens in AD4M Today

`@HasMany(() => Model)` without `through` is not broken — the decorator silently defaults to `predicate: 'ad4m://has_child'`, so relations appear in SHACL shapes, `include` works, `parent` works, and `getModelManifest()` sees them. The manifest shows the correct field name and related model class, but `predicate: 'ad4m://has_child'` for all of them.

The problems are:

1. **Every `include` over-fetches.** The SPARQL query hits all `has_child` links on the parent, then structurally filters — O(total children) not O(relation size).
2. **`parent` is non-deterministic** when two fields on the same model target the same class (returns whichever appears first in metadata).
3. **Nine relation properties share `sh:path: 'ad4m://has_child'`** in the SHACL shape — anomalous and confusing for any path-keyed consumer.
4. **The graph is unreadable without a schema lookup.** Any external traversal needs to load SHACL to interpret `has_child` links.

---

## Changes Required

Note: `ad4m://has_child` remains a fully valid predicate. The goal is to make it an **explicit, intentional choice** rather than a hidden fallback. Apps that genuinely want a polymorphic container — one traversable with a single predicate regardless of child type — can continue to use it by writing `{ through: 'ad4m://has_child' }` explicitly. The difference is that it's now a deliberate decision in the code, not something that happens silently when `through` is omitted.

### `ad4m/core` — Phase 1 (deprecation warning, non-breaking)

**`decorators.ts`**: before applying the `has_child` default, emit a `console.warn`:

> `@HasMany on <ClassName>.<fieldName> has no 'through' predicate — defaulting to 'ad4m://has_child'. Add { through: 'ad4m://has_child' } to silence this warning, or use a semantic predicate like { through: 'myns://has_conversation' } for efficient targeted queries.`

Behaviour is otherwise unchanged.

### `ad4m/core` — Phase 1 continued: `includeAll` operator

**`includeAll: true`** — add to `Query` in `types.ts`. Fetches every declared forward relation on the model and returns the same named-map structure as `include`. Equivalent to listing every field name in `include` explicitly, without needing to know the field names. Useful for tree-walking and manifest-style inspections.

```typescript
// Returns: { messages: Message[], conversations: Conversation[], tasks: Task[], posts: Post[], ... }
const channel = await Channel.get(id, { includeAll: true });
```

```typescript
// As a collection query — limit applies to Channel instances, not their children:
const channels = await Channel.all({
  includeAll: true,
  limit: 10, // 10 Channels; each has all relations fully hydrated
});
// channels[0].messages, channels[0].conversations, channels[0].tasks — all populated
```

To cap children per relation, use `include` with sub-query options instead:

```typescript
const channel = await Channel.get(id, {
  include: {
    messages: { limit: 50, order: { createdAt: 'DESC' } },
    conversations: { limit: 20 },
    tasks: { limit: 20 },
  },
});
```

**Implementation:** Pure TS-side expansion inside `executeModelQuery`. Before building `queryInput`, scan `getRelationsMetadata(this)`, filter to non-reverse relations, build a full `IncludeMap`, then proceed through the existing `include` path unchanged. Zero Rust changes required.

### `ad4m/core` — Phase 2 (hard error, major version bump)

Remove the default and warn; throw instead.

### `flux/packages/api` (concurrent with Phase 1)

Add explicit `through` predicates to all `@HasMany` decorators in the API package:

| Field           | Predicate                  | Note                                                 |
| --------------- | -------------------------- | ---------------------------------------------------- |
| `messages`      | `flux://has_message`       |                                                      |
| `conversations` | `flux://has_conversation`  |                                                      |
| `childChannels` | `flux://has_child_channel` |                                                      |
| `boards`        | `flux://has_board`         |                                                      |
| `taskColumns`   | `flux://has_task_column`   |                                                      |
| `tasks`         | `flux://has_task`          |                                                      |
| `posts`         | `flux://has_post`          |                                                      |
| `views`         | `ad4m://has_child`         | Intentional — app views are an implementation detail |

**Data migration:** Existing perspectives store `has_child` links. During transition, the SPARQL builder queries both:

```sparql
FILTER(?pred IN (<flux://has_conversation>, <ad4m://has_child>))
```

Drop the shim once existing perspectives are considered stale.

### `we/packages/ai-context`

Update `schema-operators.ts` and `store-patterns.ts` once Flux predicates are explicit:

- Add examples using `include` and `parent` for Channel relations
- Document `includeAll: true` as the replacement for tree-walking

---

## Migration Path for Existing Perspectives

1. **Dual-query shim (recommended):** Query both `has_child` AND the new predicate. Zero migration cost, marginal overhead, removable later.
2. **Write-through:** On next write to any relation, also write the new semantic link. Gradual, no bulk needed.
3. **One-time script:** Walk all known perspectives at startup on version upgrade, add semantic links alongside existing `has_child` links.

Option 1 is the safest for a production app.

---

## Tradeoffs

- **Field rename = data break.** Changing a `through` predicate orphans existing stored links. Mitigated by explicit `through` — the predicate is visible in code and changing it is a deliberate act.
- **Dual query overhead during migration.** Marginal; time-bounded.
- **Flux migration effort.** Every `@HasMany` in the API package needs `through` added — small but must be done carefully to not break writes mid-transition.
