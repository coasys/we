# How WE builds against ad4m, and where it deploys

WE depends on two ad4m packages: `@coasys/ad4m` (the SDK) and `@coasys/ad4m-connect` (the connection
UI, which bundles its own copy of the SDK). This document explains which version of those packages
each WE build uses, where each build goes, and how a release is made.

## The problem this solves

ad4m changes often reached WE's shared sites weeks late. The pin only moved when somebody published
an ad4m version by hand and bumped WE to it, so cross-repo work waited on whoever did that.

We tried two answers. Building WE from ad4m `dev` gave fresh builds, but they could not be reproduced
and CI never tested them. Building from the pin gave tested builds, but they went stale. This setup
keeps the pin and makes it move often, so builds are both fresh and tested:

- **An ad4m change reaches the dev site soon after it merges**, through a bump PR.
- **Anyone on the team can open and merge a bump PR.** Nobody has to wait for one person.
- **Work across both repos** is tested together on a paired preview.

## The one rule

**Every WE build uses the ad4m version pinned in WE's `package.json`.** There is one exception: the
preview of a WE PR that pairs itself with an ad4m PR or branch.

The pin is a promise: "this WE was built and tested against this ad4m". Merging the PR that set it
is the confirmation.

## Where WE deploys

|                | Built from      | ad4m used                               | URL                                         | For                           |
| -------------- | --------------- | --------------------------------------- | ------------------------------------------- | ----------------------------- |
| **Preview**    | the PR's branch | the pin, or what the PR pairs with      | `deploy-preview-<N>--coasys-we.netlify.app` | reviewing a PR                |
| **Dev**        | `dev`           | the pin                                 | `dev--coasys-we.netlify.app`                | the team, and invited testers |
| **Production** | `main`          | the pin                                 | `coasys-we.netlify.app`                     | the public                    |
| **Desktop**    | a release tag   | the pin, and an executor built to match | GitHub releases                             | people running WE locally     |

Every web build writes `/build-info.json`: the WE version and branch, and which ad4m it was built
against. The page logs the same line to the console.

## Releasing

Merging `dev` into `main` is a release. There is no separate staging step.

1. On `dev`, set `version` in the root `package.json` and in each `apps/*/package.json` (while WE is
   pre-1.0: `0.1.0-alpha.1`, `0.1.0-alpha.2`, …).
2. Open a PR from `dev` to `main` titled `Release v<version>`, and merge it with a merge commit.
3. Tag the merge commit and push the tag:
   `git tag -a v<version> origin/main -m "WE <version>" && git push origin v<version>`.

The tag starts `.github/workflows/electron-package.yaml`. It checks that the tag matches
`package.json`, builds the ad4m executor from the commit the pinned `@coasys/ad4m` was published
from, packages the desktop app and publishes it as a GitHub release. The first build of an executor
takes about 45 minutes; later releases on the same pin reuse it. Desktop releases are Linux only
until the executor builds on macOS again.

## Pairing a WE PR with ad4m

Use this when a WE change needs an ad4m change that has not been published yet, so the pin cannot
point at it. The pairing is this block, first in the WE PR description:

```markdown
> [!IMPORTANT]
>
> ### Paired with: coasys/ad4m#<N>
```

| Step | What you do                                               | What happens                                                                                                 |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1    | Start the WE PR description with the pairing block, below | The preview builds both ad4m packages from that ad4m PR (its merge, once merged), and a check tests WE there |
| 2    | Review and test on the preview                            | You see the two halves working together                                                                      |
| 3    | Merge the ad4m PR first                                   | It is published under the `dev` tag (see below), and the WE PR is marked ready to bump                       |
| 4    | Run `pnpm bump:ad4m` in the WE PR, and remove the block   | CI now tests the real combination                                                                            |
| 5    | Merge the WE PR                                           | `dev` stays on a published, tested pin                                                                       |

