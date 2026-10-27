<!-- How to fill this in: docs/contributing/pull-requests.md -->

<!--
Needs an unmerged ad4m change? Pin its snapshot with `pnpm bump:ad4m '#<ad4m PR>'` — nothing goes
in this description. The PR cannot merge until that change is on ad4m dev.
See docs/contributing/ad4m-and-deploys.md.
-->

<!--
Based on another PR's branch rather than dev? Uncomment the block below and set that PR's number.
It goes first. A check fails while it disagrees with the base branch. The title's "(stacked on #N)"
is added for you. See docs/contributing/pull-requests.md.
-->
<!--
> [!IMPORTANT]
> ### Stacked on: #312
>
> Review only the last commit.
-->

## What

<!-- What merging this changes, in a few bullets. -->

## Why

<!-- The problem, and why this is the right fix. Link the issue or earlier PR. -->

## How

<!-- Where a reviewer should start, and the route through the change. A table of files helps when it is wide. -->

## Docs kept in sync

<!-- The stale-docs failure mode here is silence: docs rot because nothing forces the update. -->

<!-- A box is a thing that must be true before this merges. The list below is a prompt, not a task
     list, so it is bullets — see docs/contributing/pull-requests.md. -->

- [ ] The docs this change touches are updated, or none applied

- Store surface changed → `ai-context/src/fragments/stores.ts` updated and context regenerated (`pnpm --filter @we/ai-context generate-context`; CI diffs the outputs)
- Architecture/layering changed → `docs/architecture/codebase-map.md` (and its sync partner `ai-context/src/fragments/architecture.ts`)
- Seed shape changed → `packages/app-shell/src/types/seed.ts` comments + `docs/getting-started/seed-system.md` + `seed-examples/`
- A package's public surface changed → that package's README/CONVENTIONS
- Settled something every later change has to respect → a record in `docs/architecture/decisions/` (its README has the bar)

## Test plan

<!-- What was actually verified, ticked. What is still to do, unticked — those block the merge.
     What was decided against is a bullet beginning **Deferred —**, with the reason. -->
