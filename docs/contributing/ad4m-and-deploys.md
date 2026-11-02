# How WE builds against ad4m, and where it deploys

WE depends on two ad4m packages: `@coasys/ad4m` (the SDK) and `@coasys/ad4m-connect` (the connection
UI, which bundles its own copy of the SDK). This document explains which ad4m each WE build uses,
where each build goes, and how a release is made.

## The one rule

**Every WE build uses the ad4m its root `package.json` pins.** The preview, CI, the live tests and
the desktop executor all come from that one ad4m commit, so they cannot disagree.

The pin is a promise: "this WE was built and tested against this ad4m". Merging the PR that set it
is the confirmation.

## What the pin is

The root `pnpm.overrides` entries for `@coasys/ad4m` and `@coasys/ad4m-connect`. Nothing else declares
a version: workspace packages say `"*"`, and the override decides what every one of them installs.
The pin is one of two kinds:

| Kind         | Looks like                                               | Pinned by                                   |
| ------------ | -------------------------------------------------------- | ------------------------------------------- |
| **Snapshot** | `https://pkg.pr.new/coasys/ad4m/@coasys/ad4m@<full sha>` | `dev`, and every feature PR                 |
| **Version**  | `0.13.1-staging.2`                                       | `main` and releases, since it never expires |

ad4m publishes a snapshot of both packages to pkg.pr.new for every commit on its `dev` and every PR
head (not from forks), a few minutes after the push, and keeps them for at least a month. A snapshot's
own `package.json` carries the release's version and no commit, so **the commit is only in the URL**.

`scripts/ad4m-pin.mjs` is the one reader of the pin. Every workflow and script that needs to know
which ad4m WE is on asks it, rather than reading the override: `node scripts/ad4m-pin.mjs` prints the
kind and the commit or version, and `--commit` prints the ad4m commit either way (for a version, the
`gitHead` npm recorded). It refuses a short sha, the two packages on different commits, or anything
that is neither form.

pnpm records no integrity for a tarball URL, so a frozen install would accept whatever bytes the URL
served. `pnpm bump:ad4m` therefore writes each snapshot's `sha512` into `pnpm-lock.yaml`, where pnpm
keeps it and enforces it, and the merge gate fails a lockfile without it. A plain `pnpm install` that
re-resolves the snapshot can drop it: run `pnpm bump:ad4m <commit>` to put it back.

## Where WE deploys

|                | Built from      | ad4m used                                           | URL                                         | For                           |
| -------------- | --------------- | --------------------------------------------------- | ------------------------------------------- | ----------------------------- |
| **Preview**    | the PR's branch | the PR's pin                                        | `deploy-preview-<N>--coasys-we.netlify.app` | reviewing a PR                |
| **Dev**        | `dev`           | a snapshot of ad4m `dev`                            | `dev--coasys-we.netlify.app`                | the team, and invited testers |
| **Production** | `main`          | a published version                                 | `coasys-we.netlify.app`                     | the public                    |
| **Desktop**    | a release tag   | a published version, and an executor built to match | GitHub releases                             | people running WE locally     |

Every web build writes `/build-info.json`: the WE version and branch, and which ad4m it was built
against — the kind of pin, and its commit. The page logs the same line to the console.

## Releasing

Merging `dev` into `main` is a release. There is no separate staging step.

1. On `dev`, pin a published ad4m version: `pnpm bump:ad4m staging` (the newest published from ad4m's
   `staging` branch) or `pnpm bump:ad4m <version>`. A PR into `main` that pins a snapshot cannot
   merge, and a tag that does fails to package: a snapshot expires, and a release must rebuild from
   its tag for as long as anyone needs it. The version must contain the ad4m commit `dev` was
   pinned to, or the release would ship an older ad4m than `dev` was tested against: both the bump
   and the merge gate refuse one that does not. ad4m publishes from `staging` after merging `dev`
   into it, so when no version qualifies yet, wait for the next one.
2. On `dev`, set `version` in the root `package.json` and in each `apps/*/package.json` (while WE is
   pre-1.0: `0.1.0-alpha.1`, `0.1.0-alpha.2`, …).
