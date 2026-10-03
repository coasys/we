# Pull requests

How a WE pull request is described, reviewed and merged. The template in
`.github/pull_request_template.md` follows this page.

## Size

One PR per coherent change. A feature and the fixes it needed along the way belong together; split
only when a part stands on its own, such as a refactor others are waiting on, or a change that has to
merge before something in another repository.

Bumping the ad4m pin is always a PR of its own ([ad4m and deploys](./ad4m-and-deploys.md)), so a
breakage points at one cause.

## Title

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): description`.

- **The type is lowercase**: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `ci`, `chore`.
  That is the spec, and what the bots already write.
- **The scope is optional**: the package or area, as in `fix(backend-ad4m)` or `ci(netlify)`.
- **The description names the change and stops**: lowercase, imperative, no full stop, and short
  enough that the title fits in the PR list, which cuts it off at about 70 characters — aim for
  under 60. The why belongs in the description, not the title.

`fix(backend-ad4m): drop the removed subscribe argument` · `feat(board): agree on moves with flows`
· `ci: pair PRs with an ad4m alert block`. A release is `Release v<version>`.

## Description

Four parts, in this order.

**What.** What the PR changes, in a few bullets. Someone who reads only this should know what merging
it does.

**Why.** The problem, and why this is the right fix for it. Link the issue, the earlier PR or the
conversation it came from. If there was a tempting alternative, say why it was not taken.

**How.** Where a reviewer should start, and the route through the change: "the new rule is in
`netlify-build.sh`; everything else follows from it". A table of files and what changed in each
helps when the change is wide. Explain the reason for a change the diff does not make obvious.

**Test plan.** What you actually ran or checked, as ticked boxes, and what you did not, as unticked
ones with the reason. "Not run on Netlify" is useful to a reviewer; a list of things that could be
tested is not.

**Docs kept in sync**, when it applies. The template's checklist names the documents that go stale
silently. Tick what you updated, or say none applied.

Write for the reviewer who has not followed the work. Plain sentences, no shorthand from the
conversation the PR came out of.

## Pairing with an ad4m change

When a WE change needs an ad4m change that has not been published yet, start the description with
exactly this block, naming an ad4m pull request:

```markdown
> [!IMPORTANT]
>
> ### Paired with: coasys/ad4m#1187
```

or `coasys/ad4m@dev` for an ad4m branch, tag or commit. The PR template carries it, commented out.

The preview then builds both `@coasys/ad4m` and `@coasys/ad4m-connect` from that change instead of
installing the pin. Both live in the `coasys/ad4m` repository, so one pairing covers both. The
required checks still build against the pin, so they stay red until it moves; the
`AD4M compatibility / Against the paired ad4m` check builds the same commit against the pairing and
says whether that red is only the pin. It keeps a comment and a `paired with ad4m` label on the PR
saying so, so a reviewer does not have to open the checks to find out.

One exact form, so every paired PR looks the same. Anything close — no colon, another heading level
or alert, the old `ad4m: coasys/ad4m#N` line, the block lower down — fails the preview and the
paired check rather than being ignored, and the PR gets a comment with the corrected block to paste.
A mention of an ad4m PR elsewhere in the description is not a pairing.

Remove the block before merging, once the pin has been bumped to a version that contains the change.
See [ad4m and deploys](./ad4m-and-deploys.md).

## Stacked PRs

When a PR builds on another that has not merged, base it on that branch and say so at the top: "Stacked
on #224. Review only the last commit." Merge the stack from the bottom, retargeting each PR at `dev`
as the one below it merges.

## Merging

| Merge with         | When                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| **Squash**         | The commits are one change plus review churn: fix-ups, a test added and then removed              |
| **A merge commit** | The commits are separate steps worth reading on their own, a stack, or a release (`dev` → `main`) |

Push merges from a terminal. An editor's "Sync" button that pulls with rebase flattens a merge commit
into its individual commits.

## Local PR notes

Drafts of a PR description can be kept as `PR_<NAME>.md` at the repository root while you work. They
are ignored by git and never committed; paste the finished text into the PR, or pass the file to
`gh pr create --body-file`. Keep the title out of the file and give it to `--title`: a heading above
the sections would sit above a pairing block, which has to come first.
