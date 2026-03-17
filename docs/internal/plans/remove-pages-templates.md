# Plan: Remove 6-pages and 7-templates Packages

## Motivation

The design system's atomic layering should stop at widgets (L5). Everything above — pages and templates — is **composition**, which is exactly what the schema system handles declaratively.

Current state:
- **6-pages** contains 5 components, 2 of which aren't even registered (PostPage, BlockComposerPage). The registered ones (HomePage, PageNotFound, SpacePage) are either trivial placeholders or simple slot containers.
- **7-templates** contains 2 components (DefaultTemplate, CenteredTemplate) that are pure layout shells — Row/Column arrangements with named slots. This is what schemas already express.

Both packages exist as compiled `.tsx` implementations of what the schema system can represent as declarative JSON. The only thing schemas can't currently do is associate CSS with a named schema definition — but that's a solvable schema-system feature, not a reason to maintain two extra packages.

## Design System Layering (Post-Migration)

```
L1  tokens          — Design values (colors, spacing, radii)
L2  themes          — Token compositions (dark/light, brand variants)
L3  primitives      — Single HTML elements (Lit web components)
L4  components      — Small compositions (PostCard, Row, Column, buttons)
L5  widgets         — Complex stateful compositions (CesiumGlobe, GraphWidget, CollapsibleSidebar)
    ─── design system boundary ───
    Schema system handles everything above: page layouts, templates, routing, slot composition
```

## Current Consumers

All consumption flows through **app-framework** — it's the only direct consumer:

| File | Imports |
|------|---------|
| `app-framework/.../componentRegistry.tsx` | `HomePage`, `PageNotFound`, `SpacePage` from `@we/pages/solid`; `DefaultTemplate`, `CenteredTemplate` from `@we/templates/solid` |
| `app-framework/.../TemplateProvider.tsx` | `PageNotFound` from `@we/pages/solid` (fallback route) |

Schema files reference these by string name:
- `DefaultTemplate.schema.ts` → `PageNotFound`, `HomePage`, `SpacePage`, `DefaultTemplate`
- `TestTemplate.schema.ts` → `PageNotFound`, `HomePage`, `SpacePage`
- `TwitterTemplate.schema.ts` → route-based navigation

## Migration Strategy

### Phase 1: Express pages and templates as schema definitions

All page and template components are simple compositions that the schema system can express directly. Rather than moving them to another package, convert them to schema syntax and delete.

**Pages → schema routes:**

1. `HomePage` → inline schema node in route definitions:
   ```ts
   { path: '/', type: 'Column', props: { ax: 'center', bg: 'ui-0', p: '500' },
     children: [{ type: 'we-text', props: { size: '600' }, children: ['Home page!!!'] }]
   }
   ```
2. `PageNotFound` → same pattern, plus update `TemplateProvider.tsx` to render a schema node for fallback instead of importing a component
3. `SpacePage` → schema fragment with `$slot` directives for sidebar/header/children
4. `PostPage` → delete (unregistered, unused)
5. `BlockComposerPage` → delete (unregistered, unused)

**Templates → named schema fragments:**

6. Create schema definitions for DefaultTemplate and CenteredTemplate layouts:
   ```ts
   export const defaultTemplateLayout = {
     type: 'Row',
     props: { 'data-we-template': true },
     children: [
       { type: '$slot', name: 'sidebar', wrapper: { tag: 'aside', class: 'we-default-template-sidebar' } },
       { type: 'Column', props: { ax: 'center', bg: 'ui-50', class: 'we-default-template-content' },
         children: [
           { type: '$slot', name: 'header', wrapper: { tag: 'header', class: 'we-default-template-header' } },
           { type: '$slot', name: 'children', wrapper: { tag: 'main', class: 'we-default-template-pages' } },
         ]
       },
       { type: '$slot', name: 'modals' },
     ]
   };
   ```
7. Move template/page SCSS into `app-framework/` (associated with schema definitions)
8. Update existing template schemas to use inline layout instead of referencing component types
9. Remove page/template entries from `componentRegistry.tsx`
10. Remove `@we/pages` and `@we/templates` from all dependencies

### Phase 2: Remove packages

1. Delete `packages/design-system/6-pages/`
2. Delete `packages/design-system/7-templates/`
3. Update docs/README.md and package-conventions.md to reflect L1–L5 boundary
4. Update architecture docs to document the schema-system-as-composition-layer pattern

## Schema System Prerequisites

Phase 1 requires the schema system to support:

- [ ] **`$slot` directive** — named slot insertion points in schema fragments (needed for SpacePage, DefaultTemplate, CenteredTemplate)
- [ ] **Reusable schema fragments** — define a layout once, reference by name (template registry)
- [ ] **Associated stylesheets** — a way to declare CSS that must be loaded when a schema fragment is used
- [ ] **Schema-driven fallback route** — TemplateProvider.tsx currently imports PageNotFound as a hardcoded component; needs to render a schema node instead

Trivial pages (HomePage, PageNotFound) can be converted immediately since they're just `Column + text` — no slot support needed. SpacePage and templates require `$slot`.

## What Stays

- **L1–L5 packages** — tokens, themes, primitives, components, widgets (the design system)
- **Template SCSS** — the CSS for layout structures still exists, moves into app-framework alongside schema definitions
- **Schema template definitions** — `DefaultTemplate.schema.ts` etc. stay in app-framework, updated to use inline layout instead of referencing compiled components

## Order of Operations

1. **Build `$slot` support** in the schema system
2. **Convert trivial pages** (HomePage, PageNotFound) to inline schema nodes — no `$slot` needed
3. **Convert SpacePage and templates** to schema fragments using `$slot`
4. **Update TemplateProvider** to use schema-driven fallback instead of imported component
5. **Delete 6-pages and 7-templates packages**
6. **Update docs** to reflect L1–L5 boundary
