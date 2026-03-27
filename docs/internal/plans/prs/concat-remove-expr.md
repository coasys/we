# Plan: Add `$concat`, Extend `$item`, Rename `$forEach` → `$each`, Remove `$expr`

> Replace `$expr` (arbitrary JS via `new Function()`) with two safe mechanisms: `$concat` for string building, and `$item.*` context references in the dispatcher. Rename `$forEach` to `$each` for consistency with the single-word naming convention used by all other tokens. Remove `$expr` entirely — no deprecation, just delete. All call sites are internal.

---

## Context

`$expr` evaluates arbitrary JavaScript expressions at runtime using `new Function()`. Problems:

- **Security** — `new Function()` is code execution. Blocked by CSP `unsafe-eval`.
- **Unvalidatable** — can't statically check an arbitrary JS string. Punches a hole through schema validation.
- **AI-unfriendly** — AI generates broken JS expressions more often than structured tokens.
- **Framework-coupled** — assumes JavaScript runtime. Blocks server-side rendering, WASM, etc.

Investigation of all `$expr` uses in the codebase found **11 instances across 4 files** (plus 5 test cases in `propResolvers.test.ts`), falling into 3 patterns:

| Pattern                                       | Count | Files                                  | Replacement                               |
| --------------------------------------------- | ----- | -------------------------------------- | ----------------------------------------- |
| Simple property access on `$forEach` variable | 7     | DefaultTemplate, TwitterTemplate, test | `$item.*` context reference in dispatcher |
| String interpolation / concatenation          | 2     | DefaultTemplate, weNativeApp           | `$concat` wrapping `$item.*` references   |
| JS `\|\|` fallback                            | 2     | weNativeApp                            | `$if` with condition using `$item.*`      |

No external consumers exist — all uses are in the WE monorepo's own templates and tests.

### Design investigation: `$map` vs `$forEach` context access

Before designing the replacement, we investigated how the two iteration systems handle item access:

- **`$map`** (prop-level, data transformation) uses `$item.*` magic strings in `select` entries. The string `"$item.name"` is resolved by `resolveSelectValue()` in `map.ts` via a fast-path dot-walk on the current item. This is framework-agnostic and lives in `shared/`.

- **`$forEach`** (renderer-level, DOM rendering) injects the current item into `context` under the key specified by `as` (default: `'item'`). Child nodes can only access the item via `$expr` — there is no other mechanism. This is Solid-specific and lives in `SchemaRenderer.tsx`.

The asymmetry means `$expr` is the **only way** to read `$forEach` context variables. Removing `$expr` without a replacement would break all `$forEach` templates.

Additionally, `$forEach` is the only camelCase token name — every other token (`$store`, `$action`, `$map`, `$if`, `$eq`, `$not`, `$and`, `$or`, `$routes`, `$concat`) is a single lowercase word. Renaming to `$each` aligns the naming convention, reduces AI error surface, and is natural language (`for each item` → `each item`).

### Key decisions

1. **Extend `$item.*` to the dispatcher** — don't add a new token type. The `$item.*` string pattern already exists in `$map`; extending it to context resolution in the dispatcher makes it work uniformly in both `$map` and `$forEach`.

2. **Generalise to `$<contextKey>.*`** — any string matching `$<word>.<path>` is looked up against context. This allows `$forEach`'s `as` prop to define custom context keys for nested loops (e.g. `as: 'team'` → `$team.name`).

3. **Keep `as` prop on `$forEach`** (default: `'item'`) — needed for nested `$forEach` where inner loops shadow the outer `$item`. The common case uses the default (`$item.*`); `as` is the escape hatch for disambiguation.

4. **Don't add `as` to `$map`** — `$map` doesn't nest the same way; `$item` is always unambiguous there.

5. **No `$parent` token** — `as` covers the nested case with arbitrary depth and named keys, which is strictly superior to positional `$parent.$parent` chains.

6. **Rename `$forEach` → `$each`** — aligns with single-word naming convention of all other tokens. Since this PR already migrates every `$forEach` instance (templates, tests, docs, AI prompts), the rename has zero extra migration cost.

---

## Implementation

### 1. Extend dispatcher with `$<contextKey>.*` resolution

Add context variable resolution to `resolveProp` in `dispatcher.ts`. Any plain string matching `$<word>.<path>` (where `<word>` is a key in `context`) is resolved via dot-path traversal on the context value.

**In dispatcher** (`dispatcher.ts`), before the final `return value`:

```typescript
// Resolve $<contextKey>.<path> strings against context (e.g. $item.name, $team.id)
if (typeof value === 'string' && value.startsWith('$')) {
  const dotIndex = value.indexOf('.');
  if (dotIndex > 1) {
    const contextKey = value.slice(1, dotIndex);
    if (contextKey in context) {
      const path = value.slice(dotIndex + 1).split('.');
      let current: unknown = context[contextKey];
      for (const p of path) current = (current as Record<string, unknown>)?.[p];
      return current;
    }
  }
}
```