3. Open a PR from `dev` to `main` titled `Release v<version>`, and merge it with a merge commit.
4. Tag the merge commit and push the tag:
   `git tag -a v<version> origin/main -m "WE <version>" && git push origin v<version>`.

The tag starts `.github/workflows/electron-package.yaml`. It checks that the tag matches
`package.json` and that the pin is a version, builds the ad4m executor from the commit that version
was published from, packages the desktop app and publishes it as a GitHub release. The first build of
an executor takes about 45 minutes; later releases on the same pin reuse it. Desktop releases are
Linux only until the executor builds on macOS again. The next bump bot run moves `dev` back to a
snapshot.

## A WE change that needs an ad4m change

Pin the ad4m PR's snapshot in the WE PR:

```sh
pnpm bump:ad4m '#<N>'          # or the ad4m PR's URL
```

That PR's head is then what the preview, CI and the live tests all run against — the ordinary path,
with nothing paired, nothing built from source, and nothing to write in the description. Pushing to
the ad4m PR does not move the pin: run the command again to pick up its new head. Within the hour,
a comment on the WE PR says when its ad4m PR has commits it does not pin yet (below).

| Step | What you do                                    | What happens                                                            |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | `pnpm bump:ad4m '#<N>'` in the WE PR, and push | Every check and the preview run against that ad4m change                |
| 2    | Review and test on the preview                 | You see the two halves working together                                 |
| 3    | Merge the ad4m PR first                        | Within the hour the WE PR's gate re-runs, or the PR is told what to run |
| 4    | If asked, `pnpm bump:ad4m dev`, and push       | The WE PR pins ad4m `dev`, which now has the change                     |
| 5    | Merge the WE PR                                | `dev` moves to a pin that is on ad4m `dev`                              |

**A PR pinning an ad4m change cannot merge until that change is on ad4m `dev`.** The required check
**`PR tasks / Not waiting on ad4m`** reads the pin (`scripts/ad4m-gate.mjs`). For a snapshot it passes
when both hold:

1. **The pinned commit is on ad4m `dev`.** An unmerged ad4m PR's head is not, so a WE PR that needs
   it waits. While it fails, the check names the ad4m PR.
2. **It is the base branch's pinned commit, or a descendant of it.** So a PR started on an older ad4m
   cannot move `dev`'s pin backwards. It fails with `pnpm bump:ad4m dev` as the fix.

ad4m merges PRs with merge commits, so once the ad4m PR merges its head is on `dev` and rule 1 holds
with no change in WE. Nothing here runs when that happens, so the bump workflow's hourly `ready` job
asks (`scripts/ad4m-repin.mjs`): it re-runs the gate on a PR it now admits, and comments on one it
still refuses whose ad4m PR has merged — squash-merged, or behind `dev`'s pin — naming the command to
run. While the ad4m PR is still open, it also keeps one comment on a WE PR that pins an older commit
of it, saying how many commits behind its head it is and the command that catches up, and deletes
it once the pin catches up. That never blocks: pinning an older head can be deliberate. The gate's
summary says the same on each push. Nothing pushes to anyone's branch.

