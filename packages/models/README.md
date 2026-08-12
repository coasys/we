# @we/models

WE's domain models — Space, the block models (TextBlock, ImageBlock,
CollectionBlock, …), Signal/SignalType, Template, Theme, AgentSettings —
declared as AD4M (SDNA/SHACL-typed) classes, plus the registry that resolves
a model name to a class at runtime.

Two entry points, one registry: the root exports entity stand-ins that *read*
the registry; `/classes` holds the AD4M implementations a backend adapter
*registers*. The registry hangs off `globalThis` so a bundler emitting the
two entries as separate chunks cannot split it (see `src/modelRegistry.ts`
and `tests/modelRegistry.test.ts` for the precedence rules).

`src/generated/coreManifest.ts` is the neutral model manifest generated from
these classes (`pnpm --filter @we/models generate:manifest`) — what the
in-memory backend compiles into row-backed entities and the schema validator
reads. Regenerate it when a model changes; CI diffs it.

**Before adding or changing a model, read [`CONVENTIONS.md`](./CONVENTIONS.md)**
— entities vs blocks, predicate naming, `@Flag`, WeNode, and the
`Model.create()` pattern.

Tests: `pnpm --filter @we/models test`.
