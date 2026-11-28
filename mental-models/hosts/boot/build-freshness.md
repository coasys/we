# Build freshness

A tab finds out when the server serves a newer build than the one the tab runs. A build is identified by the hashed file name of its entry module in `index.html`. When a lazy chunk fails to load and the server has a newer build, the tab reloads once. A watcher also tells the person when a newer build is available, before anything fails.

**Why:** Lazy panels load their code when somebody first opens them, which can be hours after boot. After a deploy, the old hashed chunks are not on the server. The entry file name is already a fingerprint of the whole asset graph, so no version constant or extra file is necessary (`shared/buildFreshness.ts`). A reload is correct only when the chunk is gone. A chunk that failed on the network is still there, so `installStaleBuildReload` asks the server first.

**Parent:** [Boot](README.md)

<details><summary>How it works</summary>

1. `buildIdIn(document)` reads the entry `src` (`ENTRY_SELECTOR`). `deployedBuildId` fetches the site root and reads the same value there. `newerBuild` compares the two.
2. `installStaleBuildReload` listens for `vite:preloadError`. If `newerBuild` finds a newer build, it records this build in `sessionStorage` (`we.reloaded-from-build`) and reloads. It reloads at most once per build, and it asks one question at a time. It does not cancel the error, so the error boundary still shows a failure that a reload cannot fix.
3. `watchForNewBuild` asks on a timer and when the tab becomes visible, with a minimum gap between questions. `App` then shows a toast "A new version of … is available." with a Reload action.
4. In dev the entry name never changes, so both stay quiet. Under `file://` the watcher does not start.

</details>

<details><summary>Where in the code</summary>

- [shared/buildFreshness.ts](../../../packages/app-shell/src/shared/buildFreshness.ts): `buildIdIn`, `deployedBuildId`, `newerBuild`, `installStaleBuildReload`, `watchForNewBuild`.
- [App.tsx](../../../packages/app-shell/src/frameworks/solid/App.tsx): the module-scope `installStaleBuildReload()` and the toast.
- [apps/we-web/public/_redirects](../../../apps/we-web/public/_redirects): the web host's single-page-app rule.

</details>
