# PR Plan: Nested Object WHERE Conditions on Relation Fields

## Background

`ModelQuery.where()` currently supports two kinds of conditions:

1. **Scalar `@Property` fields** — any `WhereCondition` variant
   (`String`, `Number`, `Bool`, `StringArray`, `NumberArray`, `Ops`)
2. **Relation fields** (`@HasMany`, `@HasOne`, etc.) — only `String` or
   `StringArray` (bare target IRIs)

Filtering a relation field by a _property of the related model_ requires a
second query today:

```typescript
// Desired — filter signals whose type has slug 'like'
Signal.findAll(p, { where: { signalType: { slug: 'like' } } }); // ← not supported

// Workaround — two steps
const likeType = await SignalType.findOne(p, { where: { slug: 'like' } });
Signal.findAll(p, { where: { signalType: likeType.id } });
```

The same limitation applies to `HasMany` existence filters:

```typescript
// "posts that have at least one signal with value > 0"
Post.findAll(p, { where: { signals: { value: { $gt: 0 } } } }); // ← not supported
```

---

## Proposed Changes

### 1. New `WhereCondition` variant — `Object` (TypeScript, `core/src/model/types.ts`)

Add an `Object` variant that holds a nested `Where` map keyed by the target
model's field names:

```typescript
// Existing
type WhereCondition = string | number | boolean | string[] | number[] | WhereOps;

// New
type WhereCondition = string | number | boolean | string[] | number[] | WhereOps | Record<string, WhereCondition>; // ← nested object condition
```

At the TypeScript layer, `compileWhereClause()` already serialises
`WhereCondition` values for transmission to Rust. Nested objects are
serialised as-is; the Rust side unpacks them with `WhereCondition::Object`.

### 2. New `WhereCondition::Object` variant (Rust, `types.rs`)

```rust
#[derive(Debug, Clone)]
pub(super) enum WhereCondition {
    String(String),
    StringArray(Vec<String>),
    Number(f64),
    Bool(bool),
    NumberArray(Vec<f64>),
    Ops(WhereOps),
    Object(BTreeMap<String, WhereCondition>),  // NEW
}
```

Deserialisation: when a where-clause value is a JSON object _without_ the
operator keys (`$gt`, `$lt`, `$not`, etc.), parse it as `Object` rather than
`Ops`. The two are unambiguous because operator keys always start with `$`.

### 3. New SPARQL patterns for `Object` conditions (`sparql_builder.rs`)

In `build_query_patterns()`, after the existing `is_collection` relation branch
and the scalar property branch, add handling for `Object` conditions on any
relation field (both `is_collection: true` and scalar):

#### HasOne / BelongsToOne — inline JOIN patterns

```sparql
-- where: { signalType: { slug: 'like' } }

?source <we://signal_type> ?_jn_signalType .
?_jn_signalType <we://slug> ?_jn_signalType_slug_raw .
FILTER(STR(<ad4m://fn/parse_literal>(?_jn_signalType_slug_raw)) = "like")
```

The target model's property predicates come from `where_predicates` metadata
already stored on the `ShapeProperty` (populated from the relation's
`targetShape` during shape parsing — see `shape.rs` line 307–320).

#### HasMany — `FILTER EXISTS` sub-pattern

```sparql
-- where: { signals: { value: { $gt: 0 } } }

FILTER EXISTS {
  ?source <we://signal> ?_ex_signals .
  ?_ex_signals <we://value> ?_ex_signals_value_raw .
  BIND(<http://www.w3.org/2001/XMLSchema#double>(
    STR(<ad4m://fn/parse_literal>(?_ex_signals_value_raw))
  ) AS ?_ex_signals_value_num)
  FILTER(?_ex_signals_value_num > 0)
}
```

The field name → predicate map for the target model is looked up from
`where_predicates` on the relation's `ShapeProperty`, which must be populated
for relations with `targetShape` metadata.

### 4. Ensure `where_predicates` are populated for all relation fields (`shape.rs`)

Currently `where_predicates` is only populated when the relation's JSON
metadata includes a `wherePredicates` key (i.e. when the TypeScript layer
explicitly serialised them for a filter relation). This PR extends the
TypeScript shape serialisation to always include the target model's full
property predicate map when a `targetShape` is present, so that
`build_query_patterns()` has the data it needs for Object conditions.

### 5. `all_where_pushable()` — mark Object conditions as pushable (`sparql_builder.rs`)

The existing function returns `false` for unrecognised condition types, causing
a fallback to post-hydration Rust filtering. Object conditions on known relation
fields can be pushed to SPARQL, so add the corresponding case:

```rust
if shape.properties.iter().any(|p| p.name == *prop_name && p.is_collection) {
    if matches!(condition, WhereCondition::String(_) | WhereCondition::StringArray(_)
        | WhereCondition::Object(_)) {
        continue;
    }
    return false;
}
```

---

## Affected Files

| File                                                           | Change                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `core/src/model/types.ts`                                      | Add `Record<string, WhereCondition>` to `WhereCondition` union                                         |
| `core/src/model/query-utils.ts`                                | Serialise nested objects in `compileWhereClause()`                                                     |
| `rust-executor/src/perspectives/model_query/types.rs`          | Add `Object(BTreeMap<String, WhereCondition>)` to `WhereCondition` enum; update deserialisation        |
| `rust-executor/src/perspectives/model_query/sparql_builder.rs` | Generate inline JOIN / `FILTER EXISTS` patterns for `Object` conditions; update `all_where_pushable()` |
| `rust-executor/src/perspectives/model_query/shape.rs`          | Always populate `where_predicates` from `targetShape` when present                                     |

---

## Non-Goals

- Deeply nested conditions (conditions on relations of related models, i.e. more
  than one hop) — out of scope for this PR.
- Object conditions in aggregate `where` clauses (QUERY-AGGREGATE-ORDER) — that
  PR can adopt this once landed.
- Post-hydration fallback for Object conditions — all Object conditions must be
  pushable to SPARQL or they are rejected with a descriptive error.

---

## Testing

- Unit test: `Signal.findAll(p, { where: { signalType: { slug: 'like' } } })`
  generates the expected inline-JOIN SPARQL and returns only signals whose
  type has `slug = 'like'`.
- Unit test: `Post.findAll(p, { where: { signals: { value: { $gt: 0 } } } })`
  generates a `FILTER EXISTS` block and returns only posts with qualifying signals.
- Unit test: plain IRI string condition on relation field still works (regression).
- Unit test: `Ops` conditions (`$gt`, `$lt` etc.) on scalar properties still work
  (regression — ensure new Object detection doesn't misclassify `Ops`).
- Integration test: multi-condition object filter combining a nested relation
  condition with a direct property condition on the parent model.
