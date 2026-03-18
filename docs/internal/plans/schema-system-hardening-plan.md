# Schema System Hardening Plan

Post-refactoring work to solidify the schema-system foundation before feature generation.

## Priority 1 — Must Fix Before Feature Work

### 1.1 Fix Signal Detection — `readSignal` Check Is Already Broken

**File:** `packages/schema-system/solid/src/SchemaRenderer.tsx`

**Problem:** Signal detection relies on `v.name.includes('readSignal')`, but **Solid signal accessor `.name` is already `""` (empty string) at runtime** — verified with Solid 1.9.11. The check never matches, making `isSignal` always `false`. This is dead code.

**Observed behavior:** The boot screen login form uses `$store` props on web components (`we-input value`, `we-input error`, `we-button loading`) which resolve to signal accessor functions. Despite the dead `readSignal` check, the UI works correctly — the input starts blank, typing works, error/loading states behave as expected. This suggests either:

1. There's a compensating mechanism in the Solid→Lit rendering pipeline that handles function values correctly at runtime, or
2. The symptoms are masked by rendering timing and Lit's internal input handling (`handleInput` overwrites `this.value` on first keystroke, sidestepping the signal→value flow)

**Regardless of why it appears to work:** The `readSignal` check is provably dead code. The system works _despite_ it, not _because_ of it. The current behavior relies on undocumented framework interop rather than explicit, correct logic. This is fragile — a Solid, Lit, or bundler update could break it.

**Verified code flow:** `$store: 'adamStore.password'` → `resolveStoreProp` returns raw signal accessor (single-level path, returned directly without unwrapping) → `splitProps` classifies it as `safeProps` (function) → `reactiveAttrs` memo stores the function in attrs (dead `readSignal` check, never unwraps) → `<Dynamic>` → registry wrapper `(props) => <we-input {...props} />` → Solid's `spread → assignProp` → sets `node['value'] = signalAccessorFn` on the custom element.

**Why you can't just unwrap all functions:** `onInput`, `onClick`, `onKeyDown` are caught by Solid's event system BEFORE the property branch (line 451: `prop.slice(0, 2) === "on"` → delegated event listener). These never reach Lit's properties. But `close` (on `we-modal`), `onClick` (on `we-avatar`, `we-menu-item`) are **not** caught by Solid's event system because they're treated as CE properties. So there ARE non-`on`-prefixed callback props that must stay as functions.

**Fix — tag values at resolution time:** In `propResolvers.ts`, mark reactive accessors with a symbol during resolution so the renderer can distinguish them from event handlers without relying on function names:

```typescript
// In propResolvers.ts (shared)
export const REACTIVE_ACCESSOR = Symbol('schema-reactive-accessor');
export function markReactive<T extends Function>(fn: T): T {
  (fn as any)[REACTIVE_ACCESSOR] = true;
  return fn;
}

// In resolveStoreProp — wrap return values:
if (propertyPath.length === 1) return markReactive((stores[storeName] as Props)[propertyPath[0]]);
return markReactive(memo(() => { ... }));

// In resolveMapProp, resolvePickProp, resolveIfProp (non-$arg), resolveEqProp, resolveNeProp, resolveNotProp
// — wrap their memo/return in markReactive()
```

```typescript
// In SchemaRenderer.tsx — replace readSignal check:
const isReactiveAccessor = typeof v === 'function' && REACTIVE_ACCESSOR in v;

// Web components: unwrap reactive accessors, pass event handlers as-is
if (isWebComponent && isReactiveAccessor) attrs[k] = v();
else attrs[k] = v;
```

**Scope:** `propResolvers.ts` (tag ~6 return sites) + `SchemaRenderer.tsx` (replace 3 `readSignal` checks).

---

### 1.2 Add `schemaVersion` to TemplateSchema

**Files:**

- `packages/schema-system/shared/src/types.ts`
- `packages/schema-system/shared/src/zodSchemas.ts`

**Problem:** No version field means no migration path once schemas are persisted (localStorage, shared between peers, stored in seeds). Adding this later requires migrating all existing schemas.

**Fix:** Add `schemaVersion?: number` to `TemplateSchema` type and Zod schema. Default to `1`. Trivial change now, prevents painful migration later.

---

### 1.3 Document `$expr` Trust Boundary

**File:** `packages/schema-system/OPERATORS.md`

**Problem:** `$expr` uses `new Function()` for evaluation. The README says "AI-friendly" and "designed for automated UI generation." If externally-generated schemas are ever loaded, this is arbitrary code execution.

**Fix (phase 1 — docs):** Add a clear "Security" section to OPERATORS.md documenting that `$expr` is a trusted-only operator. Mark it in the operator reference.

**Fix (phase 2 — code, optional):** Add an `allowExpr: boolean` flag to `resolveProp` options. Default `true` for internal schemas, `false` for untrusted sources. When disabled, `$expr` tokens log a warning and return `undefined`.

---

## Priority 2 — Structural Improvements

### 2.1 Extract Transition Logic from SchemaRenderer