A version pin passes when it contains the base's snapshot, if the base pins one (above, under
Releasing), and otherwise always. A snapshot passes rule 2 by default when the base pins a version
(versions come from ad4m's `staging` branch, which no `dev` commit descends from). Into `main`, only
a version passes.

**The PR list shows which PRs are waiting.** A PR whose pin is an ad4m commit not on ad4m `dev` yet
carries the **`waiting on ad4m`** label. Nobody sets it by hand: the gate puts it on or takes it off
on each push, and the hourly job takes it off when the ad4m PR merges (and sets it on PRs from forks,
whose own runs cannot write labels).

**Import the new SDK API directly.** The PR installs the ad4m change it needs, so there is no reason
to declare its types again in WE or check at runtime whether a method exists: the checks run against
the real thing.

To try an ad4m change in WE with no WE change to go with it, open a draft WE PR with
`pnpm bump:ad4m '#<N>'` and nothing else. Close it when you are done. An ad4m change with no PR has
no snapshot unless it is on ad4m `dev`: open a draft ad4m PR to get one. A PR from a fork gets none.

## Keeping the pin current

| Step | Who            | What                                                                                            |
| ---- | -------------- | ----------------------------------------------------------------------------------------------- |
| 1    | ad4m CI        | On every push to ad4m `dev`, publish a snapshot of both packages                                |
| 2    | WE's bump bot  | Once a day, if ad4m `dev` has moved, open a PR pinning its head, listing the ad4m changes since |
| 3    | CI and preview | Build and test WE against the new commit, and run `pnpm verify:ad4m` (the `AD4M live` workflow) |
| 4    | A person       | Read the live tests' result, check the preview, and merge                                       |

**The bump bot** is `.github/workflows/bump-ad4m.yaml`. Once a day it runs `pnpm bump:ad4m dev` from
WE `dev`, and when ad4m `dev` has moved it pushes the result to the branch `bot/bump-ad4m`. So there is
at most one bump PR open, and it always names the newest commit: a later run updates it rather than
opening another. Merging it ends it. To run it now, use "Run workflow" on the workflow's page in the
Actions tab.

It also keeps an open bump PR worth reading. When a feature PR moves `dev`'s pin to the bump's
commit or past it, the bot closes the bump, since there is nothing left in it to merge. When a pin
move on `dev` leaves the bump conflicting but still ahead, the bot rebuilds it on `dev` with the same
commit and runs CI again. Both happen on the daily run, so a bump PR may look stale for up to a day.

Daily rather than on every ad4m push, because each bump is a lockfile change that conflicts with
every open PR that also moves the pin. `pnpm-lock.yaml` has no merge driver: resolve such a conflict
by taking either side and running `pnpm bump:ad4m <the commit you want>`.

It opens the PR as `github-actions`, which needs the repository setting "Allow GitHub Actions to
create and approve pull requests" (Settings → Actions → General). A PR opened that way starts no
workflows by itself, so the bot starts CI, the live tests and the pin gate on the branch, and the
checks appear on the PR as usual. **A workflow with a required check has to be in that list**: a
required check that never reports blocks the bump PR for good.

**A routine bump** (WE catching up, with nothing in WE needing the new commit) is the bot's PR, on
its own, so a breakage points at one cause. **A feature that needs a new ad4m** pins it inside its own
PR instead, as above: the feature and the ad4m it depends on are one change.

### What `pnpm bump:ad4m` does

| Target                        | Pins                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `dev` (the default)           | the snapshot of ad4m `dev`'s head                            |
| `<sha>`, short or full        | the snapshot of that commit, written as the full sha         |
| `'#<N>'`, or an ad4m PR's URL | the snapshot of that PR's head                               |
| `staging`                     | the newest version published from a commit on ad4m `staging` |
| `<version>`, or an npm tag    | that version                                                 |

It rewrites the root `pnpm.overrides` (and nothing else), runs `pnpm install`, writes a snapshot's
integrity into the lockfile, and prints the ad4m commits since the old pin for the PR description.
The bot runs it with `--if-newer` (a target it cannot move to yet ends the run quietly),
`--lockfile-only` (updates `pnpm-lock.yaml` without installing) and `--pr-body <file>`.

It refuses:

- a target not published for **both** packages: a snapshot not there yet, or a version published for
  one and not the other, or for both from different commits. The app's client is the SDK inside
  ad4m-connect, so an SDK from one commit and a connect from another is a combination nobody tested.
- a target older than the current pin, unless given `--allow-older`: one whose commit adds nothing to
  the pin's, or a version published before the pinned one. The second catches a version from another
  branch, which carries a few commits of its own and so looks newer by commit however old it is.
- a version replacing a snapshot that it does not contain, unless given `--allow-older`: a release
  would ship an older ad4m than `dev` was tested against.

And with `--if-newer`, as the bot runs it, it waits for a commit whose executor ad4m's CI is still
building: WE downloads the executor ad4m publishes, so pinning a commit before its build finishes
would mean compiling it instead. A commit whose build has finished goes ahead whether or not it
published one. By hand the same case is a warning, and the bump goes ahead.

**Which version is newest is decided by branch, not by npm tag.** ad4m tags a prerelease `next` and a
release `latest`, and either tag can also hold a build somebody published by hand from a feature
branch. So `pnpm bump:ad4m staging` takes the newest version, by publish time, whose recorded commit
(`gitHead`) is on ad4m's `staging`.

### What `pnpm verify:ad4m` checks

It runs WE's live tests (`pnpm --filter @we/backend-ad4m test:live`) against a real executor. There
are three files in `packages/backend-system/ad4m/tests/live/`, and any one failing means do not
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

**`mentionWaker.live.ts`.** A bot is woken when a person @mentions it in a WE channel: the bot
configures its waker as the AD4M plugin does (`get_mention_waker_config` over the executor's MCP
endpoint, opened by `@coasys/ad4m`'s `WakerSubscriptionManager`), and what a person writes arrives
signed by a second agent, as sync delivers it. A mention is the `we://mention` link to the bot's
DID, never the name in the text: a post through WE's own `createBlocks` (the link from its root) and
a feed line written as a module writes one (the link from the line) each wake the bot, labelled by a
name in no profile or by a shortened DID. The bot's own post mentioning itself does not. It never
writes to an agent it did not create: against an executor already running it only reads the agent's
profile, and its last case checks that the profile is as it found it.

They share one executor in a temporary directory, on free ports, with MCP on and no network, removed
afterwards. Which binary is chosen as for the app (see
[The executor you run locally](#the-executor-you-run-locally)): the pinned one by default, which
`pnpm ad4m:executor` downloads. `AD4M_LIVE_URL` with `AD4M_LIVE_TOKEN` uses one already running
instead, its agent unlocked, with `AD4M_LIVE_MCP_URL` naming its MCP endpoint for the waker test.

It also runs in CI, as the `AD4M live` workflow (`.github/workflows/ad4m-live.yaml`): on a PR that
touches the backend packages, the entities or the pin, on `dev` after such a merge, and on the bump
bot's branch. The executor comes from the `.github/actions/ad4m-executor` action the desktop package
uses too, so the tests run the binary the app ships. It is cached by commit, and on a miss it is
**downloaded**: ad4m's own CI compiles the executor for every pushed commit and serves it at
`https://executor.ad4m.dev/<commit>/manifest.json`. `scripts/ad4m-executor-download.mjs` fetches
that from the commit alone, with no credentials, and checks it against the sha256 its manifest
records. That takes seconds. Only a commit with nothing to download is compiled, which takes the
better part of an hour: one built before ad4m published executors, one whose file has been removed
(kept 35 days), or a macOS build, which ad4m does not publish.

A cache saved on `dev` serves every PR, and one saved on a PR serves only that PR. So when the bump
bot moves to a new commit, it first fetches that commit's executor into `dev`'s cache (the `AD4M
executor` workflow, `.github/workflows/ad4m-executor.yaml`), and only then starts CI on its branch.
Runs on the same commit wait for one another rather than fetch twice, so the bump PR's run, any PR
moving to the same commit, and the push to `dev` after either merges all restore that one copy. A
push never cancels a fetch in progress, only the tests. To fetch by hand, run the `AD4M executor`
workflow on `dev` with the commit `node scripts/ad4m-pin.mjs --commit` prints.

Once cached, nothing depends on ad4m's artifacts lasting: it fetches each commit once, within
minutes of pinning it. A PR pinning an ad4m PR's head fetches that commit's executor for itself on
its first run, and the live tests then run against the ad4m change the PR needs. It is not a required check: read it before merging a
bump, or a PR pinning an ad4m change, the way you would the run here.

### The executor you run locally

The pin installs the client, and the executor has to come from the same ad4m commit. A binary from
another one starts without complaint, and the mismatch shows up somewhere else: a WS method that
does not exist, a call that hangs, a feature that is in the code and absent at runtime. So
`scripts/ad4m-executor.mjs` chooses the executor for the Electron app, the live tests and
`pnpm setup-workspace` alike, first match wins:

| Source                                 | When                                                    |
| -------------------------------------- | ------------------------------------------------------- |
| `AD4M_EXECUTOR=<path>`                 | CI's packaging, or a one-off run against another binary |
| The seed's `ad4m.executorPath`         | You are changing ad4m and run your own build            |
| The pinned commit's download (default) | Everything else                                         |

```sh
pnpm ad4m:executor                       # make sure it is there, downloading the pinned one if not
node scripts/ad4m-executor.mjs --path    # print which binary would run
```

The pinned one is the executor ad4m's CI built for that commit (the same files as above), kept in
a cache outside the repositories, one directory per commit:
`~/.cache/we/ad4m-executor/<commit>/ad4m-executor` (under `$XDG_CACHE_HOME` when that is set).
Keyed by commit, a file there is that commit's executor, so nothing has to be checked: switching to
a branch that pins another commit finds it, or downloads it once, and every WE checkout on the
machine shares the cache. The five most recently used commits are kept. `pnpm dev:electron` runs the
same command first, without failing: it downloads what is missing and otherwise says what is wrong
and starts the app anyway.

Build from source only when you are changing ad4m itself, or where nothing can be downloaded (macOS,
or a commit too old to have a published executor): in the ad4m checkout, check out the commit
`node scripts/ad4m-pin.mjs --commit` prints, or your own branch, run
`cargo build --release --bin ad4m-executor`, and point a seed's `ad4m.executorPath` at
`target/release/ad4m-executor` — for one run, `AD4M_EXECUTOR` does the same without editing the
seed. Nothing checks that build against the pin; the command says so each time it runs one.

## Why this shape

| Decision                                      | Reason                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pin a commit, not "ad4m `dev`"                | A build from a moving branch changes when ad4m changes, with no WE commit. It cannot be reproduced, and CI never tested it. A snapshot is one commit, and the lockfile records its bytes.  |
| Snapshots for `dev`, versions for releases    | Every ad4m commit is published, so the pin can move as often as is useful. A snapshot expires and a version does not, so a release pins a version.                                         |
| A PR needing an ad4m change pins its snapshot | The preview, CI and the live tests then all test the change the PR needs, through the ordinary build. There is no paired build, no description block, and no from-source workflow to keep. |
| The merge gate reads the pin                  | Whether a PR waits on ad4m can be asked of GitHub — is the pinned commit on ad4m `dev` yet — rather than of the author. A branch in another repo still never decides what WE builds.       |
| The pin cannot move backwards                 | A PR started on an older ad4m would otherwise quietly undo ad4m changes `dev` already has.                                                                                                 |
| Core and connect from one commit              | The app's client comes from ad4m-connect's bundled SDK. A connect from another commit leaves the running client different from the SDK WE typechecks against.                              |
| Integrity in the lockfile                     | pnpm records none for a tarball URL. Without it, changed bytes at the same URL would install silently.                                                                                     |
| Bump through a PR                             | CI and a preview check every new ad4m before it reaches `dev`.                                                                                                                             |
| Check capabilities with a script              | WE's declaration of what ad4m can do goes stale silently. One command at each bump catches that, and shows new capabilities too.                                                           |
| Desktop executor built from the pin           | The executor inside a release has to match the SDK the app was tested against.                                                                                                             |

## Needs from outside WE

| What                                                                                                                                           | Who              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Keep `https://executor.ad4m.dev/<commit>/` for at least a few days after the commit (the host keeps 35), long enough for WE's first fetch      | ad4m maintainers |
| Point npm's `latest` tag at a real release. It points at `0.13.0-test-interpretation-2` today, so `npm install @coasys/ad4m` gets a test build | ad4m maintainers |
| Make the executor build on macOS again: `ort-sys` downloads an ONNX Runtime that is no longer published for macOS                              | ad4m maintainers |