**Until step 4 the required checks are red.** They test against the pin, which does not have the
ad4m change yet. Whether that is the only reason is answered by
**`AD4M compatibility / Against the paired ad4m`**, which builds the same commit against the paired
change, then typechecks, tests and validates its schemas. Both checks build the same WE commit, so
the ad4m version is the only difference between them:

| Required checks | Paired check | Meaning                                                                |
| --------------- | ------------ | ---------------------------------------------------------------------- |
| red             | green        | Waiting for the pin, not for a fix                                     |
| red             | red          | Something is broken — the paired check's summary names the stage       |
| green           | red          | Fine against today's ad4m, broken against the paired change: fix first |

A reviewer does not have to know any of this to read the PR. The paired check keeps **one comment**
on it, updated in place: that the check is running, then whether the PR works against the paired
change, stage by stage — and if the pairing cannot be read, why, with the corrected block to paste.
It also adds a **`paired with ad4m`** label, which the PR list shows beside the title. Both go away
on the first push after the block is removed. (GitHub has no
badge beside a PR's title or above its description, so those two are the nearest it offers. A PR
from a fork gets neither, since its workflow cannot write here; a failing required check still names
the paired check there.)

**When the ad4m change can be pinned, the PR says so.** Hourly, the bump workflow looks at every PR
labelled `paired with ad4m` whose pairing names an ad4m PR. Once that PR has merged and a version of
both `@coasys/ad4m` and `@coasys/ad4m-connect` is published from a commit containing the merge, the
WE PR gets a second label, **`ready to bump ad4m`**, beside the first, and a comment naming the
version and the steps: `pnpm bump:ad4m <version>`, remove the block, push. "Containing the merge"
rather than "newer than it": a version published from just before the merge would look ready and
not be. A pairing with a branch has no moment at which it is done, so it never gets this label.
Both labels and both comments go together when the block is removed. The rules are in
`scripts/ad4m-ready-to-bump.mjs`.

The paired check tests the ad4m PR as it is now. If it changes before it is published, step 4 is
where that shows: the required checks then test the real combination.

To pair with a branch, tag or commit instead, write `coasys/ad4m@<ref>` in the block, for example
`coasys/ad4m@dev`. Without a block, the preview uses the pin.

To try an ad4m change in WE with no WE change to go with it, open a draft WE PR with an empty commit
(`git commit --allow-empty`) and the block. Close it when you are done.

**The block goes first in the description, exactly as written** — `[!IMPORTANT]`, `###`, the colon.
First because it changes what every check on the PR means, so it is the first thing a reviewer
should read; exact so every paired PR looks the same. Blank lines, trailing spaces and HTML comments
above it do not count. The PR template carries the block, commented out.

Anything close is an error rather than ignored, because a near-miss read as "not paired" would look
paired to whoever wrote it and quietly use the pin: no colon, another heading level or alert, the
block lower down, two pairings, the old `ad4m: coasys/ad4m#N` line, or a pull request that cannot be
found. The preview fails, and the paired check fails with a comment on the PR that shows the
corrected block to paste. A mention of an ad4m PR anywhere else — in a sentence, a table or inline
code — is not a pairing.

Editing the block does not rebuild the preview or re-run the paired check. Push again, or use
"Retry deploy" in Netlify and re-run the `AD4M compatibility` workflow: both read the description as
it is now, so a re-run picks up the edit.

## An example, end to end

| When                                                     | What happens                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| You open an ad4m PR and a WE PR that needs it            | The WE PR description links the ad4m PR, and its preview runs both together |
| The ad4m PR merges                                       | ad4m CI publishes a new version under the `dev` tag                         |
| You run `pnpm bump:ad4m` in your WE PR                   | Both pins move to that version, and it prints the ad4m changes for the PR   |
| You run `pnpm verify:ad4m`, check the preview, and merge | The dev site has the ad4m change on its next deploy                         |

## Keeping the pin current

