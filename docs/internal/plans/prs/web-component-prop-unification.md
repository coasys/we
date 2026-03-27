# Plan: Web Component Prop Unification

## Problem

Web components (`we-text`, `we-button`, etc.) receive props through two separate channels simultaneously:

```
Channel 1: <Dynamic component={wrapper} {...reactiveAttrs()} />
  └─ wrapper does: <we-text {...props}>  → Solid spread → setAttribute() calls
  └─ Filtered: excludes complex props and DESIGN_SYSTEM_CAMEL_CASE_PROPS

Channel 2: createEffect(() => { hostRef[k] = value })
  └─ Sets DOM properties directly on the element via ref
  └─ Handles: complex props + DESIGN_SYSTEM_CAMEL_CASE_PROPS
```

This dual-channel architecture has several issues:

### 1. Two systems touching the same element

The renderer carefully partitions props between channels. If partitioning fails (a prop classified incorrectly), it either gets set twice or not at all. The `splitProps` safe/complex distinction and `DESIGN_SYSTEM_CAMEL_CASE_PROPS` set are the gatekeepers — both must agree for correct delivery.

### 2. Ceremony wrapper functions

Every web component needs a registry wrapper that does nothing:

```tsx
'we-text': (props) => <we-text {...props}>{props.children}</we-text>,
'we-button': (props) => <we-button {...props}>{props.children}</we-button>,
```

These exist solely because `ComponentRegistry` requires functions. Only CesiumGlobe and GraphWidget use wrappers meaningfully (for dependency injection).

### 3. setAttribute vs property mismatch

Channel 1 (JSX spread) sets HTML attributes via `setAttribute()`. Channel 2 (ref effect) sets DOM properties. For web components, properties are the correct delivery mechanism — attributes only work for primitive string/boolean values and require manual parsing in the component. Complex values (objects, arrays) _must_ go through properties.

### 4. `DESIGN_SYSTEM_CAMEL_CASE_PROPS` maintenance burden

A manually-maintained set that must be updated every time a new camelCase prop is added to any design system element. If a prop is missing from the set, it gets set as an attribute instead of a property — silent failure.

## Proposed Fix: Single-channel prop delivery for web components

For web components, deliver **all** props through per-prop `createEffect` / `hostRef[k]` assignment. Remove the JSX spread channel for web components entirely.

### Architecture

```
Current (dual channel):
  props → splitProps → safe → reactiveAttrs → <Dynamic {...}> → setAttribute
                     → complex → createEffect → hostRef[k] → setProperty

Proposed (single channel):
  props → per-prop memo → createEffect → hostRef[k] → setProperty (all props)
  <Dynamic component="we-text" ref={hostRef}>{children}</Dynamic>
```

### Implementation

**Changes in SchemaRenderer.tsx** (building on #2b's per-prop memo structure):

```tsx
if (isWebComponent) {
  // All props delivered via per-prop effects — no spread, no attribute/property split
  for (const [key, memo] of Object.entries(propMemos)) {
    createEffect(() => {
      if (hostRef) hostRef[key] = memo();
    });
  }

  return (
    <Dynamic ref={hostRef} component={component()} {...slotProp} {...slotElements}>
      {renderChildren(node.children)}
    </Dynamic>
  );
} else {
  // Solid components: spread via reactiveAttrs (standard Solid pattern)
  return (
    <Dynamic component={component()} {...reactiveAttrs()} {...slotProp} {...slotElements}>
      {renderChildren(node.children)}
    </Dynamic>
  );
}
```

### Registry simplification

With the renderer handling web component rendering directly, wrapper functions become unnecessary:

```tsx
// Before: every web component needs a wrapper
'we-text': (props) => <we-text {...props}>{props.children}</we-text>,

// After: renderer uses Dynamic with the tag name directly
// No registry entry needed — falls through to native element handling
```

The `isHtmlElement` regex (`/^[a-z][a-z0-9]*$/`) currently excludes hyphenated names. Extend it or add a `isWebComponent` fallthrough:

```tsx
const component = createMemo(
  () => registry[node.type ?? ''] ?? (isHtmlElement || isWebComponent ? node.type : undefined),
);
```

Web components without a registry override resolve to their tag name. Registry entries only needed for dependency injection (CesiumGlobe, GraphWidget).

### DESIGN_SYSTEM_CAMEL_CASE_PROPS removal

With all props going through properties (not attributes), there's no need to distinguish camelCase props. The set can be removed entirely. Properties handle any casing — it's only `setAttribute()` that requires kebab-case.

## Key considerations

### 1. Event handler binding

Solid's JSX spread automatically handles `on*` props. With per-prop effects, we need to manually attach event listeners:

```tsx
if (key.startsWith('on') && typeof value === 'function') {
  // Use addEventListener, not property assignment
  const event = key.slice(2).toLowerCase();
  hostRef.addEventListener(event, value);
}
```

Or: keep event handler props in the spread and only route data props through effects. Need to verify Solid's `Dynamic` handles `on*` correctly when there's no spread for data props.

### 2. `children` prop

Children come from `renderChildren()`, not from prop resolution. They're already handled separately via the JSX children slot. No change needed.

### 3. `ref` assignment timing

`hostRef` is assigned by Solid when the element mounts. The `createEffect` runs after mount, so `hostRef` is available. This matches the current architecture — the existing createEffect for web components already relies on this timing.

### 4. Lit element compatibility

WE's web components use Lit. Lit elements accept properties via direct property assignment — `element.myProp = value` triggers Lit's reactive property system. This is exactly what `hostRef[k] = value` does. No compatibility concerns.

## Files to change

| File                                                  | Change                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schema-system/solid/src/SchemaRenderer.tsx` | Split render path: web components use per-prop effects (no spread), Solid components use reactiveAttrs spread. Remove `DESIGN_SYSTEM_CAMEL_CASE_PROPS` usage. |
| `packages/app-framework/.../componentRegistry.tsx`    | Remove ceremony wrappers for web components (`we-text`, `we-button`, etc.). Keep CesiumGlobe and GraphWidget wrappers (dependency injection).                 |
| `packages/schema-system/solid/src/SchemaRenderer.tsx` | Extend component resolution to allow `we-*` tag names as fallthrough (no registry entry required).                                                            |
| `packages/design-system/types/src/index.ts`           | Remove `DESIGN_SYSTEM_CAMEL_CASE_PROPS` export (verify no other consumers first).                                                                             |

## Relationship to other PRs

- **Depends on:** PR #2b (Fine-Grained Reactivity) — per-prop memos are the foundation for per-prop effects
- **Independent of:** PR #3 (Schema-Theme), PR #4b ($concat), PR #10 (Component Library)
- **Benefits:** PR #10 new web components won't need registry wrappers — just register the tag name or let it fall through
