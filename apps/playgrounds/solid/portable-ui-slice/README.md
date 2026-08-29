# Portable UI slice — WE over a non-AD4M backend

The browser proof that WE's **renderer + design system paint over an arbitrary backend** with zero
AD4M — and the seed of an "adopt in an afternoon" starter. In miniature, this is what a
`mountWe(...)` integration does: pick a **dataSource** (here in-memory), a **registry** (the design
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
  `{ id }`, `$getEntity(name)` → `{ query, findAll }`).
- Verified objectively: `pnpm why @coasys/ad4m` in this package resolves to **nothing**, and the
  built bundle contains no `@coasys` / `PerspectiveProxy` (only the renderer's inert `adamStore`
  fallback string, never executed here).

## The editing surface

`@we/editor` mounts here too, over the same in-memory backend — the proof that it reaches its
application only through ports:

```ts
const editor = createStandaloneEditorHost(feedTemplate);
mountTemplateEditor(el, { host: editor.host });
```

`standaloneEditorHost.ts` is a complete `EditorHost` built from plain signals and one array. No WE
shell, no stores, no perspective. It is also the honest answer to "what would adopting this cost?" —
that file is the whole integration for an application that already has templates of its own.

Verified the same way as the renderer: `pnpm why @coasys/ad4m` in this package resolves to nothing,
and the built bundle's only `@coasys` / `PerspectiveProxy` occurrences are **string literals inside
generated component metadata** (type names in the docs data), never an import.

The surface currently positions against the viewport rather than the element it is mounted into —
inherited from having only ever run inside WE's shell. Fine for a full-screen editing mode; making it
container-relative is the next step for editing inside a panel.

## Files

| File                          | Role                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `src/inMemoryBackend.ts`      | the non-AD4M `DataSource` (query engine over plain arrays)                               |
| `src/registry.ts`             | design-system component registry (`Column`/`Row`/`Card`; `we-*` are custom-element tags) |
| `src/feedTemplate.ts`         | a real WE template: `$each` over `$query` with filter/order/include                      |
| `src/standaloneEditorHost.ts` | a complete `EditorHost` from plain signals — the embedding proof                         |
| `src/main.tsx`                | mounts `RenderSchema({ node, stores, registry })` + the reactivity demo button           |

> Duplicated `inMemoryBackend.ts` (twin of the headless test's copy) is a candidate to consolidate
> into a shared `@we/backend-inmemory` package.