| Step | Who            | What                                                                                                  |
| ---- | -------------- | ----------------------------------------------------------------------------------------------------- |
| 1    | ad4m CI        | On every merge to ad4m `dev`, publish the npm packages at one new version, under the npm tag `dev`    |
| 2    | WE's bump bot  | Within the hour, open a PR moving the pin to that version, listing the ad4m changes since the old pin |
| 3    | CI and preview | Build and test WE against the new version                                                             |
| 4    | A person       | Run `pnpm verify:ad4m`, check the preview, and merge                                                  |

Step 1 is proposed in coasys/ad4m#1216. Until it merges, the versions WE pins are published by hand,
and anyone with npm publish rights can publish one under the `dev` tag, from one commit for all the
packages.

**The bump bot** is `.github/workflows/bump-ad4m.yaml`. Every hour it runs `pnpm bump:ad4m` from
`dev`, and when there is a newer version it pushes the result to the branch `bot/bump-ad4m`. So there
is at most one bump PR open, and it always names the newest version: a new ad4m publish updates it
rather than opening another. Merging it ends it; the next publish opens a new one. A PR closed
without merging stays closed until a newer version appears. To run it now rather than on the hour,
use "Run workflow" on the workflow's page in the Actions tab.

It opens the PR as `github-actions`, which needs the repository setting "Allow GitHub Actions to
create and approve pull requests" (Settings → Actions → General). A PR opened that way starts no
workflows by itself, so the bot starts CI on the branch, and the checks appear on the PR as usual.

**A routine bump** (WE catching up, with nothing in WE needing the new version) is the bot's PR, on
its own, so a breakage points at one cause. **A feature that needs a new ad4m** bumps inside its own
PR instead, as step 4 of pairing says: the feature and the version it depends on are one change.

`npm install` only picks up the `latest` tag, so nobody installs a `dev` version by accident.

### What `pnpm bump:ad4m` does

`pnpm bump:ad4m` moves to whatever npm's `dev` tag points at; `pnpm bump:ad4m <version>` moves to a
particular version. It updates the root `pnpm.overrides` and every exact version a workspace package
declares, runs `pnpm install`, and prints the ad4m commits since the old pin for the PR description.
The bot runs it with `--if-newer` (a version it cannot move to yet ends the run quietly),
`--lockfile-only` (updates `pnpm-lock.yaml` without installing) and `--pr-body <file>`.

It refuses:

- a version not published for **both** packages, or published for them from different commits. The
  app's client is the SDK inside ad4m-connect, so an SDK from one commit and a connect from another
  is a pairing nobody tested.
- a version older than the current pin, unless given `--allow-older`. A tag can lag behind.

### What `pnpm verify:ad4m` checks

It runs WE's live tests (`pnpm --filter @we/backend-ad4m test:live`) against a real executor. There
are two files in `packages/backend-system/ad4m/tests/live/`, and either one failing means do not
merge the bump.

**`capabilities.live.ts`.** WE declares what the ad4m executor can do natively (`ad4mCapabilities`
in `@we/backend-ad4m`), so it can refuse a query ad4m would answer wrongly instead of showing wrong
rows. Nothing else checks that declaration against ad4m. For each claim (each operator, sort,
traversal, and so on), it runs one query against the executor and the same query against WE's
in-memory engine over the same records, then compares, printing a table at the end:

| Result                 | Meaning                                     | Action                                 |
| ---------------------- | ------------------------------------------- | -------------------------------------- |
| **holds**              | The answers match                           | None                                   |
| **claimed but fails**  | The declaration is wrong, or ad4m regressed | Do not merge the bump                  |
| **not claimed, works** | ad4m can do something WE does not use       | Consider claiming it, in a separate PR |

Only "claimed but fails" fails a test; "not claimed, works" is reported, not failed.

**`conformance.live.ts`.** The suite every backend runs (`@we/backend-conformance`): records,
relations and live queries through the backend's ports. The cases ad4m is known to fail are listed
in that file with what is wrong, and run inverted — they pass while the gap is open, and fail when
an ad4m change closes it, which is the cue to delete the entry.

