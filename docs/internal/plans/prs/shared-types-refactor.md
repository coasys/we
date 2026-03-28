# Plan: Shared `*.types.ts` Refactor

> PR 7a — Extract framework-agnostic shared types, restructure component package directories

---

## Problem

1. **Prop interfaces are inline** — all 13 component/widget prop interfaces live in `.solid.tsx` files, mixing type contracts with framework-specific rendering
2. **No extraction target** — the planned `@we/ai-context` TypeScript extractor (PR 8) needs `*.types.ts` files to glob; inline props require framework-aware parsing
3. **No `@ai` JSDoc** — components with non-obvious contracts have no machine-readable documentation
4. **Inconsistent directory structure** — `solid/` barrel lives at `src/solid/` instead of `src/frameworks/solid/` (the convention established by `app-framework`)
5. **Accessor prop legacy** — 3 components (PopoverMenu, SpaceSidebarWidget, CreateSpaceModalWidget) accept `Accessor<T>` props, a pattern predating PRs 2/2b/2c. The SchemaRenderer has a special branch to pass accessors through to Solid components, adding complexity that's no longer needed

---

## Changes

### 0. Refactor accessor props → plain props

Three components accept `Accessor<T>` props — a legacy pattern from before the per-prop memo system (PRs 2b/2c). Refactor to plain props:

| Component              | Before                                                     | After                                  |
| ---------------------- | ---------------------------------------------------------- | -------------------------------------- |
| PopoverMenu            | `options: Accessor<T[]>`, `selectedOption: Accessor<T>`    | `options: T[]`, `selectedOption: T`    |
| SpaceSidebarWidget     | `name: Accessor<string>`, `description?: Accessor<string>` | `name: string`, `description?: string` |
| CreateSpaceModalWidget | `adamClient: Accessor<Ad4mClient \| undefined>`            | `adamClient: Ad4mClient \| undefined`  |

**Component changes:** Remove `Accessor<T>` wrappers from prop types, remove `props.foo()` call syntax → use `props.foo` directly. Solid's prop getters preserve reactivity without explicit accessors.

**Call site changes:** Direct JSX callers (e.g. `AppSettings.tsx`) change from `options={templateOptions}` (passing accessor) to `options={templateOptions()}` (unwrapping at call site — Solid compiler wraps in getter).

**SchemaRenderer simplification:** Remove the `REACTIVE_ACCESSOR` passthrough branch for Solid components. The prop resolution becomes:

```typescript
// Before: three branches
if (typeof resolved === 'function' && REACTIVE_ACCESSOR in resolved) {
  if (isWebComponent) return deepUnwrap(resolved());
  return resolved; // pass accessor through
}
return deepUnwrap(resolved);

// After: one branch
return deepUnwrap(resolved); // always unwrap
```

`deepUnwrap` stays (still needed for nested accessor unwrapping). The `isWebComponent` check in prop resolution is removed.

### 1. Create `*.types.ts` for all components

Extract prop interfaces from `.solid.tsx` files into co-located `*.types.ts` files.

**Rules:**

- Framework-agnostic — no `Accessor<T>`, `Signal<T>`, `JSX.Element`
- Plain TypeScript interfaces — `export interface FooProps { ... }`
- Supporting types (option shapes, menu item types, sidebar items) move too
- Each `.solid.tsx` imports from its `.types.ts`

**Example:**

```
CircleButton/
├── CircleButton.types.ts       # framework-agnostic props
└── CircleButton.solid.tsx      # imports from .types.ts
```

For components that use Solid-specific types in their props (e.g. `JSX.Element` for children), the shared type uses a framework-agnostic equivalent (e.g. `unknown`) and the Solid impl adapts.

### 2. Add `@ai` JSDoc

Only for components with non-obvious contracts:

| Component          | Why                                                          |
| ------------------ | ------------------------------------------------------------ |
| PopoverMenu        | Complex option shape `{ id, name, icon }[]`                  |
| PopoverToggleMenu  | Multiple related types (MenuItemBase, entries, groups)       |
| CollapsibleSidebar | Nested types (AvatarProps, SidebarNavItem, SidebarGroup)     |
| CesiumGlobe        | Not schema-renderable                                        |
| GraphWidget        | Complex config types (layout, interaction, node/edge styles) |

Simple components (CircleButton, RerenderLog, SpaceSidebarWidget, etc.) skip `@ai` — name + props are self-describing.

### 3. Move `solid/` → `frameworks/solid/`

Applies to four packages, establishing a consistent monorepo convention.

**Single-package pattern** (4-components, 5-widgets) — move barrel within `src/`:

```
src/
├── frameworks/
│   └── solid/
│       └── index.ts
├── components/    (or widgets/)
└── styles/
```

Update tsup entry points (internal source paths only — public export paths like `./solid` stay the same). In 4-components, `solid-elements.d.ts` moves with the barrel.

**Sub-package pattern** (block-system, schema-system) — move sub-package directory:

```
# Before                          # After
block-system/                     block-system/
├── solid/   → @we/block-solid    ├── frameworks/
└── shared/  → @we/block-shared   │   └── solid/   → @we/block-solid
                                  └── shared/      → @we/block-shared
```

Update `pnpm-workspace.yaml` glob patterns. Package names and public imports stay the same.

---

## Scope — Full File List

### 4-components (8 components)

**Create** `*.types.ts`:

