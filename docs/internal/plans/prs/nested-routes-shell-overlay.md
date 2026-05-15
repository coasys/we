# PR Plan: Nested Layout Routes + Shell Overlay

## Overview

Two interrelated refactors that together eliminate the `isShell` smell, fix Cesium remounting, and make shell views (profile, settings, schema-tests) render as an overlay rather than replacing the active template.

Supersedes [nested-router-layout-routes.md](./nested-router-layout-routes.md) — that plan covered Part A in isolation; this plan also covers Part B and brings them together.

---

## Part A — Nested Layout Routes (solves Cesium remount)

### Problem

`flattenRoutes` in `TemplateProvider.tsx` converts the schema route tree into a flat array of `<Route>` components with full paths like `/space/:spaceId/globe`. There is no persistent parent component for `/space/:spaceId/*` — every matched route remounts the entire component tree independently. Navigating between sub-views (globe → cards → globe) unmounts and remounts `CesiumGlobe` each time.

### Fix

Replace `flattenRoutes` → `buildRoutes` in `TemplateProvider.tsx`. For routes that have both `children` and sub-`routes`, emit real **nested `<Route>` components**: the parent becomes a layout route that stays mounted while only the `<Outlet>` content (i.e. the `{ type: '$routes' }` slot) swaps.

SolidJS Router's `props.children` maps exactly to the existing `{ type: '$routes' }` outlet — no schema type changes needed.

Key SolidJS Router behaviour that makes this work:

- When `:spaceId` param changes (switching spaces), the layout component **stays mounted**, only the outlet swaps.
- The `{ path: '/', redirect: './globe' }` redirect fires from inside the already-mounted layout — it no longer unmounts the Globe to execute the redirect.

### Template switching

SolidJS Router expects `<Route>` children to be defined statically. To handle template switching, key `<Router>` on `currentTemplate.id`:

```tsx
<Router key={templateStore.currentTemplate.id} root={createLayout(stores, shellSchema)}>
  {buildRoutes(stores, templateSchema.routes ?? [], stores)}
</Router>
```

Template switching is a rare intentional user action; a full Router remount on switch is acceptable.

### Per-template last-route restoration

`switchTemplate` already resets the URL on every switch — this is a pre-existing behaviour, not introduced by the keyed Router. To restore the user's last position when switching back to a template, `TemplateStore` maintains an in-memory map:

```ts
const lastRouteByTemplate = new Map<string, string>();

function switchTemplate(newTemplateId: string) {
  // Save current position before leaving
  if (currentTemplate.id) {
    lastRouteByTemplate.set(currentTemplate.id, routeStore.currentPath());
  }

  // ... setCurrentTemplate ...

  // Restore last known route for the new template, fall back to default
  const lastRoute = lastRouteByTemplate.get(newTemplateId);
  if (lastRoute) {
    routeStore.navigate(lastRoute);
  } else {
    // existing logic: space route or '/'
  }
}
```

The map is in-memory only (not persisted) — on app restart the user lands on the default route. If a stored route 404s (e.g. the template schema was edited to remove that route), the `*` not-found handler catches it gracefully.

### Sidebar revert

Once nested routes work correctly, revert sidebar space `onClick` from the full `/space/:id/$view` path back to just `/space/:id`. The `{ path: '/', redirect: './globe' }` redirect inside the mounted layout handles the default sub-view without any unmounting.

---

## Part B — Shell Overlay (removes `isShell` entirely)

### Problem

Profile, Settings, and SchemaTests currently replace `currentTemplate` — shell IDs are set on `currentTemplate.id`, which corrupts `switchTemplate`'s navigation logic and requires `isShell` checks in both `TemplateStore` and `SpaceStore`.

### Fix

Shell views become an **overlay layer** on top of the active template. `currentTemplate` is never set to a shell ID. A new `activeShellView` signal tracks which shell view (if any) is open. A local `shellRouter` gives the shell its own isolated routing context so its internal sub-routes don't interact with the URL bar.

