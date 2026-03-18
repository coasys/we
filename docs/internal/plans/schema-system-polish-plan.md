# Schema System Polish Plan

Follow-up to the hardening plan. The core architecture is sound — this plan covers code organization, type safety, documentation, and test coverage to make the schema system a production-grade foundation for feature generation and AI-driven schema authoring.

## Status

| Phase | Status |
|-------|--------|
| P1 — Split propResolvers into directory | Done |
| P2 — Operator token types | Done |
| P3 — Document renderer operators + dual $if | Done |
| P4 — Update README + minor type fixes | Done |
| P5 — Solid renderer tests | Done |

---

## P1 — Split `propResolvers.ts` into a Directory

**Why:** `propResolvers.ts` is 310 lines with 12 resolver functions, the dispatcher, utilities, and types — all in one flat file. Adding a new operator means modifying a monolith. Each resolver is self-contained with no shared mutable state, making this a clean split.

**Current structure:**
```
shared/src/propResolvers.ts  ← everything in one file
```

**Target structure:**
```
shared/src/propResolvers/
  index.ts                ← re-exports public API (resolveProp, resolveProps, splitProps, REACTIVE_ACCESSOR)
  dispatcher.ts           ← resolveProp, resolveProps, hasAnyToken, depth guard
  store.ts                ← resolveStoreProp ($store)
  action.ts               ← resolveActionProp ($action) + processArgTokens + resolveRelativePath
  map.ts                  ← resolveMapProp ($map)
  pick.ts                 ← resolvePickProp ($pick)
  conditional.ts          ← resolveIfProp ($if prop-level, both $arg and standard variants)
  expression.ts           ← resolveExpressionProp ($expr)
  comparisons.ts          ← $eq, $ne, $not, $and, $or (small functions, fine in one file)
  splitProps.ts            ← splitProps
  reactive.ts             ← REACTIVE_ACCESSOR symbol + markReactive helper
  types.ts                ← Props, MapProp, PickProp, IfProp, Memo, noMemo
```