- `src/components/buttons/CircleButton/CircleButton.types.ts`
- `src/components/buttons/IconLabelButton/IconLabelButton.types.ts`
- `src/components/cards/PostCard/PostCard.types.ts`
- `src/components/layout/Column/Column.types.ts`
- `src/components/layout/Row/Row.types.ts`
- `src/components/menus/PopoverMenu/PopoverMenu.types.ts` — add `@ai`
- `src/components/menus/PopoverToggleMenu/PopoverToggleMenu.types.ts` — add `@ai`
- `src/components/testing/RerenderLog/RerenderLog.types.ts`

**Edit** `.solid.tsx` (remove inline interfaces, add import from `.types.ts`):

- All 8 component files above

**Move** `src/solid/` → `src/frameworks/solid/`:

- `index.ts` — update relative import paths
- `solid-elements.d.ts`

**Edit** `tsup.config.ts` — update entry path
**No change** to `package.json` exports (public paths stay `./solid`, `./styles`)

### 5-widgets (5 widgets)

**Create** `*.types.ts`:

- `src/widgets/cesium/CesiumGlobe/CesiumGlobe.types.ts` — add `@ai`, merge with existing `types.ts`
- `src/widgets/graph/GraphWidget/GraphWidget.types.ts` — add `@ai`, merge with existing `types.ts`
- `src/widgets/modals/CreateSpaceModalWidget/CreateSpaceModalWidget.types.ts`
- `src/widgets/sidebars/CollapsibleSidebar/CollapsibleSidebar.types.ts` — add `@ai`
- `src/widgets/sidebars/SpaceSidebarWidget/SpaceSidebarWidget.types.ts`

**Edit** `.solid.tsx` (remove inline interfaces, add import from `.types.ts`):

- All 5 widget files above

**Rename/merge** existing `types.ts` files:

- `CesiumGlobe/types.ts` → merge into `CesiumGlobe.types.ts` (add CesiumGlobeProps)
- `GraphWidget/types.ts` → merge into `GraphWidget.types.ts` (add GraphWidgetProps)

**Move** `src/solid/` → `src/frameworks/solid/`:

- `index.ts` — update relative import paths

**Edit** `tsup.config.ts` — update entry path
**No change** to `package.json` exports

### block-system

**Move** `block-system/solid/` → `block-system/frameworks/solid/`:

- Entire sub-package moves (package.json, src/, tsup.config.ts, etc.)
- Package name `@we/block-solid` stays the same

**Edit** `pnpm-workspace.yaml` — update glob pattern

### schema-system

**Move** `schema-system/solid/` → `schema-system/frameworks/solid/`:

- Entire sub-package moves (package.json, src/, tsup.config.ts, etc.)
- Package name `@we/schema-solid` stays the same

**Edit** `pnpm-workspace.yaml` — update glob pattern

---

## Decisions

| Decision                                       | Choice                             | Rationale                                                                  |
| ---------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| Children type in shared props                  | `unknown`                          | Framework-agnostic; Solid impl casts as needed                             |
| Callback types                                 | Plain functions `(arg: T) => void` | Already framework-agnostic                                                 |
| Existing `types.ts` (CesiumGlobe, GraphWidget) | Rename to `*.types.ts`, add Props  | Consistent naming convention; keeps domain types + props together          |
| Styles directory                               | Keep as-is                         | Correct pattern for co-located SCSS with barrel aggregation                |
| `frameworks/` convention                       | Match app-framework                | Consistent monorepo convention for future multi-framework support          |
| Sub-package `frameworks/`                      | Group framework sub-packages       | Prevents flat root clutter as frameworks are added                         |
| Barrel export paths (package.json)             | No change                          | `./solid` stays — only internal source paths change                        |
| Accessor props                                 | Refactor to plain                  | Per-prop memo system (PR 2b) handles reactivity; accessors are legacy      |
| SchemaRenderer passthrough                     | Remove                             | No Solid components need accessors; simplifies prop resolution to one path |

---

## Out of Scope

- Creating `@we/ai-context` package (PR 8)
- Primitives types extraction (handled via CEM, different mechanism)
- New component creation (PR 10)
- Any runtime/behavioural changes beyond the accessor → plain props refactor

---

## Checklist

- [x] Refactor PopoverMenu to plain props + update call sites
- [x] Refactor SpaceSidebarWidget to plain props + update call sites
- [x] Refactor CreateSpaceModalWidget to plain props + update call sites
- [x] Simplify SchemaRenderer (remove accessor passthrough branch)
- [x] Create `*.types.ts` for all 13 components/widgets
- [x] Add `@ai` JSDoc to 5 non-obvious components
- [x] Update all `.solid.tsx` to import from `.types.ts`
- [x] Move `solid/` → `frameworks/solid/` in 4-components
- [x] Move `solid/` → `frameworks/solid/` in 5-widgets
- [x] Move `solid/` → `frameworks/solid/` in block-system
- [x] Move `solid/` → `frameworks/solid/` in schema-system
- [x] Update `pnpm-workspace.yaml` glob patterns
- [x] Update tsup entry points
- [x] Update barrel import paths in `frameworks/solid/index.ts`
- [x] Verify existing re-exports from `5-widgets/solid/index.ts` still re-export domain types
- [x] Type-check passes
- [x] Existing tests pass (19/19 schema-system tests)
