# @we/block-shared

The block system's contract package: block content types, the registry, and
the serialization pipeline between Lexical editor state and AD4M block models.

## What belongs here

- `types.ts` — `SerializedBlockNode` (the intermediate format both sides
  speak) and the composer/renderer prop contracts.
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

- Anything framework-shaped — Lexical node classes, Solid components, plugins
  live in `../frameworks/solid` (`@we/block-solid`).
- Anything backend-shaped beyond the `PerspectiveProxy` surface the
  serialization functions take as a parameter.

Tests: `pnpm --filter @we/block-shared test`.