### Changes

#### 1. `TemplateStore.tsx`

- Add `activeShellView: Accessor<string | null>` signal (initial `null`)
- Add `openShellView(id: string)` — sets `activeShellView`
- Add `closeShellView()` — clears `activeShellView`
- Export both on the `TemplateStoreBase` interface
- Remove `isShell` branch from `switchTemplate` — shell IDs are never passed to it from the sidebar anymore
- Keep `landing-page` template as-is (it's the boot screen, rendered as `currentTemplate` before login — not a sidebar shell view)

#### 2. `TemplateProvider.tsx`

Create a local `shellRouter` — a minimal in-memory router (~20 lines):

```ts
const [shellPath, setShellPath] = createSignal('/');
const shellRouter = {
  currentPath: () => shellPath(),
  segments: () => shellPath().split('/').filter(Boolean),
  navigate: (path: string) => setShellPath(path),
  setNavigateFunction: () => {},
  setCurrentPath: () => {},
};
```

Passed as `routeStore` in the shell overlay's `stores` bag — shell schemas' `$store: 'routeStore.segments.0'` lookups work without any schema changes.

Add shell overlay `<Show>` layer after the main template render:

```tsx
<Show when={stores.templateStore.activeShellView()}>
  {(shellViewId) => {
    const shellNode = shellNodeMap[shellViewId()];
    return shellNode ? (
      <RenderSchema node={shellNode} stores={{ ...stores, routeStore: shellRouter }} registry={registry} />
    ) : null;
  }}
</Show>
```

The overlay renders **inside the content area div** (`position: absolute`, filling it completely) — not `position: fixed` over the full viewport. This keeps the shell sidebar unobscured and means the overlay inherits the same `left: var(--we-sidebar-width)` offset as all other content. A close button (or clicking outside, or clicking a space in the sidebar) calls `templateStore.closeShellView()`.

`shellNodeMap` maps shell view IDs to their schema nodes: `{ profile: profileTemplate, settings: settingsTemplate, 'schema-tests': schemaTestsTemplate }`.

#### 3. `Sidebar.schema.ts`

Profile / Settings / SchemaTests `onClick`:

```diff
- { $action: 'templateStore.switchTemplate', args: ['profile'] }
+ { $action: 'templateStore.openShellView', args: ['profile'] }
```

Their `active` state reads `activeShellView` instead of `currentTemplate.id`:

```diff
- { $eq: [{ $store: 'templateStore.currentTemplate.id' }, 'profile'] }
+ { $eq: [{ $store: 'templateStore.activeShellView' }, 'profile'] }
```

#### 4. `SpaceStore.tsx`

Replace the `isShell` + `switchTemplate` block in `navigateToSpace`:

```diff
- const isShell = templateStore.shellTemplates.some((t) => t.id === templateStore.currentTemplate.id);
- if (isShell) templateStore.switchTemplate(templateStore.defaultTemplateId());
+ templateStore.closeShellView();
  routeStore.navigate(targetPath);
```

Remove `useTemplateStore` import — no longer needed.

#### 5. `TemplateStore.tsx` (cleanup)

- Remove `shellTemplates` from the exported interface (no longer needed externally)
- Remove the `isShell` branch in `switchTemplate`

---

---

## Sidebar Width Constant (`--we-sidebar-width`)

### Problem

`72px` (the collapsed shell sidebar width) is hardcoded in three places:

| File                   | Usage                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `TemplateProvider.tsx` | `left: '72px'` and `calc(100% - 72px)` on the content area div                           |
| `Sidebar.schema.ts`    | `width: '72px', height: '72px'` on the WE logo header slot (its own sizing — fine as-is) |

`GlobeRoute/index.ts` uses `calc(100% - 400px)` — that is the **SpaceSidebar** width (internal to DefaultTemplate), not the shell sidebar. It is not related and should not be changed.

### Fix

Extract the sidebar width to a **CSS custom property** on the app root element:

```css
:root {
  --we-sidebar-width: 72px;
}
```

Set in `TemplateProvider.tsx` (or a global CSS file loaded by the app). Then:

- `TemplateProvider.tsx` content div: `left: 'var(--we-sidebar-width)'` and `calc(100% - var(--we-sidebar-width))`
- `Sidebar.schema.ts` logo slot: unchanged (its own `72px` dimensions, fine to keep explicit)

### Template author contract

Normal space templates rendering block-level or flex content **do not need to know about the sidebar** — they render inside the content area div which is already offset. Only templates/components that use `position: fixed` or render outside their container (like CesiumGlobe's canvas) need the variable. Document this in the schema authoring guide.

---

## What Is NOT Changing

- `RouteSchema` type in `@we/schema-shared` — no new fields
- `SchemaNode` / schema-system packages — no changes
- Shell schema files themselves (profile, settings, schema-tests) — unchanged content, just rendered differently
- `keepAlive` flag — dropped; the problem is solved architecturally by nested layout routes

---

## Files Changed

| File                                                                         | Change                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app-framework/src/frameworks/solid/providers/TemplateProvider.tsx` | `flattenRoutes` → `buildRoutes`; keyed `<Router>`; `shellRouter`; shell overlay `<Show>`; `--we-sidebar-width` CSS var on root                                    |
| `packages/app-framework/src/frameworks/solid/stores/TemplateStore.tsx`       | Add `activeShellView`, `openShellView`, `closeShellView`; `lastRouteByTemplate` map in `switchTemplate`; remove `isShell`; remove `shellTemplates` from interface |
| `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`          | Replace `isShell`+`switchTemplate` with `closeShellView`; remove `useTemplateStore`                                                                               |
| `packages/app-framework/src/shared/schemas/shell/Sidebar.schema.ts`          | Profile/settings/schema-tests → `openShellView`; `active` → `activeShellView`; space `onClick` reverted to `/space/:id`                                           |

---

## Order of Implementation

1. Add `--we-sidebar-width: 72px` CSS var in TemplateProvider; update content div and GlobeRoute to consume it
2. `buildRoutes` + keyed `<Router>` in TemplateProvider (Part A core)
3. Revert Sidebar space `onClick` to bare `/space/:id` path
4. Add `activeShellView` / `openShellView` / `closeShellView` to TemplateStore; add `lastRouteByTemplate` restore to `switchTemplate`; remove `isShell`
5. Create `shellRouter` + shell overlay `<Show>` layer (position: absolute filling content area) in TemplateProvider (Part B core)
6. Update Sidebar profile/settings/schema-tests to use `openShellView` + `activeShellView`
7. Update SpaceStore: `closeShellView` instead of `isShell`+`switchTemplate`; remove `useTemplateStore`
8. Build and verify

---

## Risks / Edge Cases

- **Router remount on template switch**: Keying `<Router>` on `templateId` resets SolidJS Router-internal state (scroll restoration, back/forward stack) per template session. URL position is restored via `lastRouteByTemplate`. The back/forward stack reset is acceptable — templates are workspaces, not browsing sessions.
- **`onMount` discipline for layout routes**: Layout routes stay mounted when only sub-routes change. Any init code using `onMount` for param-specific state will silently stale. `SpaceStore` already handles this correctly via `createEffect`.
- **Shell overlay z-index**: Overlay must render above the content viewport but respect the existing sidebar (z-index 10). Shell overlay should sit at z-index 11 or use a portal to the document body.
- **Back button closes shell view**: When `activeShellView` is set, browser back could be confusing. For now, the overlay is closed only via explicit action (sidebar click, close button). No history entry is created.
- **`landing-page` template**: Stays as a `currentTemplate` value — it's the boot screen shown before login, not a sidebar button. It is not routed through `openShellView`.
