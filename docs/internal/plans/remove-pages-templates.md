# Plan: Remove 6-pages and 7-templates Packages

## Motivation

The design system's atomic layering should stop at widgets (L5). Everything above — pages and templates — is **composition**, which is exactly what the schema system handles declaratively.

Current state:
- **6-pages** contains 5 components, 2 of which aren't even registered (PostPage, BlockComposerPage). The registered ones (HomePage, PageNotFound, SpacePage) are either trivial placeholders or simple slot containers.
- **7-templates** contains 2 components (DefaultTemplate, CenteredTemplate) that are pure layout shells — Row/Column arrangements with named slots. CenteredTemplate is dead code (registered but never used in any schema).
- **3 of 6 template schemas already prove the pattern** — TwitterTemplate, BaseTemplate, and weNativeApp all compose layouts purely from Row/Column/components with no compiled page or template components. DefaultTemplate and TestTemplate are the only schemas that reference compiled components.

Both packages exist as compiled `.tsx` implementations of what the schema system already represents elsewhere as declarative JSON. No new schema features are needed.

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

| File | What it imports |
|------|---------|
| `componentRegistry.tsx` | `HomePage`, `PageNotFound`, `SpacePage` from `@we/pages/solid`; `DefaultTemplate`, `CenteredTemplate` from `@we/templates/solid` |
| `TemplateProvider.tsx` | `PageNotFound` from `@we/pages/solid` (hardcoded fallback route) |

Schema files reference these by string name:
- `DefaultTemplate.schema.ts` → `DefaultTemplate` (root type), `SpacePage` (route), `HomePage`/`PageNotFound` (routes)
- `TestTemplate.schema.ts` → same as DefaultTemplate
- `TwitterTemplate.schema.ts`, `BaseTemplate.schema.ts`, `weNativeApp.ts` → **no compiled page/template components** (already pure schema)

## Key Insight

The Twitter and weNative templates achieve the exact same layout patterns (sidebar + content + modals) that DefaultTemplate/SpacePage provide, but they do it purely with Row/Column and design system props — no compiled template component, no CSS classes. This is the pattern to follow.

The only thing the compiled components add over inline schema is **semantic HTML elements** (`<aside>`, `<header>`, `<main>`). The SchemaRenderer currently can't render native HTML elements — it only resolves types from the component registry. Adding native element support (~5 lines) solves this cleanly.

## Migration Strategy

### Step 1: Add native HTML element support to SchemaRenderer

The renderer currently throws on unknown types. Add a fallback: if `type` is a known HTML element (lowercase tag), render it as a native element instead of looking up the registry. This:
- Enables `{ type: 'aside', ... }` and `{ type: 'main', ... }` in schemas
- Future-proofs schemas for any HTML element (`nav`, `section`, `article`, `footer`)
- Lets AI-generated schemas use semantic HTML without registry bloat

### Step 2: Inline all page/template layouts in schema files

Replace compiled component references with their equivalent Row/Column + HTML element structures. Following the pattern already used by TwitterTemplate and weNativeApp:

**Trivial pages (no layout logic):**
- `HomePage` → inline `Column + we-text` node in route definitions
- `PageNotFound` → inline `Column + we-text` node in route definitions

**Layout pages:**
- `SpacePage` → inline Row layout with `aside` (sidebar) + Column (header + main) — uses design system props (`width`, `height`, `bg`) instead of CSS classes
- `DefaultTemplate` → inline Row layout with `aside` (sidebar) + Column (content area with header + main) + modals area

**Dead code:**
- `PostPage` → delete (unregistered, unused)
- `BlockComposerPage` → delete (unregistered, unused)
- `CenteredTemplate` → delete (registered but never used in any schema)

### Step 3: Update TemplateProvider fallback

Replace the hardcoded `import { PageNotFound } from '@we/pages/solid'` with an inline schema-rendered fallback using `RenderSchema`.

### Step 4: Move layout SCSS into app-framework

The SpacePage and DefaultTemplate SCSS defines sizing constraints (sidebar width, header height) via CSS variables and classes. Move these into `app-framework/` alongside the schema definitions that use them. Replace prop-expressible styles with design system props where possible to maintain consistency with how Twitter/weNative templates work.

### Step 5: Clean up componentRegistry and schemaContext

- Remove all page/template component imports and entries from `componentRegistry.tsx`
- Update `schemaContext.ts` (AI prompt context) to remove page/template component docs and add HTML element docs

### Step 6: Remove packages

1. Delete `packages/design-system/6-pages/`
2. Delete `packages/design-system/7-templates/`
3. Remove `@we/pages` and `@we/templates` from all `package.json` dependencies
4. Remove page/template style imports from `app-framework/src/frameworks/solid/index.ts`
5. Update `pnpm-workspace.yaml` if needed

### Step 7: Update docs

- Update docs/README.md and package-conventions.md to reflect L1–L5 boundary
- Update architecture docs to document the schema-system-as-composition-layer pattern

## Schema System Prerequisites

Only one small enhancement needed:

- [ ] **Native HTML element rendering** — SchemaRenderer fallback for lowercase tag names (renders as HTML elements instead of requiring registry entries)

No `$slot` directive needed — the slot *content* is already defined inline in schemas as TypeScript variables. When we inline the layout structure, contents go directly into the tree as `children`.

## Future Schema System Enhancements (not blocking this PR)

- **`$ref`/`$fragment` directive** — runtime reusable schema fragments for JSON-only schemas (seed files, AI-generated, localStorage). Currently, `.ts` schema files handle reuse via TypeScript variables at definition time. A runtime mechanism would enable fragment reuse in dynamic/non-TypeScript contexts.
- **Associated stylesheets** — declare CSS that must load when a schema node renders. Currently handled by global style imports.

## What Stays

- **L1–L5 packages** — tokens, themes, primitives, components, widgets (the design system)
- **Layout SCSS** — the CSS for layout structures still exists, moves into app-framework alongside schema definitions
- **Schema template definitions** — `DefaultTemplate.schema.ts` etc. stay in app-framework, updated to inline layouts

## Order of Operations

1. **Add HTML element support** to SchemaRenderer
2. **Inline DefaultTemplate layout** in DefaultTemplate.schema.ts and TestTemplate.schema.ts
3. **Inline SpacePage layout** where used as a route node
4. **Replace HomePage/PageNotFound** with inline schema nodes in routes
5. **Update TemplateProvider** — schema-driven fallback instead of imported component
6. **Move SCSS** into app-framework
7. **Clean up componentRegistry** — remove page/template entries
8. **Update schemaContext.ts** — remove page/template docs, add HTML element docs
9. **Delete 6-pages and 7-templates packages**
10. **Update docs** to reflect L1–L5 boundary
