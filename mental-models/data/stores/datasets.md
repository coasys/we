# Datasets

`DatasetStore` holds the agent's datasets: which exist, their order, which is current, and which entities the current one holds. It also holds the **system datasets**, which the host makes for itself and which are never spaces: `we-root`, `we-personal` and `we-test`.

**Why:** All dataset lifecycle goes through `DatasetLifecyclePort`, in one store, so the sidebar, the space loader and the boot agree on one list. The two system datasets that belong to the agent hold different things. `we-root` holds only configuration that can be rebuilt, so a repair or a reset may touch it. `we-personal` holds what the agent made or kept, so nothing that repairs configuration reaches it.

**Parent:** [Stores](README.md)

<details><summary>How it works</summary>

| Dataset | Holds | Schema |
|---|---|---|
| `we-root` (`rootDataset`) | `AgentSettings`, installed templates and themes, per-space preferences, read markers, the mute list | `installRoot` on every boot |
| `we-personal` (`personalDataset`) | notes, the Pocket, agent-scoped module records | `installSpace` with module and agent schemas |
| `we-test` (`testDataset`) | the development sandbox | |
| global (`globalDataset`), marketplace (`marketplaceDataset`) | shared datasets named by the seed | recognised: the joined dataset whose `sharedUri` equals the seed's URL |

1. `initSystemDatasets` finds or creates the system datasets in parallel. The boot waits for the root and for the datasets a first run must make. It does not wait for the personal dataset.
2. `switchDataset(uuid, { stillWanted })` gets the `DatasetRef` and checks the schema:
   - With WE's core schema, it runs `installModules` and `refreshSpace` together. Both write only what changed, and a failure in either does not stop the switch.
   - With no schema at all, it waits for `whenSynced`, checks again, and only then runs `installSpace`.
   - With another app's schema and no core schema, it installs nothing. The space then offers "initialize as a WE space" ([Joining](../spaces/join.md)).
3. A later switch, or a `stillWanted()` that returns false, stops an earlier switch before it publishes `currentDataset`.
4. After the switch, `foreignSchemas` fills `currentDatasetEntities`.
5. `trackDataset(ref)` adds a dataset the moment an action creates or joins it. `onDatasetRemoved` tells `SpaceStore` when one goes.
6. `updateAgentSettings` writes a partial update to `AgentSettings` and reports a write that did not land.

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/DatasetStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/DatasetStore.tsx): `DatasetStore`, `switchDataset`, `initSystemDatasets`, `initRootDataset`, `initPersonalDataset`, `trackDataset`.
- [packages/app-shell/src/shared/systemDatasets.ts](../../../packages/app-shell/src/shared/systemDatasets.ts): `SYSTEM_DATASET_NAMES`, `SYSTEM_DATASETS`, `isSystemDataset`.
- [packages/backend-system/shared/src/lifecycle.ts](../../../packages/backend-system/shared/src/lifecycle.ts): `DatasetLifecyclePort`, `DatasetRef`.

</details>
