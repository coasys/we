# Plan: Deep Unwrap of Schema-Resolved Props

## Problem

The schema system's prop resolver recursively resolves `$store` / `$action` tokens at any nesting depth. When a token like `{ $store: 'adamStore.mySpaceSidebarItems' }` appears inside a nested object (e.g. a group's `items` array within a sidebar config), the resolver returns a **reactive accessor (function)** in place of the value.

For **top-level props**, the schema renderer's `splitProps` system handles this — it detects accessors, separates them from plain values, and either passes them as JSX attributes or sets them as DOM properties via `createEffect`.

For **nested values inside objects/arrays**, the accessor leaks through to the component unchanged. The component type says `items: CollapsibleSidebarItem[]` but at runtime it receives `items: () => CollapsibleSidebarItem[]`.

This is not specific to CollapsibleSidebar — it affects any component receiving schema-resolved deeply nested reactive values.

### Current workaround

Components manually unwrap with an `unknown` cast:

```ts
const groupItems = createMemo(() => {
  const items: unknown = getGroup().items;
  return typeof items === 'function'
    ? (items as () => CollapsibleSidebarItem[])()
    : (items as CollapsibleSidebarItem[]);
});
```

This works but pushes schema system concerns into component code.

## Proposed Fix: Deep unwrap in schema renderer

Before passing complex props to Solid components, recursively unwrap accessor values into `createMemo` wrappers. This preserves reactivity while keeping components unaware of the schema system.

### Implementation

**File:** `packages/schema-system/solid/src/SchemaRenderer.tsx` (or shared utils)

In the prop resolution pipeline, after `resolveProps()` and before passing to components:

```ts
function deepUnwrap(value: unknown, memo: typeof createMemo): unknown {
  if (typeof value === 'function') {
    // Wrap accessor in memo to preserve reactivity
    return memo(() => deepUnwrap(value(), memo));
  }
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

Apply this to complex props (objects/arrays) before they are set on the component ref or passed as JSX attributes.

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

| File                                                                                                    | Change                                                         |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/schema-system/solid/src/SchemaRenderer.tsx`                                                   | Add deep unwrap for complex props before passing to components |
| `packages/design-system/5-widgets/src/widgets/sidebars/CollapsibleSidebar/CollapsibleSidebar.solid.tsx` | Remove manual unwrap workaround once renderer handles it       |
