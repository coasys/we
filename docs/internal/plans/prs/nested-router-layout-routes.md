# PR Plan: Nested Layout Routes (Real SolidJS Outlet Pattern)

## Problem

`flattenRoutes` in `TemplateProvider.tsx` converts the schema route tree into a **flat array** of `<Route>` components, each with its full path (e.g. `/space/:spaceId/globe`). This means:

- There is no persistent parent component for `/space/:spaceId/*` — every matched rotue remounts the entire component tree independently.
- Navigating to the bare `/space/:spaceId` path (e.g. from the shell sidebar) matches a `<Navigate href="./globe" />` redirect, which causes a two-step navigation. During the intermediate step the previous route's component (e.g. `CesiumGlobe`) is unmounted, and then remounted after the redirect resolves.
- The workaround currently in place (navigating to the full sub-path from the sidebar) avoids the redirect but leaks path-convention knowledge into schema navigation actions.

## Correct Fix

Emit real **nested `<Route>` components** from schema route definitions that have both `children` and `routes`. SolidJS Router supports this natively:

```tsx
<Route path="/space/:spaceId" component={LayoutComponent}>
  <Route path="/globe" component={GlobeComponent} />
  <Route path="/home"  component={HomeComponent} />
  ...
</Route>
```

When `:spaceId` param changes (switching spaces), the `LayoutComponent` **stays mounted** — only the `<Outlet>` content swaps. The redirect `{ path: '/', redirect: './globe' }` also works correctly in this model because `<Navigate>` fires from inside the already-mounted layout, without unmounting it.

## Work Required

### 1. `RouteSchema` type (`@we/schema-shared`)

Add a distinction between "layout routes" (have children + sub-routes, rendered as a persistent wrapper with an `<Outlet>`) and "leaf routes" (current behaviour). In practice this means the schema route definition already supports it — `children` is the layout chrome, `routes` are the sub-routes — but `flattenRoutes` currently inlines them all.

No type changes should be needed; the schema `RouteSchema` already has both `children` and `routes`.

### 2. `flattenRoutes` → `buildRoutes` in `TemplateProvider.tsx`

Replace the recursive flatten with a function that emits nested JSX:

```tsx
function buildRoutes(
  stores: Stores,
  routes: RouteSchema[],
  parentPath = '',
  parentStack: ParentStackItem[] = [],
): JSX.Element[] {
  return routes.map((route) => {
    const fullPath = /* same path resolution as today */;

    if (route.redirect) {
      return <Route path={fullPath} component={() => <Navigate href={resolveRedirect(route.redirect, parentPath)} />} />;
    }

    const component = buildComponent(route, stores, parentStack);

    if (route.routes?.length) {
      // Layout route: stays mounted, sub-routes render into $routes outlet
      return (
        <Route path={fullPath} component={component}>
          {buildRoutes(stores, route.routes, fullPath, [...parentStack, { node: route, fullPath, baseDepth }])}
        </Route>
      );
    }

    // Leaf route: current behaviour
    return <Route path={fullPath} component={component} />;
  });
}
```

The `$routes` token in the schema renderer already returns `children ?? null`, which maps exactly to SolidJS Router's `<Outlet>` (passed as `props.children` to the layout component).

### 3. Revert sidebar workarounds

Once nested routes work correctly:

- **`Sidebar.schema.ts`**: revert space `onClick` back to `{ $concat: ['/space/', '$item.uuid'] }` — the redirect handles the sub-view default without unmounting anything.
- **`Settings.schema.ts`**: same revert.
- **`DefaultTemplate/index.ts`**: the `{ path: '/', redirect: './globe' }` redirect works as intended with no side effects.

### 4. `$nav` context / `baseDepth`

The existing `baseDepth` context value (used for relative navigation like `./globe`) is set per-stack-frame in `flattenRoutes`. Verify it continues to work correctly when `buildRoutes` passes it through the nested structure. The `baseDepth` of the layout route's children should still be computed from their own `fullPath`, not the parent's.

## Downsides & Architectural Tradeoffs

