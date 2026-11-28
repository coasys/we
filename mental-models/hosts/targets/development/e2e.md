# End-to-end tests

`@we/e2e` is the host that every live test runs on. It starts a fresh AD4M executor and makes accounts on it, serves a built app with its production Content-Security-Policy, opens Chrome with one browser context for each device, and saves screenshots and logs when a step fails. A **journey** is a test that follows a person's path through the built web app with this host.

**Why:** The served app gets the production policy from `@we/csp` as a header, so a journey also checks that the app works under that policy (`app.mjs`). The executor is multi-user, as a remote host runs, and every live test signs in with `signUp`, so what passes for a test also passes for a person (`executor.mjs`). The executor has fresh data, free ports, and no bootstrap, proxy or mDNS, so it never joins a network.

**Parent:** [Development hosts](README.md)

<details><summary>How it works</summary>

| Entry       | Gives                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env`       | `ROOT`, `executorBinary()` (the binary that `scripts/ad4m-executor.mjs` chooses), `chromePath()` (`WE_CHROME`)                                      |
| `executor`  | `startExecutor()` (data in a temp folder with the prefix `DATA_PREFIX`, `we-live-web-`), `signUp`, `registerLlm`, `registerTranscriber`, `freePort` |
| `app`       | `serveDist(dir)`, `productionCsp()`, `currentSeed()`                                                                                                |
| `browser`   | `launchBrowser()`, `device()` (a signed-in browser context), `openConnections`, `videoFlow`                                                         |
| `waits`     | `until`, `within`, `sleep`                                                                                                                          |
| `artifacts` | `captureFailure` (a screenshot and an aria snapshot of each page, and the executor log), `capturing`, `artifactsDir` (`WE_E2E_ARTIFACTS`)           |
| `fake-ai`   | `fakeAiAdmin()`: the `ai` calls of an admin client, refused as the executor refuses them, for tests that start no executor                          |
| `mcp`       | `mcpSession(url, token)`                                                                                                                            |

`pnpm e2e <suite>` runs a suite. The journeys are `calls`, `spaces` and `feed-scale`, in `apps/we-web/e2e/`. Steps that more than one journey uses are in `apps/we-web/e2e/steps/`.

</details>

<details><summary>Where in the code</summary>

- [packages/e2e/src/](../../../../packages/e2e/src/): one `.mjs` file and one `.d.mts` file for each entry; [src/index.mjs](../../../../packages/e2e/src/index.mjs) gives all of them.
- [apps/we-web/e2e/](../../../../apps/we-web/e2e/): the journeys; [scripts/e2e.mjs](../../../../scripts/e2e.mjs): `pnpm e2e`; [scripts/ad4m-executor.mjs](../../../../scripts/ad4m-executor.mjs): which executor binary.
- Depth: [docs/testing/e2e.md](../../../../docs/testing/e2e.md).

</details>
