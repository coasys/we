# Schema Token Roadmap — Future Additions

Potential new tokens for the schema system, ordered by priority. Each is additive — none requires changes to existing tokens.

For current token inventory and architecture, see the [schema system shared layer](../../../packages/schema-system/shared/src/propResolvers/).

---

## Current Token Taxonomy

| Category         | Tokens                                                                        |
| ---------------- | ----------------------------------------------------------------------------- |
| **Data sources** | `$store`, `$query` (PR #5c), context refs (`$item.name`)                      |
| **Transforms**   | `$concat`, `$map`, `$pick`, `$if` (prop), `$eq`, `$ne`, `$not`, `$and`, `$or` |
| **Control flow** | `$each`, `$if` (node), `$routes`                                              |
| **Side effects** | `$action`                                                                     |

---

## Priority 1 — High value, common patterns

### `$format` — Date/number formatting

**Note:** Could be handled by we-text primitive instead?

**Category:** Transform

**Problem:** Every real UI formats dates, numbers, currencies. Without this, components must handle formatting internally, leaking presentation logic into component code. AIs generating schemas have no way to express "show this date as relative time" or "format this number as currency."

**API:**

```json
{ "$format": { "value": "$item.createdAt", "as": "relativeTime" } }
{ "$format": { "value": "$item.price", "as": "currency", "options": { "currency": "USD" } } }
{ "$format": { "value": "$item.score", "as": "percent" } }
```

**Format types (initial set):**

| `as`           | Output example   | Uses                      |
| -------------- | ---------------- | ------------------------- |
| `relativeTime` | "3 hours ago"    | `Intl.RelativeTimeFormat` |
| `date`         | "March 31, 2026" | `Intl.DateTimeFormat`     |
| `number`       | "1,234.56"       | `Intl.NumberFormat`       |
| `currency`     | "$1,234.56"      | `Intl.NumberFormat`       |
| `percent`      | "85%"            | `Intl.NumberFormat`       |
| `bytes`        | "1.2 MB"         | Custom                    |

**Implementation:** Pure transform, ~40 lines. Delegates to `Intl` APIs. `options` maps directly to `Intl` options objects.

---

### `$count` — Array length

**Category:** Transform

**Problem:** No way to get array length in a schema expression. Common for badges ("3 tasks"), empty state checks, and summaries.

**API:**

```json
{ "$count": "$tasks" }
{ "$count": { "$query": { "model": "Task", "where": { "status": "active" } } } }
{ "$count": { "$store": "spaceStore.members" } }
```

**Implementation:** Trivial — resolve input, return `.length`. ~10 lines. Pure transform.

**Note:** For large datasets, `Ad4mModel.count()` is more efficient than `$query` + `$count` (doesn't fetch all records). Could add a `count: true` param to `$query` later to return a number instead of an array.

---

### `$switch` — Multi-branch conditional

**Category:** Transform

**Problem:** Multiple-branch conditionals require deeply nested `$if` chains. Status badges, role-based rendering, and state machines are extremely common in real UIs. Nested `$if` is error-prone for AIs.

**API:**

```json
{
  "$switch": {
    "value": "$item.status",
    "cases": {
      "active": "green",
      "pending": "yellow",
      "archived": "gray"
    },
    "default": "blue"
  }
}
```

**Equivalent `$if` chain (what AIs have to write today):**

```json
{
  "$if": {
    "condition": { "$eq": ["$item.status", "active"] },
    "then": "green",
    "else": {
      "$if": {
        "condition": { "$eq": ["$item.status", "pending"] },
        "then": "yellow",
        "else": {
          "$if": {
            "condition": { "$eq": ["$item.status", "archived"] },
            "then": "gray",
            "else": "blue"
          }
        }
      }
    }
  }
}
```

**Implementation:** Pure transform, ~25 lines. Resolve `value`, lookup in `cases`, fall back to `default`.

---

## Priority 2 — Moderate value, less common patterns

### `$bind` — Scoped context bindings

**Category:** Control flow (node-level)

**Problem:** No way to bind a value into context without iterating. When the same expression or query is used in multiple sibling nodes, each must duplicate it — creating redundant subscriptions and verbose schemas.

**API:**

```json
{
  "type": "$bind",
  "props": {
    "tasks": { "$query": { "model": "Task" } },
    "isOwner": { "$eq": [{ "$store": "adamStore.did" }, "$item.authorDid"] }
  },
  "children": [
    { "type": "Badge", "props": { "count": { "$count": "$tasks" } } },
    { "type": "$if", "props": { "condition": "$isOwner", "then": { "type": "EditButton" } } },
    { "type": "$each", "props": { "items": "$tasks" }, "children": [...] }
  ]
}
```

**Relationship to `$each`:** Same context injection mechanism, but renders children once with no iteration. Think of it as `let` bindings for schemas.

**Implementation:** Node-level handler in SchemaRenderer (~15 lines). Resolve each prop value, merge into context, render children with extended context.

**When to add:** When production schemas show duplicated expressions or duplicate `$query` calls for the same data.

---

### `$slice` — Array subset

**Category:** Transform

**Problem:** "Show top 3 recent items" or "last 5 messages" requires component-level logic. Pagination previews, recent activity feeds, and truncated lists are common patterns.

**API:**

```json
{ "$slice": { "items": { "$query": { "model": "Message" } }, "start": 0, "end": 3 } }
{ "$slice": { "items": "$tasks", "start": -5 } }
```

**Implementation:** Pure transform, ~15 lines. Resolve items, return `.slice(start, end)`.

**Note:** Overlaps with `$query`'s `limit` param for simple cases. `$slice` is useful when slicing already-fetched data or context values, not just query results.

---

### `$merge` — Object composition

**Category:** Transform

**Problem:** Combining objects for prop spreading, style composition, or assembling config from multiple sources.

**API:**

```json
{ "$merge": [{ "$store": "themeStore.base" }, { "color": "$item.color" }, { "fontSize": 14 }] }
```

**Implementation:** Pure transform, ~10 lines. Resolve each object, spread left-to-right.

**When to add:** When component composition requires dynamic style/config merging beyond what `$concat` handles (strings only).

---

## Priority 3 — Edge cases, add only when needed

### `$resource` — Generic async fetch

**Category:** Data source

**Problem:** External API calls (REST, GraphQL) outside the Ad4m model layer.

**API:**

```json
{ "$resource": { "url": "/api/weather", "method": "GET", "cache": 60 } }
```

**When to add:** Probably never for this architecture. `$query` covers model data. `$store` covers state. External API calls should go through stores/actions, not schema-level fetching. Only add if a genuine need for schema-driven API calls emerges.

---

## Design Principles for New Tokens

1. **One job each** — tokens are composable primitives, not multi-mode Swiss knives
2. **Pure transforms by default** — side effects only in `$action` (and `$query` for subscriptions)
3. **Prop-level unless controlling render flow** — only `$each`, `$if`, `$routes`, and `$bind` are node-level
4. **Nest freely** — every prop-level token should accept other tokens as inputs
5. **AI-optimized** — minimal decision surface, predictable output shapes, no flags that change behavior
