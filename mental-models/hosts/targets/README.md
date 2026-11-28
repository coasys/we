# Targets

A **target** is an app package that runs the app shell. Each target supplies a platform adapter and a backend connector, then renders `<PlatformProvider seed platform backend><App/></PlatformProvider>`. The web target connects to an executor that runs somewhere else. The two desktop targets start an executor and a custody service on the same computer. The development hosts run WE for previews, experiments and tests.

**Why:** The shell renders templates as data, so one app shell serves every target. A target therefore adds only what its platform makes different: how it reaches the executor, which host features it offers, and how it is packaged.

**Parent:** [Hosts](../README.md)

## Parts

- [Web](web.md): `@we/app-web`, a browser tab over ad4m-connect.
- [Electron](electron/README.md): `@we/app-electron`, a main process that supervises a child executor.
- [Tauri](tauri.md): `@we/app-tauri`, a Rust process that runs the executor in-process.
- [Development hosts](development/README.md): the preview host, the playgrounds, the CLI and the end-to-end tests.

<details><summary>How it works</summary>

| Target   | Platform adapter   | Backend connector                        | Executor                                   | Custody service                           |
| -------- | ------------------ | ---------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| web      | `webPlatform`      | `ad4mConnector`, or the guest connector  | elsewhere, through ad4m-connect            | none                                      |
| Electron | `electronPlatform` | `createLocalAd4mConnector` over IPC      | a child process                            | the `we-custody` sidecar (not on Windows) |
| Tauri    | `tauriPlatform`    | `createLocalAd4mConnector` over `invoke` | in the same process (`rust_executor::run`) | `we_custody::spawn`, in the same process  |
| preview  | `previewPlatform`  | `inMemoryConnector`                      | none (`@we/backend-inmemory`)              | none                                      |

Each target's `build` script is `we-build` from the [CLI](development/cli.md).

</details>

<details><summary>Where in the code</summary>

- [apps/we-web/](../../../apps/we-web/), [apps/we-electron/](../../../apps/we-electron/), [apps/we-tauri/](../../../apps/we-tauri/), [apps/we-preview/](../../../apps/we-preview/), [apps/playgrounds/](../../../apps/playgrounds/).
- [we-seed.json](../../../we-seed.json): the default seed. The targets import the seed of the build as `@we/seed-file`. The seed file: [Seed](../../modules/registry/seed.md).
- Depth: [codebase-map.md](../../../docs/architecture/codebase-map.md), [meta-app-vs-separate-apps.md](../../../docs/architecture/meta-app-vs-separate-apps.md).

</details>
