# Plans

Working notes for maintainers: designs for work that is upcoming, in progress, or was considered and
parked. **Nothing here is a description of the codebase.**

## Every plan carries a Status line

Directly under the title, before anything else:

```markdown
# Plan: Polymorphic @HasMany for Ad4mModel

> **Status (Aug 2026): not started upstream, and now has a second motivating case.** Nothing in
> `ad4m/core/src/model` mentions `polymorphic`, and no PR — open, merged or closed — implements it.
```

Dated, and specific about what was checked. `ad4m/polymorphic-has-many.md` is the model to copy.

Four states, and the useful ones are the middle two:

- **Shipped** — name where it landed, and say if only part of it did. A plan half-implemented is the
  most dangerous kind, because the half that exists makes the other half look like it does too.
- **In progress** — name the branch.
- **Not started** — say what you checked to establish that, and when.
- **Superseded / abandoned** — move it to [`../old/`](../old/) and say what replaced it.

## Why this is a rule rather than a courtesy

A planning document describes an API in the present tense, because that is how you write a design.
Read six months later by somebody — or something — that arrived by grep, it is indistinguishable
from documentation of an API that exists.

That is not hypothetical. `module-development-guide.md` sat here for months describing
`defineModule`, a module registry and a publishing flow, none of which were ever built. It carried a
"NOT YET IMPLEMENTED" banner and was still the first thing anybody looking for how to write a module
would find. It has been moved to [`../old/`](../old/module-development-guide.md), because a banner is
not protection: a grep hit lands mid-file, well past it.

The real answer for a module is the contract itself
(`packages/module-system/shared/src/module.ts`), and for any other surface it is
[`docs/contributing/surfaces.md`](../../contributing/surfaces.md).

## Currently unmarked

These carry no status line yet. Treat every one as **unverified** until it does — several describe
work that has since landed, in whole or in part, and one is on an open branch.

| Document                                              | Note                                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prs/QUERY-AGGREGATE-ORDER.md`                        | Partly landed — the query IR has `count`/`sum`/`min`/`max`/`avg` and dotted `relation.property` ordering, but only `count: true` is exposed through the model `include` surface |
| `prs/AI_PROVIDER_AGNOSTIC_PLAN.md`                    | Work exists on `origin/feat/ai-multi-provider`                                                                                                                                  |
| `prs/RELATION-WHERE-FILTERS.md`                       | Check against the where-clause compiler in `backend-system/ad4m`                                                                                                                |
| `prs/model-query-path-unification.md`                 |                                                                                                                                                                                 |
| `prs/INLINE-RELATION-CREATE.md`                       |                                                                                                                                                                                 |
| `prs/AI_SCOPED_SEGMENTS_PLAN.md`                      | Self-described as a future optimization                                                                                                                                         |
| `prs/COMPONENT_EXPLORER_AND_FRAGMENT_PALETTE_PLAN.md` |                                                                                                                                                                                 |
| `ad4m/executor-graceful-shutdown.md`                  | Upstream — verify in the ad4m repo, not this one                                                                                                                                |
| `ad4m/ad4m-model-conformance-and-deletion.md`         | Upstream                                                                                                                                                                        |
| `ad4m/removeLinks-typename-bug.md`                    | Upstream                                                                                                                                                                        |
| `module-marketplace.md`                               | Design only. Predates most of the surfaces it would need to cover — it names four types where `docs/contributing/surfaces.md` lists eighteen                                    |
| `SCHEMA_SYSTEM_REFACTOR.md`                           |                                                                                                                                                                                 |
| `VISUAL_EDITOR_INTERACTIONS.md`                       |                                                                                                                                                                                 |
| `overviews/deferred.md`                               |                                                                                                                                                                                 |
| `overviews/mobile-strategy.md`                        | See also `notes/we/August-2026/mobile-plan.md`                                                                                                                                  |
| `overviews/service-integration.md`                    |                                                                                                                                                                                 |
| `overviews/custom-components-and-dependencies.md`     |                                                                                                                                                                                 |
| `overviews/currency/*.md`                             | Two documents, both exploratory                                                                                                                                                 |

The notes are what could be established from _this_ repository. Anything marked upstream needs the
ad4m checkout to answer, and the blanks need somebody who knows. **Add the status line when you
find out, and delete the row** — this table is a to-do list, not a second index.
