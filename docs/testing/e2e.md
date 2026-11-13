# End-to-end tests

Most of WE is tested in jsdom, package by package (`pnpm test`). This page covers the tests that
need more than that: a real browser, a real AD4M executor, or both. There are three kinds. Each has
its own place, runner, file suffix and CI job, and `pnpm e2e` runs any of them:

```sh
pnpm e2e                                  # list the suites
pnpm e2e <suite> [--tier stub|real] [--only v2,v4] [--no-build]
```

`pnpm e2e <suite>` builds what the suite imports, runs `pnpm ad4m:executor` when the suite needs an
executor, then runs the suite through its own package script. It stops at the first step that fails.
`--no-build` skips the build and uses the last one. `--tier` and `--only` apply only to the spaces
suite. Linux x64 is the one platform ad4m publishes executors for. Set `GITHUB_TOKEN` (for example
`GITHUB_TOKEN=$(gh auth token)`) so the first download is not rate-limited.

## The three kinds

### Browser layout tests

These questions only a browser's layout engine can answer: which CSS rule wins under a pointer, at a
given container width, whether something sits in the top layer, and how wide a panel ends up. They
run in real Chrome against code bundled from source. They use no executor and no built app, so they
are not end to end, and each keeps its own runner.

| Suite                | Where                                                   | Runner · suffix                                                                             | CI                       |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| `browser-layout`     | `packages/app-shell/tests/browser/` (cases in `cases/`) | its own `run.mjs`: bundles, serves under the production CSP, sweeps each case across widths | `build.yaml`, `test` job |
| `primitives-browser` | `packages/design-system/3-primitives/src/`              | vitest (`vitest.browser.config.ts`) · `*.browser.test.ts`                                   | `build.yaml`, `test` job |

Run them with `pnpm e2e browser-layout` and `pnpm e2e primitives-browser`, or with the packages'
`test:browser` scripts. `run.mjs` lists its own diagnostics (`WE_BROWSER_ONLY`, `WE_BROWSER_SHOTS`
and others) in its header.

### Live contract tests

These hold one surface to its contract against a real executor: the AD4M adapter through the
backend ports, and the desktop custody service through its screens. They use no built app.

| Suite          | Where                                      | Runner · suffix                                | CI                                                 |
| -------------- | ------------------------------------------ | ---------------------------------------------- | -------------------------------------------------- |
| `backend-live` | `packages/backend-system/ad4m/tests/live/` | vitest (`vitest.live.config.ts`) · `*.live.ts` | `ad4m-live.yaml`, `live` job                       |
| `custody-live` | `crates/custody/tests/live.rs`             | cargo, skipped unless `CUSTODY_LIVE=1`         | none: run it by hand when the custody flows change |