This gives us:

- `"$item.name"` → `context.item.name` (default `$forEach` access)
- `"$team.id"` → `context.team.id` (custom `as` in nested `$forEach`)
- `"$item.profile.email"` → `context.item.profile.email` (nested paths)

Strings that don't match a context key pass through unchanged (existing behaviour).

### 2. Add `$concat` token

Concatenates an array of values into a string. Each element is resolved (can be a `$store`, `$if`, `$item.*`, literal, etc.).

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
{ "$concat": ["/space/", "$item.uuid"] }
```

**Add to dispatcher** (`dispatcher.ts`):

```typescript
if (hasToken(value, '$concat', 'array'))
  return resolveConcatProp(value['$concat'] as SchemaProp[], stores, context, memo, resolveProp);
```

### 3. Remove `$expr` entirely

| File                          | Action                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| `propResolvers/expression.ts` | Delete file                                                            |
| `propResolvers/dispatcher.ts` | Remove `$expr` branch and import                                       |
| `types.ts`                    | Remove `ExprToken` from `OperatorToken` union                          |
| `zodSchemas.ts`               | Remove `$expr` from token schemas (when added by schema-validation PR) |
| `index.ts`                    | Remove export                                                          |
| `OPERATORS.md`                | Remove `$expr` section, add `$concat` and `$item` sections             |
| `README.md`                   | Remove `$expr` from operator table                                     |

### 4. Rename `$forEach` → `$each`

Pure rename in renderer and all consumers:

| File                 | Action                                                       |
| -------------------- | ------------------------------------------------------------ |
| `SchemaRenderer.tsx` | Change `node.type === '$forEach'` to `node.type === '$each'` |
| All templates        | `type: '$forEach'` → `type: '$each'`                         |
| All tests            | `type: '$forEach'` → `type: '$each'`                         |
| `OPERATORS.md`       | Rename section header and references                         |
| `README.md`          | Rename in operator table                                     |
| `schemaContext.ts`   | Rename in AI prompt text                                     |
| `schemaExamples.ts`  | Rename in examples                                           |

### 5. Migrate all `$expr` uses

#### `DefaultTemplate.schema.ts` (2 uses)

`$each` with `as: 'space'` → children access via `$space.*`:

```diff
- label: { $expr: 'space.name' },
+ label: '$space.name',
```

```diff
- onClick: { $action: 'routeStore.navigate', args: [{ $expr: '`/space/${space.uuid}`' }] },
+ onClick: { $action: 'routeStore.navigate', args: [{ $concat: ['/space/', '$space.uuid'] }] },
```

#### `TwitterTemplate.schema.ts` (6 uses)

`$each` with `as: 'button'` → children access via `$button.*`:

```diff
- onClick: { $action: 'routeStore.navigate', args: [{ $expr: 'button.path' }] },
+ onClick: { $action: 'routeStore.navigate', args: ['$button.path'] },
```

```diff
- name: { $expr: 'button.icon' },
+ name: '$button.icon',
```

```diff
- text: { $expr: 'button.label' },
+ text: '$button.label',
```

```diff
- condition: { $eq: [{ $store: 'routeStore.currentPath' }, { $expr: 'button.path' }] },
+ condition: { $eq: [{ $store: 'routeStore.currentPath' }, '$button.path'] },
```

```diff
- condition: { $expr: 'button.bold' },
+ condition: '$button.bold',
```

#### `weNativeApp.ts` (2 uses)

Inside `$map` `select` — `$map` injects `item` into context, so `$item.*` works:

```diff
- id: { $expr: 'item.url || item.uuid' },
+ id: { $if: { condition: '$item.url', then: '$item.url', else: '$item.uuid' } },
```

```diff
- args: [{ $expr: "'/space/' + (item.url || item.uuid)" }],
+ args: [{ $concat: ['/space/', { $if: { condition: '$item.url', then: '$item.url', else: '$item.uuid' } }] }],
```

#### `SchemaRenderer.test.tsx` (1 use)

`$each` with `as: 'item'` → `$item`:

```diff
- children: [{ type: 'TestItem', props: { label: { $expr: 'item' } } }],
+ children: [{ type: 'TestItem', props: { label: '$item' } } }],
```

Note: `$item` (without a dot path) resolves the entire context value. The dispatcher handles this: if the string is exactly `$<contextKey>` with no dot, return `context[contextKey]` directly.

#### `propResolvers.test.ts` (5 test cases)

Delete or rewrite the 5 `$expr`-based test cases. Replace with `$item.*` and `$concat` equivalents where applicable.

### 6. Update docs and AI context

- Remove `$expr` from OPERATORS.md; rename `$forEach` → `$each`; add `$item` context reference and `$concat` sections
- Remove `$expr` from README.md operator table; rename `$forEach` → `$each`; add `$item` and `$concat`
- Update `schemaExamples.ts` (AI prompt examples) — replace `$expr` with `$item.*` / `$concat`, rename `$forEach` → `$each`
- Update `schemaContext.ts` — replace `$expr` references with `$item.*` / `$concat`, rename `$forEach` → `$each`

### 7. Tests

- Add `$item.*` dispatcher resolution tests (simple path, nested path, missing key, non-matching strings pass through)
- Add `$concat` resolver tests (strings, numbers, nested tokens, `$item.*` references, empty/null values)
- Verify all migrated templates render correctly
- Verify existing tests pass after `$expr` removal

---

## Dispatcher resolution order

After this PR, the dispatcher resolves values in this order:

1. **Token objects** (`hasAnyToken`) — `$store`, `$action`, `$map`, `$pick`, `$if`, `$not`, `$eq`, `$ne`, `$and`, `$or`, `$concat`
2. **Arrays** — recursively resolve elements
3. **Plain objects** — recursively resolve values
4. **Context reference strings** — `$<contextKey>` or `$<contextKey>.<path>` resolved against context
5. **Primitives** — returned as-is

Context references (#4) are checked only for strings starting with `$` where the key after `$` exists in the context object. All other strings (including `$store`, `$action` etc. which are object keys, not bare strings) are unaffected.

---

## `$item` vs `$map`'s existing `$item` handling

`$map` currently handles `$item.*` strings in its own `resolveSelectValue()` fast path before delegating to the dispatcher. After this PR:

- The dispatcher handles `$item.*` generically for any context key
- `$map`'s fast path can optionally be removed (the dispatcher will handle it), or kept as an optimisation
- Behaviour is identical either way — `$map` injects `item` into context via `{ ...context, item }`, so the dispatcher resolves `$item.*` correctly

Decision: **keep `$map`'s fast path** for now. It avoids the overhead of full `resolveProp` for the common case. Can be removed later for simplicity.

---

## Files changed

| File                                                                  | Change                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/schema-system/shared/src/propResolvers/concat.ts`           | New — `$concat` resolver                                               |
| `packages/schema-system/shared/src/propResolvers/expression.ts`       | Delete                                                                 |
| `packages/schema-system/shared/src/propResolvers/dispatcher.ts`       | Remove `$expr`, add `$concat`, add `$item.*`                           |
| `packages/schema-system/shared/src/types.ts`                          | Remove `ExprToken`, add `ConcatToken`                                  |
| `packages/schema-system/shared/src/index.ts`                          | Update exports                                                         |
| `packages/schema-system/OPERATORS.md`                                 | Remove `$expr`, rename `$forEach` → `$each`, add `$concat` and `$item` |
| `packages/schema-system/README.md`                                    | Update operator table (remove `$expr`, rename `$forEach` → `$each`)    |
| `packages/schema-system/solid/src/SchemaRenderer.tsx`                 | Rename `$forEach` → `$each`                                            |
| `packages/app-framework/src/shared/schemas/DefaultTemplate.schema.ts` | Migrate 2 uses                                                         |
| `packages/app-framework/src/shared/schemas/TwitterTemplate.schema.ts` | Migrate 6 uses                                                         |
| `packages/app-framework/src/shared/schemas/weNativeApp.ts`            | Migrate 2 uses                                                         |
| `packages/app-framework/src/shared/prompts/schemaExamples.ts`         | Update examples                                                        |
| `packages/app-framework/src/shared/prompts/schemaContext.ts`          | Update context docs                                                    |
| `packages/schema-system/shared/tests/propResolvers.test.ts`           | Remove 5 `$expr` tests, add `$item.*` tests                            |
| `packages/schema-system/solid/tests/SchemaRenderer.test.tsx`          | Migrate 1 `$expr` use                                                  |

---

## Sizing

Small PR. ~40 lines new code (`$concat` resolver + dispatcher `$item.*` resolution + types), ~40 lines deleted (`$expr` resolver + dispatcher branch + type), ~25 lines of template migrations, ~60 lines of tests.

---

## Relationship to other plans

| Plan                                        | Relationship                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [schema-validation](schema-validation.md)   | `$concat` gets a Zod schema. `$expr` removal means one fewer unvalidatable hole. `$item.*` strings are structurally validatable (check context key exists).                              |
| [ai-context-package](ai-context-package.md) | Token documentation updated: `$concat` and `$item` added, `$expr` removed from fragments.                                                                                                |
| Ecosystem token tiers                       | `$concat` joins Tier 1 (stable core). `$item.*` is a dispatcher resolution rule, not a token type. Count becomes 13 (after `$expr` removal); rises to 14 when `$query` lands in Phase B. |
