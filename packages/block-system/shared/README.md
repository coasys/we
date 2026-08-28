# @we/block-shared

The block system's contract package: block content types, the registry, and
the serialization pipeline between a composition and AD4M block models.

## What belongs here

- `content.ts` / `marks.ts` — the content model: `ContentBlock`, standoff
  marks, and the Portable Text projection both sides speak.
- `types.ts` — the composer/renderer prop contracts.
- `registry.ts` — node-type → { model class, display/input component }
  registrations; framework packages add their components via
  `updateBlockRegistration`.
- `serialization.ts` — the persistence pipeline: `createBlocks`,
  `reconcileBlocks` (id-claiming, duplicate detection, orphan deletion —
  tested in `tests/serialization.test.ts`), `loadBlocks`, `deleteBlocks`,
  `resolveExpressionAddresses`, and the text-content extraction that feeds
  the search index.
- `core-blocks.ts` — the built-in block registrations.

## What does not

- Anything framework-shaped — editor schemas, Solid components, plugins
  live in `../frameworks/solid` (`@we/block-solid`).
- Anything backend-shaped beyond the `PerspectiveProxy` surface the
  serialization functions take as a parameter.

Tests: `pnpm --filter @we/block-shared test`.