`pnpm e2e backend-live` is `pnpm verify:ad4m`. What each of its files checks, and what a failure means
for an ad4m bump, is in [ad4m and Deploys](../contributing/ad4m-and-deploys.md#what-pnpm-verifyad4m-checks).
Its setup (`tests/live/executor.ts`) starts one multi-user executor and signs up one account for the
whole run. `AD4M_LIVE_URL` with `AD4M_LIVE_TOKEN` (and `AD4M_LIVE_MCP_URL`) point it at an executor
that is already running instead.

`pnpm e2e custody-live` takes its executors from the same chooser as every other live test. It also
needs an ad4m checkout at the pinned commit (`AD4M_REPO`, default `../ad4m` beside this repository)
for two things nothing else provides: the identity-store binary and the language directories under
`tests/js`. The header of `live.rs` lists what to build there.

### Journeys

These follow a person's path through the built web app: real Chrome, a real executor, and several
people on it. They are the only tests that use the app as it ships, with its CSP, its connect flow and
its bundle.

| Suite    | Where                            | Runner · suffix             | CI                                                                           |
| -------- | -------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `calls`  | `apps/we-web/e2e/calls.e2e.mjs`  | `node --test` · `*.e2e.mjs` | `ad4m-live.yaml`, `calls` job                                                |
| `spaces` | `apps/we-web/e2e/coasys-spaces/` | `node --test` · `*.e2e.mjs` | stub tier: `ad4m-live.yaml`, `spaces` job. Real tier: ad4m's nightly (below) |

Steps more than one journey takes, such as making a space or reading the call bar, live in
`apps/we-web/e2e/steps/`. A step belongs there once a second journey needs it. The package scripts
run the suites without building anything first: `pnpm --filter @we/app-web test:live` (calls) and
`test:spaces`. `pnpm e2e calls` builds the default app first. `pnpm e2e spaces` builds the Coasys app
(`WE_SEED=seeds/coasys.seed.json`) first. Both serve `apps/we-web/dist`, so after running one, run the
other without `--no-build`.

The spaces suite has two tiers. The **stub** tier uses a scripted model and typed call lines, so its
results are exact. It is the gate for product breaks. The **real** tier uses a model endpoint and a
recorded call through a speech-to-text server (or, when the run names none, the stub server's fixed
transcript). Its README (`apps/we-web/e2e/coasys-spaces/README.md`) covers both
tiers, the verticals, their backlog of `it.todo`, and how to read a red real-tier run.

**The real tier runs in ad4m's nightly**, a CircleCI job in the ad4m repository
(`scripts/coasys-spaces.sh` there). It runs against ad4m `dev` rather than WE's pin: it packs the
client from the commit under test and builds the executor from that same commit. It runs
`pnpm --filter @we/app-web test:spaces` with `AD4M_EXECUTOR`, `COASYS_SPACES_TIER`,
`COASYS_SPACES_LLM_BASE_URL`, `COASYS_SPACES_LLM_MODEL` and `COASYS_SPACES_ARTIFACTS`. That script,
its name and those variables are a contract with that repository: keep them working.

## `@we/e2e`: what the live tests share

`packages/e2e` holds the pieces every live test needs, so that no suite keeps its own copy. It is
plain ES modules with hand-written types and no build step. Import a piece from its own entry
(`@we/e2e/executor`) or import everything from `@we/e2e`.

| Entry       | Exports                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env`       | `ROOT`; `executorBinary()`: the binary `scripts/ad4m-executor.mjs --path` chooses; `chromePath(env?)` and `chromeCandidates()`                                      |
| `executor`  | `startExecutor(options?)`, `signUp(executor, email, password?)`, `registerLlm(admin, server)`, `registerTranscriber(admin, server)`, `freePort()`, `DATA_PREFIX`    |
| `app`       | `serveDist(dir, { seed?, host? })`: a built app served with the production CSP header; `productionCsp()`, `currentSeed()`                                           |
| `browser`   | `launchBrowser({ fakeAudio?, headless? })`, `device(browser, executor, account, { name?, viewport? })`: a signed-in browser context; `openConnections`, `videoFlow` |
| `waits`     | `until(read, accept, { timeout?, interval?, what? })`, `within(promise, ms, what?)`, `sleep(ms)`                                                                    |
| `artifacts` | `artifactsDir({ dir?, prefix? })`, `captureFailure({ dir, name, pages, executor? })`, `capturing(capture, fn)`, `saveArtifact`, `slug`                              |
| `fake-ai`   | `fakeAiAdmin({ unlisted? })`: a stand-in for an admin client's `ai` calls that refuses them as the executor does, for unit tests of model setup                     |
| `mcp`       | `mcpSession(url, token)`: an MCP client session with `tools()` and `call(name, args)`                                                                               |

`startExecutor` starts a fresh executor that is **multi-user** by default, the way a hosted node runs.
It has fresh data in a temp directory named `we-live-web-…`, free ports, and no bootstrap, proxy or
mDNS. `mcp: true` turns on its MCP endpoint. Its `stop()` can be called more than once: it stops the
process, writes the log to `logFile` when one is given, and removes the data. An exit guard stops an
executor that a crashed run left behind. `signUp` creates an account on it and returns that
account's token and DID, with no email step. This is how every live test signs in, so what passes
also passes for a person on a hosted node.

`until` polls until the value is accepted, and on timeout says what it was waiting for and what it
last saw. A wait longer than a minute prints one line each minute, so a CI no-output timeout does not
stop a slow but healthy run.

`captureFailure` writes, for each open page, a full-page screenshot (`<name>-<page>.png`) and an aria
snapshot with the page's URL on the first line (`<name>-<page>.aria.txt`), plus `executor.log`.
`capturing` wraps a `node:test` body so that a step which throws captures before it fails. The calls
journey wraps every step this way, and the spaces suite captures every page of the failing vertical.

`packages/e2e` has unit tests of its own (`pnpm --filter @we/e2e test`).

## Environment

| Variable                                                | Read by                | Use                                                                                                                   |
| ------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AD4M_EXECUTOR`                                         | every live test        | The executor binary. Without it, the seed's `ad4m.executorPath`, else the pinned download.                            |
| `WE_CHROME`                                             | every browser test     | The Chrome or Chromium to drive. Without it, Playwright's own, then `google-chrome`, then `chromium`.                 |
| `WE_E2E_ARTIFACTS`                                      | journeys               | Where failure artifacts go. Without it, a new temp directory, whose path the run prints.                              |
| `WE_LIVE_LOG`                                           | `startExecutor`        | A file to write the executor's output to when it stops.                                                               |
| `WE_SEED`                                               | the build, `serveDist` | The seed the app is built with and whose CSP it is served under (`we-seed.json` otherwise).                           |
| `AD4M_LIVE_URL`, `AD4M_LIVE_TOKEN`, `AD4M_LIVE_MCP_URL` | `backend-live`         | An executor already running, instead of a fresh one.                                                                  |
| `COASYS_SPACES_*`                                       | `spaces`               | Tier, verticals, model and artifacts: see the suite's README. `COASYS_SPACES_ARTIFACTS` overrides `WE_E2E_ARTIFACTS`. |
| `CUSTODY_LIVE`, `AD4M_REPO`                             | `custody-live`         | Turns the test on, and names the ad4m checkout for the identity store and `tests/js`.                                 |
| `GITHUB_TOKEN` / `GH_TOKEN`                             | `pnpm ad4m:executor`   | Raises GitHub's rate limit for the executor download.                                                                 |

## Adding a test

- **A question about layout or the cascade** goes in the browser layout tests: a case in
  `app-shell/tests/browser/cases/` for the shell, or a `*.browser.test.ts` beside a primitive.
- **A question about what an executor does with WE's data** goes in a live contract test: a
  `*.live.ts` in `backend-system/ad4m/tests/live/`. It uses the account the setup provides
  (`inject('ad4mExecutor')`) and perspectives of its own.
- **A person's path through the app** is a journey: a `*.e2e.mjs` in `apps/we-web/e2e/`, a vertical in
  `coasys-spaces/` if it belongs to the product film. Use `startExecutor`, `signUp`, `serveDist` and
  `device` from `@we/e2e`. Select by role and accessible name. When one is missing, add a `label` to
  the product node rather than reaching for a CSS selector.

Then give the suite a name in `scripts/e2e.mjs`, if it is a new suite, and a CI home in the table
above.