Both start one executor in a temporary directory, on free ports and with no network, and remove it
afterwards. By default it is `../ad4m/target/release/ad4m-executor`; `AD4M_EXECUTOR=<path>` names
another, and `AD4M_LIVE_URL` with `AD4M_LIVE_TOKEN` uses one already running, its agent unlocked.
Build that executor from the commit the new pin was published from
(`npm view @coasys/ad4m@<version> gitHead`), with `cargo build --release --bin ad4m-executor`.

It also runs in CI, as the `AD4M live` workflow (`.github/workflows/ad4m-live.yaml`): on a PR that
touches the backend packages, the entities or the pin, and on the bump bot's branch. The executor
takes the better part of an hour to compile, so the workflow builds it once per pinned commit, in
AD4M's own CI image, and caches the binary — the first run after a bump is slow and the rest take
minutes. It is not a required check: read it before merging a bump, the way you would the run here.

### Testing an ad4m branch against WE's tests

The `AD4M compatibility` workflow builds WE against an ad4m change's source and runs its typecheck
and tests there. It never blocks a PR.

- **On a paired PR it runs by itself**, against the PR's own commit and whatever the pairing
  names. It also runs the schema validation, audits and browser tests that the required checks skip
  while Build is red. Editing the pairing does not re-run it: push again, or re-run the workflow,
  which reads the description as it is now. On an unpaired PR it is skipped.
- **From the Actions tab**, name an ad4m branch, and it tests the last WE commit that passed CI on
  `dev` against it — so a failure there is ad4m's difference by construction.

`scripts/ad4m-pairing.mjs` reads the pairing for the preview, this workflow and the required checks
alike, so they cannot disagree about whether a PR is paired.

The early warning that a change on ad4m `dev` breaks WE is the bump bot's PR: its CI goes red within
the hour of the ad4m merge.

## Why this shape

| Decision                                   | Reason                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build from the pin, not from ad4m `dev`    | A build from ad4m `dev` changes when ad4m changes, with no WE commit. It cannot be reproduced, and CI never tested it.                                                                     |
| Publish often, instead of skipping the pin | The problem was that the pin moved rarely. Moving it often fixes that and keeps every build tested.                                                                                        |
| Required checks never build from source    | A branch in another repo must not decide whether a WE change can merge. The paired check does, and never blocks.                                                                           |
| Build both packages when pairing           | The app's client comes from ad4m-connect's bundled SDK. Building only the SDK leaves the running client old.                                                                               |
| Link pairs in the PR description           | It is visible to reviewers, it is there before the first build, and several WE PRs can link one ad4m PR. Matching branch names was implicit and could link unrelated branches by accident. |
| Bump through a PR                          | CI and a preview check every new version before it reaches `dev`.                                                                                                                          |
| Merging a bump PR is the confirmation      | A separate "verified" constant that a person moved by hand only restated what the merge says.                                                                                              |
| Check capabilities with a script           | WE's declaration of what ad4m can do goes stale silently. One command at each bump catches that, and shows new capabilities too.                                                           |
| Desktop executor built from the pin        | The executor inside a release has to match the SDK the app was tested against.                                                                                                             |
| No "staging" site                          | A second site building from ad4m `dev` duplicated what bump PRs give, and misused a word that means a release candidate everywhere else.                                                   |

## Needs from outside WE

| What                                                                                                                                           | Who              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| A publish job on merges to ad4m `dev` (most of it exists in `publish.yml`)                                                                     | ad4m maintainers |
| Point npm's `latest` tag at a real release. It points at `0.13.0-test-interpretation-2` today, so `npm install @coasys/ad4m` gets a test build | ad4m maintainers |
| Make the executor build on macOS again: `ort-sys` downloads an ONNX Runtime that is no longer published for macOS                              | ad4m maintainers |
