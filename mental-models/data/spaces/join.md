# Joining

`joinSpace(id, focus)` joins a shared dataset by its shared id or URI, installs the space schema, and opens it. `initializeAsWeSpace` turns a joined dataset that another app made into a WE space, in place.

**Why:** A join is a long backend operation behind a request call. On AD4M the client gives up after 30 s, while the executor is often still fetching the neighbourhood and installing its link language. So a failed call is not a failed join: the store watches for the dataset for a time. It also asks the backend what it already holds before it joins, because a second join of the same space makes two datasets.

**Parent:** [Spaces](README.md)

<details><summary>How it works</summary>

1. `joinSpace` needs `lifecycle.join`. If a known dataset answers to the id (`datasetAnswersTo`), it switches to it and stops.
2. Joins of the same shared id (`sharedIdOf`) share one run (`joinsInFlight`).
3. `runJoin` calls `lifecycle.list({ fresh: true })`. A dataset that answers to the id goes straight to `finishJoin`.
4. Otherwise it calls `lifecycle.join(joinTargetOf(id))`. When the transport gave up (`transportGaveUp`), `waitForJoinedDataset` polls the backend for up to `JOIN_RECOVERY_WINDOW_MS` (5 minutes) with backoff.
5. `finishJoin`: `whenSynced`, `installSpace`, `trackDataset`, find the `Space` record by `url`, and `switchDataset` if `focus`.
6. A failure sets `joinError` (`joinErrorMessage`) and is thrown again to the caller. `joinSlow` turns on after `JOIN_SLOW_AFTER_MS`.

`focus: false` joins without opening, for example the marketplace.

`initializeAsWeSpace(name, description, avatar)` acts on the current dataset, which holds another app's schema and no WE core schema ([Datasets](../stores/datasets.md)):

1. `installSpace` adds WE's schema. The existing schema stays.
2. It writes a `Space` record with `url` set to the dataset's `sharedId` and `discovery` `hidden`, then the space structure.
3. It never creates or publishes a dataset: the dataset is already a joined neighbourhood.

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx): `joinSpace`, `runJoin`, `finishJoin`, `waitForJoinedDataset`, `initializeAsWeSpace`.
- [packages/app-shell/src/frameworks/solid/stores/space/joining.ts](../../../packages/app-shell/src/frameworks/solid/stores/space/joining.ts): `sharedIdOf`, `joinTargetOf`, `datasetAnswersTo`, `transportGaveUp`, `joinErrorMessage`, `JOIN_RECOVERY_WINDOW_MS`, `JOIN_SLOW_AFTER_MS`.
- [packages/backend-system/shared/src/lifecycle.ts](../../../packages/backend-system/shared/src/lifecycle.ts): `DatasetLifecyclePort.join`, `list`, `whenSynced`.

</details>
