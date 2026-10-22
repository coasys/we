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
· `ci: pin ad4m by commit`. A release is `Release v<version>`.

## Description

Four parts, in this order, and the first thing in the body is **What** — no heading above it.
GitHub prints the title immediately over the description, so a title repeated as an `# H1` is the
same sentence twice in the two places a reader looks. It also breaks stacking: the alert block
below has to be the first thing in the body, and a heading above it fails the check.
`.github/pull_request_template.md` is the shape, and a description drafted elsewhere —
in a file passed to `gh pr create --body-file`, say — matches it.

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

**A checkbox is a thing that must be true before this merges, and nothing else is a checkbox.**
Anything that will never be ticked is a bullet.

- `- [x]` — done, and what it showed.
- `- [ ]` — **not done, and the PR is not finished.** Merging over one is merging over a gap
  somebody meant to close.
- `- **Deferred — …**` — a bullet, not a box: decided against, with the reason and where it goes
  instead. A judgement on the record, which a reviewer can disagree with. _"Needs qwen3:4b pulled,
  and `full` cannot run on it at all — belongs with the work that uses the answer."_

This is why the rule is worth keeping: GitHub counts every checkbox in a description and shows
"6 of 7 tasks" on the PR. If some boxes are never meant to be ticked, that number is wrong on every
PR, and a number that is always wrong trains everybody to ignore it — including the real gap. Keep
boxes for what must be true and the count means something, our own check is a one-line rule, and
the two can never disagree.

**Docs kept in sync**, when it applies. One checkbox — the docs this change touches are updated,
or none applied — over a bulleted list of the places that go stale silently. One box because one
thing has to be true before merge: that somebody looked. The list is a prompt, and a prompt is not
a task, so it does not get boxes that nobody will ever tick.

Write for the reviewer who has not followed the work. Plain sentences, no shorthand from the
conversation the PR came out of.

## A WE change that needs an ad4m change

Pin the ad4m pull request's snapshot on the WE branch, and push:

```sh
pnpm bump:ad4m '#1187'
```

Nothing goes in the description. The preview, CI and the live tests then all run against that ad4m
change, and the required check **`PR tasks / Not waiting on ad4m`** holds the PR until the change is
on ad4m `dev`, labelled `waiting on ad4m` in the meantime. When the ad4m PR merges, the check re-runs by itself within the hour, or a comment
says what to run. See [ad4m and deploys](./ad4m-and-deploys.md).

## Stacked PRs

When a PR builds on another that has not merged, base it on that branch and start the description with
this block, naming the PR whose branch it is:

```markdown
> [!IMPORTANT]
>
> ### Stacked on: #<N>
>
> Review only the last commit.
```

The line under the heading is yours: say what a reviewer of this PR should and should not read, or
where it merges if that is not `dev`. The PR template carries the block, commented out.

GitHub shows a PR's base branch on its own page, as a branch name, and nowhere in the list. So the
`PR stacking` workflow labels every PR based on anything but `dev` or `main` as `stacked`, which the
list shows beside the title, and checks the block against the base. **`PR stacking / Stacked on the PR
it names`** fails when a stacked PR has no block, when the block names a PR whose branch is not the
base, when that PR has merged or closed, and when a PR that now targets `dev` still has one. It says
which and gives the block to paste. Editing the description, or retargeting the PR, re-runs it.

One of those it fixes itself: when the PR below merges and this one is retargeted at `dev`, the check
takes the block off the top of the description and passes. Everything else in the description is
left as written. A PR from a fork cannot be edited by the check, so there the block is removed by
hand.

Merge the stack from the bottom. When the PR below merges and its branch is deleted, GitHub retargets
the next one at `dev`, and the label and the block go by themselves.

## Merging

| Merge with         | When                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| **Squash**         | The commits are one change plus review churn: fix-ups, a test added and then removed              |
| **A merge commit** | The commits are separate steps worth reading on their own, a stack, or a release (`dev` → `main`) |

Push merges from a terminal. An editor's "Sync" button that pulls with rebase flattens a merge commit
into its individual commits.

## Drafts

A draft of a PR description — or of an issue, or a review reply — is not part of the repo. Keep it
outside the repo, wherever you keep notes, and pass it to `gh pr create --body-file`; never commit it.
Nothing in `.gitignore` catches one, whatever it is called. Keep the title out of the draft and give it
to `--title`: a heading above the sections would sit above a stacking block, which has to come first.

## Decisions

When a change settles something every later change has to respect, the same PR adds a record to
[`docs/architecture/decisions/`](../architecture/decisions/README.md). That folder's README has the
bar for what qualifies and the format; most PRs make no such decision.
