# Plan: Deep Unwrap of Schema-Resolved Props

## Problem

The schema system's prop resolver recursively resolves `$store` / `$action` tokens at any nesting depth. When a token like `{ $store: 'adamStore.mySpaceSidebarItems' }` appears inside a nested object (e.g. a group's `items` array within a sidebar config), the resolver returns a **reactive accessor (function)** in place of the value.

For **top-level props**, the schema renderer's `splitProps` system handles this — it detects accessors, separates them from plain values, and either passes them as JSX attributes or sets them as DOM properties via `createEffect`.

For **nested values inside objects/arrays**, the accessor leaks through to the component unchanged. The component type says `items: CollapsibleSidebarItem[]` but at runtime it receives `items: () => CollapsibleSidebarItem[]`.

This is not specific to CollapsibleSidebar — it affects any component receiving schema-resolved deeply nested reactive values.

### Current workarounds

3 components currently have manual unwrap patterns for leaked schema accessors:

| Component | File | Pattern |
|---|---|---|
| CollapsibleSidebar | `5-widgets/.../CollapsibleSidebar.solid.tsx` | `typeof items === 'function' ? items() : items` |
| CesiumGlobe | `5-widgets/.../CesiumGlobe.solid.tsx` | `typeof enabled === 'function' ? enabled() : enabled` (2 places) |
| ConditionalRenderer | `schema-system/solid/src/ConditionalRenderer.tsx` | `typeof condition === 'function' ? condition() : condition` |

Additionally, `cesium-layers/.../user-locations/index.ts` has a similar pattern for `locations` (comment: "could be a signal accessor").

**Not in scope:** GraphWidget's `labelColor(node)` / `labelBgColor(node)` are legitimate callback checks (they pass a parameter), not leaked schema accessors.

These workarounds push schema system concerns into component code.

## Proposed Fix: Deep unwrap in schema renderer

Before passing complex props to Solid components, recursively unwrap accessor values into `createMemo` wrappers. This preserves reactivity while keeping components unaware of the schema system.

### Implementation

**File:** `packages/schema-system/solid/src/SchemaRenderer.tsx` (or shared utils)

In the prop resolution pipeline, after `resolveProps()` and before passing to components:

```ts
function deepUnwrap(value: unknown, memo: typeof createMemo): unknown {
  // Only unwrap reactive accessors (marked with REACTIVE_ACCESSOR symbol).
  // Event handlers and other plain functions must pass through untouched.
  if (typeof value === 'function' && REACTIVE_ACCESSOR in value) {
    return memo(() => deepUnwrap(value(), memo));
  }
  if (typeof value === 'function') return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepUnwrap(item, memo));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deepUnwrap(v, memo);
    }
    return result;
  }
  return value;
}
```

**Critical:** Must check `REACTIVE_ACCESSOR in value` — not just `typeof value === 'function'` — to avoid unwrapping event handlers (`onClick`, `onInput`, etc.). The `REACTIVE_ACCESSOR` symbol is already defined in `reactive.ts` and used by `resolveStoreProp()` to mark reactive accessors.

Apply in both places the renderer distributes props:
1. The `reactiveAttrs` memo (~line 122) — where `complexProps` are spread for Solid components
2. The `createEffect` (~line 143) — where `complexProps` are set via `hostRef[k]` for web components

The `$map` resolver already implements this pattern (lines 56-57, 61) and serves as the working model.

### Key considerations

1. **Performance:** Deep unwrap adds overhead per complex prop per render. Should only apply to complex props that actually contain nested accessors. Could check for accessor presence first.

2. **Reactivity preservation:** Wrapping in `createMemo` ensures Solid tracks the dependency. The component sees a plain value, but updates when the underlying store changes.

3. **Depth limit:** Match the existing resolver depth limit (10) to prevent infinite recursion on circular structures.

4. **Where to apply:** Only in the `complexProps` branch of `splitProps` handling — safe props (primitives, functions) don't need this.

## Alternative: Utility helper approach

Instead of fixing in the renderer, provide a shared `unwrapProp` utility that components use explicitly:

```ts
// @we/design-utils
export function unwrapProp<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}
```

**Pros:** Simple, explicit, no renderer changes.
**Cons:** Every component that receives nested schema props must know to use it. Schema concerns leak into components.

## Recommendation

Option 1 (deep unwrap in renderer) is the right long-term fix — it keeps the boundary clean between schema resolution and component code. Components should never need to know about accessors in their nested props.

## Files to change

| File | Change |
|---|---|
| `packages/schema-system/solid/src/SchemaRenderer.tsx` | Add `deepUnwrap` for complex props before passing to components. Import `REACTIVE_ACCESSOR` from shared. |
| `packages/schema-system/shared/src/propResolvers/reactive.ts` | Ensure `REACTIVE_ACCESSOR` is exported (verify current export) |
| `packages/design-system/5-widgets/src/widgets/sidebars/CollapsibleSidebar/CollapsibleSidebar.solid.tsx` | Remove manual unwrap workaround |
| `packages/design-system/5-widgets/src/widgets/cesium/CesiumGlobe/CesiumGlobe.solid.tsx` | Remove 2 manual unwrap workarounds |
| `packages/cesium-layers/src/planet/user-locations/index.ts` | Remove manual unwrap workaround |
| `packages/schema-system/solid/src/ConditionalRenderer.tsx` | Remove manual unwrap workaround |
