## Summary

<!-- The problem being solved and the high-level approach, 1–2 paragraphs. -->

## Changes

<!-- One entry per file or logical group — the *why*, not the what. -->

## Docs kept in sync

<!-- The stale-docs failure mode here is silence: docs rot because nothing forces the update. -->

- [ ] Store surface changed → `ai-context/src/fragments/stores.ts` updated and context regenerated (`pnpm --filter @we/ai-context generate-context`; CI diffs the outputs)
- [ ] Architecture/layering changed → `docs/architecture/codebase-map.md` (and its sync partner `ai-context/src/fragments/architecture.ts`)
- [ ] Seed shape changed → `packages/app-shell/src/types/seed.ts` comments + `docs/getting-started/seed-system.md` + `seed-examples/`
- [ ] A package's public surface changed → that package's README/CONVENTIONS
- [ ] N/A — no doc-bearing surface touched

## Test plan

<!-- What was actually verified — not a hypothetical list. -->
