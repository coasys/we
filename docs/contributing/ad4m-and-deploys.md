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
point at it.

| Step | What you do                                                 | What happens                                                                     |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1    | Add a line `ad4m: coasys/ad4m#<N>` to the WE PR description | The preview builds both ad4m packages from that ad4m PR (its merge, once merged) |
| 2    | Review and test on the preview                              | You see the two halves working together                                          |
| 3    | Merge the ad4m PR first                                     | It is published under the `dev` tag (see below)                                  |
| 4    | Run `pnpm bump:ad4m` in the WE PR, and remove the line      | CI now tests the real combination                                                |
| 5    | Merge the WE PR                                             | `dev` stays on a published, tested pin                                           |

To pair with a branch, tag or commit instead, write `ad4m: coasys/ad4m@<ref>`, for example
`ad4m: coasys/ad4m@dev`. Without a line, the preview uses the pin.

To try an ad4m change in WE with no WE change to go with it, open a draft WE PR with an empty commit
(`git commit --allow-empty`) and the line. Close it when you are done.

Editing the line does not rebuild the preview: push again, or use "Retry deploy" in Netlify. If the
line names something that cannot be found, the preview fails rather than quietly using the pin.

## An example, end to end

| When                                                     | What happens                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| You open an ad4m PR and a WE PR that needs it            | The WE PR description links the ad4m PR, and its preview runs both together |
| The ad4m PR merges                                       | ad4m CI publishes a new version under the `dev` tag                         |
| You run `pnpm bump:ad4m` in your WE PR                   | Both pins move to that version, and it prints the ad4m changes for the PR   |
| You run `pnpm verify:ad4m`, check the preview, and merge | The dev site has the ad4m change on its next deploy                         |

## Keeping the pin current

| Step | Who                | What                                                                                               |
| ---- | ------------------ | -------------------------------------------------------------------------------------------------- |
| 1    | ad4m CI            | On every merge to ad4m `dev`, publish the npm packages at one new version, under the npm tag `dev` |
| 2    | A person (for now) | Run `pnpm bump:ad4m` on a new branch and open a PR with what it prints                             |
| 3    | CI and preview     | Build and test WE against the new version                                                          |
| 4    | A person           | Run `pnpm verify:ad4m`, check the preview, and merge                                               |

Step 1 is not in place yet: today ad4m publishes automatically only on merges to its `main`, and the
versions WE pins are published by hand. Until it lands, anyone with npm publish rights can publish a
version by hand under the `dev` tag, from one commit for all the packages. A bot could do step 2
later.

Bump in a PR of its own, not inside a feature PR, so a breakage points at one cause. `npm install`
only picks up the `latest` tag, so nobody installs a `dev` version by accident.

### What `pnpm bump:ad4m` does

`pnpm bump:ad4m` moves to whatever npm's `dev` tag points at; `pnpm bump:ad4m <version>` moves to a
particular version. It updates the root `pnpm.overrides` and every exact version a workspace package
declares, runs `pnpm install`, and prints the ad4m commits since the old pin for the PR description.

It refuses:

- a version not published for **both** packages, or published for them from different commits. The
  app's client is the SDK inside ad4m-connect, so an SDK from one commit and a connect from another
  is a pairing nobody tested.
- a version older than the current pin, unless given `--allow-older`. A tag can lag behind.

### What `pnpm verify:ad4m` checks

WE declares what the ad4m executor can do natively (`ad4mCapabilities` in `@we/backend-ad4m`), so
it can refuse a query ad4m would answer wrongly instead of showing wrong rows. Nothing else checks
that declaration against ad4m. For each claim (each operator, sort, traversal, and so on), the
script runs one query against the executor and the same query against WE's in-memory engine over
the same records, then compares:

| Result                 | Meaning                                     | Action                                 |
| ---------------------- | ------------------------------------------- | -------------------------------------- |
| **holds**              | The answers match                           | None                                   |
| **claimed but fails**  | The declaration is wrong, or ad4m regressed | Do not merge the bump                  |
| **not claimed, works** | ad4m can do something WE does not use       | Consider claiming it, in a separate PR |

It starts its own executor in a temporary directory and removes it afterwards. By default it uses
`../ad4m/target/release/ad4m-executor`; `--executor <path>` names another, and `--port` with
`--token` uses one that is already running. Build that executor from the commit the new pin was
published from (`npm view @coasys/ad4m@<version> gitHead`), with
`cargo build --release --bin ad4m-executor`.

It runs locally rather than in CI because it needs an executor, which takes the better part of an
hour to compile. Live queries are not checked.

### An early warning

The `AD4M compatibility` workflow builds WE against ad4m `dev` every night. It never blocks a PR; it
opens an issue when ad4m `dev` has changed something WE depends on, so the next bump does not come as
a surprise.

## Why this shape

| Decision                                   | Reason                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build from the pin, not from ad4m `dev`    | A build from ad4m `dev` changes when ad4m changes, with no WE commit. It cannot be reproduced, and CI never tested it.                                                                     |
| Publish often, instead of skipping the pin | The problem was that the pin moved rarely. Moving it often fixes that and keeps every build tested.                                                                                        |
| CI never builds from source                | A branch in another repo must not decide whether a WE change can merge.                                                                                                                    |
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
