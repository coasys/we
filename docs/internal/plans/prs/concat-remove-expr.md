# Plan: Add `$concat`, Remove `$expr`

> Replace `$expr` (arbitrary JS via `new Function()`) with `$concat` (safe string building). Remove `$expr` entirely — no deprecation, just delete. All call sites are internal.

---

## Context

`$expr` evaluates arbitrary JavaScript expressions at runtime using `new Function()`. Problems:

- **Security** — `new Function()` is code execution. Blocked by CSP `unsafe-eval`.
- **Unvalidatable** — can't statically check an arbitrary JS string. Punches a hole through schema validation.
- **AI-unfriendly** — AI generates broken JS expressions more often than structured tokens.
- **Framework-coupled** — assumes JavaScript runtime. Blocks server-side rendering, WASM, etc.

Investigation of all `$expr` uses in the codebase found **11 instances across 4 files**, falling into 3 patterns:

| Pattern                                       | Count | Files                                  | Replacement                              |
| --------------------------------------------- | ----- | -------------------------------------- | ---------------------------------------- |
| Simple property access on `$forEach` variable | 7     | DefaultTemplate, TwitterTemplate, test | Use `$forEach` context variable directly |
| String interpolation / concatenation          | 2     | DefaultTemplate, weNativeApp           | New `$concat` token                      |
| JS `\|\|` fallback                            | 2     | weNativeApp                            | `$if` with condition                     |

No external consumers exist — all uses are in the WE monorepo's own templates and tests.

---

## Implementation

### 1. Add `$concat` token

Concatenates an array of values into a string. Each element is resolved (can be a `$store`, `$if`, literal, etc.).

**Type:**

```typescript
export type ConcatToken = { $concat: SchemaProp[] };
```

**Resolver** (`packages/schema-system/shared/src/propResolvers/concat.ts`):

```typescript
export function resolveConcatProp(
  parts: SchemaProp[],
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  return markReactive(
    memo(() => {
      return parts
        .map((part) => {
          const resolved = resolvePropFn(part, stores, context, memo);
          const val = typeof resolved === 'function' ? resolved() : resolved;
          return val == null ? '' : String(val);
        })
        .join('');
    }),
  );
}
```

**Usage:**

```json
{ "$concat": ["/space/", { "$store": "routeStore.currentId" }] }
```

**Add to dispatcher** (`dispatcher.ts`):

```typescript
if (hasToken(value, '$concat', 'array'))
  return resolveConcatProp(value['$concat'] as SchemaProp[], stores, context, memo, resolveProp);
```

### 2. Remove `$expr` entirely

| File                          | Action                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| `propResolvers/expression.ts` | Delete file                                                            |
| `propResolvers/dispatcher.ts` | Remove `$expr` branch                                                  |
| `types.ts`                    | Remove `ExprToken` from `OperatorToken` union                          |
| `zodSchemas.ts`               | Remove `$expr` from token schemas (when added by schema-validation PR) |
| `index.ts`                    | Remove export                                                          |
| `OPERATORS.md`                | Remove `$expr` section, add `$concat` section                          |

### 3. Migrate all `$expr` uses

#### `DefaultTemplate.schema.ts`

```diff
- { "$expr": "space.name" }
+ "space.name"   // $forEach context variable accessed via $map select
```

```diff
- { "$expr": "`/space/${space.uuid}`" }
+ { "$concat": ["/space/", "space.uuid"] }  // with proper $forEach context reference
```

Note: The exact migration depends on how `$forEach` passes context to child nodes. The 7 simple property access cases may just need the `$map` `select` syntax or direct context string reference — review each during implementation.

#### `TwitterTemplate.schema.ts`

All 6 uses are `{ "$expr": "button.path" }`, `{ "$expr": "button.icon" }`, `{ "$expr": "button.label" }`, `{ "$expr": "button.bold" }` — simple property access on a `$forEach` item named `button`. Replace with direct context references.

#### `weNativeApp.ts`

```diff
- { "$expr": "item.url || item.uuid" }
+ { "$if": { "condition": "item.url", "then": "item.url", "else": "item.uuid" } }
```

```diff
- { "$expr": "'/space/' + (item.url || item.uuid)" }
+ { "$concat": ["/space/", { "$if": { "condition": "item.url", "then": "item.url", "else": "item.uuid" } }] }
```

#### `SchemaRenderer.test.tsx`

```diff
- { "$expr": "item" }
+ // Direct context reference — depends on $forEach `as` binding
```

### 4. Update docs and AI context

- Remove `$expr` from OPERATORS.md
- Add `$concat` to OPERATORS.md with examples
- Update `schemaExamples.ts` (AI prompt examples)
- Update `schemaContext.ts` if still in use (or `@we/ai-context` fragments)

### 5. Tests

- Add `$concat` resolver tests (strings, numbers, nested tokens, empty/null values)
- Verify all migrated templates render correctly
- Verify existing tests pass after `$expr` removal

---

## Files changed

| File                                                                  | Change                                |
| --------------------------------------------------------------------- | ------------------------------------- |
| `packages/schema-system/shared/src/propResolvers/concat.ts`           | New — `$concat` resolver              |
| `packages/schema-system/shared/src/propResolvers/expression.ts`       | Delete                                |
| `packages/schema-system/shared/src/propResolvers/dispatcher.ts`       | Remove `$expr`, add `$concat`         |
| `packages/schema-system/shared/src/types.ts`                          | Remove `ExprToken`, add `ConcatToken` |
| `packages/schema-system/shared/src/index.ts`                          | Update exports                        |
| `packages/schema-system/OPERATORS.md`                                 | Remove `$expr`, add `$concat`         |
| `packages/app-framework/src/shared/schemas/DefaultTemplate.schema.ts` | Migrate 2 uses                        |
| `packages/app-framework/src/shared/schemas/TwitterTemplate.schema.ts` | Migrate 6 uses                        |
| `packages/app-framework/src/shared/schemas/weNativeApp.ts`            | Migrate 2 uses                        |
| `packages/app-framework/src/shared/prompts/schemaExamples.ts`         | Update examples                       |
| `packages/schema-system/solid/tests/SchemaRenderer.test.tsx`          | Migrate 1 use                         |

---

## Sizing

Small PR. ~30 lines new code (`$concat` resolver + dispatcher line + type), ~40 lines deleted (`$expr` resolver + dispatcher line + type), ~20 lines of template migrations, ~50 lines of tests.

---

## Relationship to other plans

| Plan                                        | Relationship                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [schema-validation](schema-validation.md)   | `$concat` gets a Zod schema. `$expr` removal means one fewer unvalidatable hole.                                            |
| [ai-context-package](ai-context-package.md) | Token documentation updated: `$concat` added, `$expr` removed from fragments.                                               |
| Ecosystem token tiers                       | `$concat` joins Tier 1 (stable core). Count becomes 13 (after `$expr` removal); rises to 14 when `$query` lands in Phase B. |