**Rules:**
- Public export surface stays identical — `index.ts` re-exports the same symbols
- No new dependencies, no runtime behavior changes
- Each resolver file exports a single named function
- `dispatcher.ts` imports resolver functions and dispatches based on `hasToken` checks
- Existing tests pass without modification (they import from `../src/propResolvers` which resolves to the directory's `index.ts`)

**Scope:** `shared/src/` only. No changes to solid package or consumers.

---

## P2 — Operator Token Types

**Why:** Schema props are typed as `Record<string, unknown>` (via `SchemaProp`). There is zero compile-time validation when authoring schemas in `.schema.ts` files. A typo like `{ $stoer: 'x.y' }` compiles fine and silently does nothing at runtime.

**Add to `shared/src/types.ts`:**

```typescript
// Operator token types — for schema authoring DX
export type StoreToken = { $store: string };
export type ExprToken = { $expr: string };
export type ActionToken = { $action: string; args?: unknown[] };
export type IfToken = { $if: { condition: unknown; then: unknown; else?: unknown } };
export type MapToken = { $map: { items: unknown; select: Record<string, unknown> } };
export type PickToken = { $pick: { from: unknown; props: string[] } };
export type EqToken = { $eq: [unknown, unknown] };
export type NeToken = { $ne: [unknown, unknown] };
export type NotToken = { $not: unknown };
export type AndToken = { $and: unknown[] };
export type OrToken = { $or: unknown[] };

export type OperatorToken =
  | StoreToken | ExprToken | ActionToken | IfToken
  | MapToken | PickToken | EqToken | NeToken
  | NotToken | AndToken | OrToken;
```

**Also export from `shared/src/index.ts`.**

**Rules:**
- Types only — no runtime changes
- Don't change `SchemaProp` itself (that would break Zod schema compatibility)
- Don't force consumers to use these types — they're opt-in for better DX
- The resolver functions can optionally use these types internally to replace `as` casts

---

## P3 — Document Renderer Operators and Dual `$if`

**Why:** `OPERATORS.md` only documents prop-level operators. The renderer handles three special node types (`$if`, `$forEach`, `$routes`) plus the implicit fragment (no `type`). These are never documented together. The `$if` operator has two completely different behaviors depending on context — this dual nature is the single most confusing aspect of the schema system for AI agents.

### 3.1 Add "Renderer Operators" section to OPERATORS.md

Document the four node-type behaviors the renderer recognizes:

**`$if` (node-level):**
- `type: '$if'`
- Props: `condition`, `then` (SchemaNode), `else` (SchemaNode, optional), `enterTransition`, `exitTransition`
- Renders/hides child nodes based on condition

**`$forEach`:**
- `type: '$forEach'`
- Props: `items` (array or $store ref), `as` (string, default `'item'`)
- `children[0]` is the template node, rendered once per item
- Each iteration injects `context[as]` with the current item

**`$routes`:**
- `type: '$routes'`
- Placeholder for route outlet — replaced with routed children by the parent

**Fragment (no type):**
- When `type` is omitted, children are rendered as a JSX fragment
- Used for grouping without a wrapper element

### 3.2 Add "Dual-Use: `$if`" section

Explicitly document both forms side-by-side:

| Context | Syntax | Where handled | Supports transitions | Supports `$arg` |
|---------|--------|---------------|---------------------|-----------------|
| Node type | `{ type: '$if', props: { condition, then, else } }` | SchemaRenderer → ConditionalRenderer | Yes | No |
| Prop value | `{ $if: { condition, then, else } }` | propResolvers → resolveIfProp | No | Yes |

With examples of each.

### 3.3 Add "HTML Element Passthrough" note

Document that lowercase type strings (`aside`, `main`, `header`, `div`, `span`) that aren't in the component registry are rendered as native HTML elements. This is implicit behavior the renderer supports via the `isHtmlElement` regex check.

---

## P4 — README Update + Minor Type Fixes

### 4.1 Update README.md

Current README is missing half the operators. Update to list all features:
- All 12 operators ($store, $expr, $action, $map, $pick, $if, $eq, $ne, $not, $and, $or, $arg)
- Renderer operators ($if node, $forEach, $routes, fragment)
- REACTIVE_ACCESSOR signal tagging
- schemaVersion for migration
- TransitionConfig
- Link to OPERATORS.md for full reference

### 4.2 Remove `TransitionConfig` from `SchemaProp` union

`TransitionConfig` is in the `SchemaProp` union but only makes sense on `$if` node props. Remove it from the union — it's already accessed via `as TransitionConfig` in ConditionalRenderer. Keep the type export.

### 4.3 Remove double validation

`TemplateStore.updateTemplate()` calls `validateSchema()` then `updateSchema()` which internally calls `validateSchema()` again. Remove the redundant caller-side validation — `updateSchema` already validates and error-logs. This keeps the single responsibility in one place.

**Note:** This change is in `app-framework`, not `schema-system`.

---

## P5 — Solid Renderer Tests (Deferred P3.3)

**Why:** The solid package has zero tests. All P1/P2 renderer changes (REACTIVE_ACCESSOR unwrapping, ConditionalRenderer, DESIGN_SYSTEM_CAMEL_CASE_PROPS) are untested. Any regression is invisible.

### Setup

- Add `@solidjs/testing-library` + `happy-dom` to `solid/` devDependencies
- Add `vitest.config.ts` with `solid` plugin + `happy-dom` environment
- Create mock component registry for tests

### Test cases

**SchemaRenderer:**
- [ ] Renders registered component by type lookup
- [ ] Renders HTML element for lowercase type (passthrough)
- [ ] Renders children as fragment when no type
- [ ] Throws for unknown type
- [ ] Resolves `$store` props and passes to component
- [ ] Unwraps `REACTIVE_ACCESSOR` values for web components
- [ ] Keeps functions as-is for non-reactive props (event handlers)
- [ ] Sets `designSystemCamelCaseProps` via ref property (not attribute)
- [ ] Renders slot content
- [ ] `$routes` returns children prop

**ConditionalRenderer:**
- [ ] Shows `then` branch when condition is truthy
- [ ] Shows `else` branch when condition is falsy
- [ ] Updates when condition changes
- [ ] Applies enter/exit transitions (opacity, timing)

**schemaUpdater:**
- [ ] Calls Solid's setStore with correct mutations
- [ ] Rejects invalid schemas with console.error
- [ ] Handles large mutation batches via produce

---

## Execution Order

```
P1 — Split propResolvers (structural, no behavior change)
P2 — Operator token types (types only, no runtime change)
P3 — OPERATORS.md + README documentation
P4 — Minor type fixes + remove double validation
P5 — Solid renderer tests (infrastructure + tests)
```

P1–P4 can be done in one branch. P5 is independent and can be parallel or sequential.
