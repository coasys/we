<!-- How to fill this in: docs/contributing/pull-requests.md -->

<!--
Needs an unpublished ad4m change? Delete the two lines that comment out the block below, and set
the number — or write coasys/ad4m@<branch> for a branch, tag or commit. The preview then builds
against it, and a check typechecks and tests this PR there. Anything but this exact block, first in
the description, is an error. Remove it once the pin is bumped, before merging.
See docs/contributing/ad4m-and-deploys.md.
-->
<!--
> [!IMPORTANT]
> ### Paired with: coasys/ad4m#1187
-->

## What

<!-- What merging this changes, in a few bullets. -->

## Why

<!-- The problem, and why this is the right fix. Link the issue or earlier PR. -->

## How

<!-- Where a reviewer should start, and the route through the change. A table of files helps when it is wide. -->

## Docs kept in sync

<!-- The stale-docs failure mode here is silence: docs rot because nothing forces the update. -->

- [ ] Store surface changed → `ai-context/src/fragments/stores.ts` updated and context regenerated (`pnpm --filter @we/ai-context generate-context`; CI diffs the outputs)
- [ ] Architecture/layering changed → `docs/architecture/codebase-map.md` (and its sync partner `ai-context/src/fragments/architecture.ts`)
- [ ] Seed shape changed → `packages/app-shell/src/types/seed.ts` comments + `docs/getting-started/seed-system.md` + `seed-examples/`
- [ ] A package's public surface changed → that package's README/CONVENTIONS
- [ ] N/A — no doc-bearing surface touched

## Test plan

<!-- What was actually verified, ticked. What was not, unticked, with the reason. -->