**File:** `packages/schema-system/solid/src/SchemaRenderer.tsx`

**Problem:** The `$if` handler is ~100 lines of opacity management, overlay detection, requestAnimationFrame, and CSS transition building. This makes the recursive renderer harder to read and maintain.

**Fix:** Extract into a `ConditionalRenderer` component:

```
solid/src/
  SchemaRenderer.tsx      ← stays lean, delegates $if to:
  ConditionalRenderer.tsx  ← handles transitions, overlay detection, opacity
```

The `$if` block in `RenderSchema` becomes:

```tsx
if (node.type === '$if') {
  return (
    <ConditionalRenderer node={node} stores={stores} registry={registry} context={context} renderNode={renderNode} />
  );
}
```

---

### 2.2 Derive `designSystemCamelCaseProps` from Source of Truth

**Files:**

- `packages/schema-system/solid/src/SchemaRenderer.tsx`
- `packages/design-system/types/src/index.ts`

**Problem:** The hardcoded set in SchemaRenderer will silently miss new design-system props:

```typescript
const designSystemCamelCaseProps = new Set([
  'zIndex',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'pointerEvents',
]);
```

**Fix:** Export the camelCase prop keys from `@we/design-system-types` and import them in the renderer. Single source of truth, no manual sync.

---

### 2.3 Fix `resolveRelativePath` Using `window.location`

**File:** `packages/schema-system/shared/src/propResolvers.ts`

**Problem:** `resolveRelativePath()` reads `window.location.pathname` directly. This makes `@we/schema-shared` not truly framework-agnostic (breaks SSR, breaks tests without jsdom).

**Fix:** Pass current pathname as a parameter (from context or a store), removing the browser dependency from shared code.

---

### 2.4 Make `cleanSchemaNode` Non-Mutating

**File:** `packages/schema-system/solid/src/schemaUpdater.ts`

**Problem:** `cleanSchemaNode` mutates `newNode` in place (has a `TODO: test & improve` comment). This can cause subtle bugs if the caller holds a reference.

**Fix:** Clone before mutating, or rewrite as a pure transform that returns a new object.

---

## Priority 3 — Test Coverage

### 3.1 Expand `zodSchemas.test.ts` (Currently 3 Tests)

This is the validation boundary. Needs coverage for:

- [ ] Every `SchemaNode` shape (with/without type, props, slots, children, routes)
- [ ] Nested children (node within node within node)
- [ ] All `SchemaProp` union arms (string, number, boolean, record, array, undefined)
- [ ] `RouteSchema` with valid/invalid paths
- [ ] `TemplateSchema` with complete/partial meta
- [ ] Rejection of extra properties (strict mode edge cases)
- [ ] Props containing token objects (`$store`, `$action`, etc.) — these are `Record<string, unknown>` so should pass

### 3.2 Expand `schemaUpdater.test.ts` (Currently 3 Tests)

This is the hot-path for schema mutations. Needs coverage for:

- [ ] Threshold behavior: exactly 10 mutations (batch) vs 11 (produce)
- [ ] Nested path application (children[0].props.text changes)
- [ ] Deletion semantics (value set to undefined)
- [ ] Adding new keys/children
- [ ] Validation rejection with specific error details
- [ ] Empty mutation list (no-op)
- [ ] Schema with routes, slots, and children all changing

### 3.3 Add Integration Tests for `RenderSchema`

The solid package currently has **zero tests**. Needs at minimum:

- [ ] Basic component rendering (type lookup in registry)
- [ ] `$if` conditional show/hide
- [ ] `$forEach` list rendering
- [ ] `$routes` outlet rendering
- [ ] Slot rendering
- [ ] Prop resolution with mock stores
- [ ] Unknown type throws error

This requires `solid-testing-library` or equivalent.

---

## Priority 4 — Future-Proofing (Nice to Have)

### 4.1 Add `$and` / `$or` Operators

Currently compound conditions require `$expr`, which means arbitrary JS. Adding `$and` / `$or` would handle the common case safely:

```json
{ "$and": [{ "$store": "userStore.isAdmin" }, { "$not": { "$store": "appStore.isLocked" } }] }
```

### 4.2 Consistent Error Behavior for `$action`

`$store` throws on invalid access (missing property path). `$action` silently returns `undefined` for missing stores/methods. Make behavior consistent — either throw or warn in both.

### 4.3 Schema-Aware Prop Validation

Currently Zod validates schema _structure_ but not prop _values_ against component interfaces. A future enhancement could validate that props match the target component's accepted props (using the component registry + DesignSystemProps).

---

## Execution Order

```
1.1 signal detection fix  ← ACTIVE BUG, boot screen affected (tag w/ Symbol + fix 3 renderer sites)
1.2 schemaVersion         ← trivial type addition
1.3 $expr docs            ← documentation only
2.1 extract transitions   ← refactor
2.2 camelCase props       ← import change
2.3 window.location fix   ← parameter change
2.4 cleanSchemaNode       ← clone before mutate
3.1-3.3 test coverage     ← ongoing, add alongside feature work
```
