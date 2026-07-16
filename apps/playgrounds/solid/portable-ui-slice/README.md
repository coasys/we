# Portable UI slice — WE over a non-AD4M backend

The browser proof that WE's **renderer + design system paint over an arbitrary backend** with zero
AD4M. Phase 0's browser step and the seed of the Phase 4 "L0/L1 starter". In miniature, this is what
a `mountWe(...)` integration does: pick a **dataSource** (here in-memory), a **registry** (the design
system), and a **template**.

## Run

```sh
pnpm --filter @we/playground-portable-slice dev
# open http://localhost:3200
```

## What you should see

A styled "Community Feed" (real `Card`/`Column`/`Row` + `we-text`/`we-avatar`):

- **Two posts** — "Graph theory" (by Ada) and "Cooking" (by Bo). The filter (`title`/`content`
  contains "graph") excludes "Weather"; `order: createdAt desc` puts Graph theory first; the author
  avatar/name come from the `include: { author: true }` relation.
- The **"+ Add graph post"** button (top-right) mutates the in-memory backend; the live subscription
  re-renders and the new post appears **at the top** — reactivity end-to-end, no AD4M.

## Why it matters

- The renderer package (`@we/schema-solid`) never imports AD4M; here it runs against
  `src/inMemoryBackend.ts`, which implements the injected `stores` contract (`$currentDataset()` →
  `{ id }`, `$getModel(name)` → `{ query, findAll }`).
- Verified objectively: `pnpm why @coasys/ad4m` in this package resolves to **nothing**, and the
  built bundle contains no `@coasys` / `PerspectiveProxy` (only the renderer's inert `adamStore`
  fallback string, never executed here).

## Files

| File | Role |
|---|---|
| `src/inMemoryBackend.ts` | the non-AD4M `DataSource` (query engine over plain arrays) |
| `src/registry.ts` | design-system component registry (`Column`/`Row`/`Card`; `we-*` are custom-element tags) |
| `src/feedTemplate.ts` | a real WE template: `$each` over `$query` with filter/order/include |
| `src/main.tsx` | mounts `RenderSchema({ node, stores, registry })` + the reactivity demo button |

> Duplicated `inMemoryBackend.ts` (twin of the headless test's copy) will consolidate into a shared
> `@we/backend-inmemory` package in Phase 4.