### 1. Dynamic routes conflict with SolidJS Router's design
SolidJS Router expects `<Route>` children to be defined statically at mount time — it reads the route tree once. The current code cheats this with `createMemo(() => flattenRoutes(...))`, which rebuilds a flat array that gets `.map()`'d into `<Route>` elements on each template switch. With nested JSX, this pattern breaks down — you can't easily express reactive nested `<Route>` trees. Template switching would likely require forcing a full Router remount (e.g. keying it on `currentTemplate.id`), which resets scroll position, URL history, and any other router state. This may be the most significant implementation challenge.

### 2. `onMount` vs `createEffect` discipline
A layout route component stays mounted when only the `:spaceId` param changes. Any code inside it that uses `onMount` to initialise param-specific state will only fire once and then silently become stale. `SpaceStore` already handles this correctly via `createEffect(() => adamStore.currentPerspective())`, but this is a subtle rule that must be understood by anyone adding features to layout routes.

### 3. `children` + `routes` semantics change
Currently a schema node with both `children` and `routes` renders everything inline — the `$routes` outlet swaps content and the parent re-renders with it. Under the nested model, `children` become a *permanently mounted wrapper* that never unmounts between sub-route navigations. If any `children` node has `$localState` or side effects intended to reset on navigation, it won't. The semantics are subtly different and not obvious from reading the schema.

### 4. Alternative: client-side tab state
An alternative that avoids all routing complexity entirely: drop URL-based sub-view routing inside a space and use a client-side signal in `SpaceStore` (e.g. `activeView: 'globe' | 'home' | 'graph'`). This gives zero remounting with zero routing infrastructure changes, at the cost of losing URL-addressability for sub-views (e.g. deep-linking to `/space/<uuid>/globe`). Worth considering if shareable sub-view links are not a requirement.

### Summary
The nested layout route approach is the most architecturally correct solution within the existing URL-driven routing model. However, the template-switch reactivity problem (point 1) is a real implementation challenge that may end up being messier than the current sidebar workaround. If template switching is rare and the remount cost there is acceptable, this PR is worth doing. If not, the client-side tab state alternative deserves serious consideration first.

---

## Risks / Edge Cases

- **`createMemo(() => flattenRoutes(...))` reactivity**: The current implementation rebuilds the entire flat route list reactively when the template changes. Nested JSX isn't easily expressed as a memo — may need `<For>` or a derived signal approach to preserve reactivity on template switch.
- **`<Show keyed>` wrapper**: `TemplateProvider` wraps `<RenderSchema>` in `<Show when={currentTemplate.id} keyed>` to force remount on template switch. The nested routes need to be inside the same reactive boundary.
- **Redirect resolution**: Relative redirects (`./globe`) need to be resolved against the parent route's runtime URL (with real param values). This is already handled for the flat case; verify it still works nested.
- **Test coverage**: `SchemaRouting.schema.ts` test suite exercises `$routes` and nested routes — run these before merging.

## Impact

- CesiumGlobe (and any other persistent component in a layout route) stays mounted when switching spaces — no remount, no reload flicker.
- Any template using the `children` + `routes` schema pattern gets correct layout-route semantics automatically.
- Sidebar and Settings navigation schemas become simpler.

## Current Workaround

`Sidebar.schema.ts` and `Settings.schema.ts` navigate to `/space/<uuid>/<subview>` directly (preserving the current sub-view segment from `routeStore.segments.2`, defaulting to `globe`). This avoids the redirect but must be reverted once this PR lands.

## Related Files

- `packages/app-framework/src/frameworks/solid/providers/TemplateProvider.tsx` — main change
- `packages/app-framework/src/shared/schemas/shell/Sidebar.schema.ts` — revert after
- `packages/app-framework/src/shared/schemas/shell/Settings.schema.ts` — revert after
- `packages/app-framework/src/shared/schemas/DefaultTemplate/index.ts` — unchanged, but benefits
- `packages/schema-system/frameworks/solid/tests/SchemaRenderer.test.tsx` — verify
- `packages/app-framework/src/shared/schemas/shell/tests/SchemaRouting.schema.ts` — verify
