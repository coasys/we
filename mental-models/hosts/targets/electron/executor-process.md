# Executor process

The Electron main process starts the AD4M executor as a child process, waits until it is ready, and supervises it. The executor's exit code decides the next action: stop, restart on the same port, restart on a new port, or show why it cannot start. The app stops only the executor that it started.

**Why:** The executor stops cleanly when its stdin closes, and the OS closes the pipe when the app ends, so `--watch-stdin` ties the executor's life to the app. An executor that another program runs on the same data folder is not the app's executor: the executor holds `executor.lock` in its data folder and exits with code 79 beside another one, and the app reports this (`executorProcess.js`). The stop closes stdin, then sends SIGTERM, and sends SIGKILL only if the process stays. A first SIGKILL can leave the conductor and the stores in the middle of a write.

**Parent:** [Electron](README.md)

<details><summary>How it works</summary>

1. `resolveAd4mDataPath` picks the data path ([Accounts](../../platform/accounts.md)). `ensureDataPathInitialised` runs `ad4m-executor init --data-path` when `mainnet_seed.seed` is missing.
2. `findFreePort(12000, 13000)` picks the port, and the admin token is a new `uuidv4()`. `ensureExecutorConfig` writes `executor-config.json` (mode 0600) from `initialExecutorConfig` when it is missing.
3. `startExecutorOnce` spawns the executor with `executorArgs`: `run --port --app-data-path --config --log-dir --watch-stdin true --custody-channel true --run-dapp-server false --connect-holochain true`. The token goes in the environment as `AD4M_ADMIN_CREDENTIAL` (`executorSpawnEnv`).
4. `waitForExecutorReady` waits until `GET /health` answers 200 `{"status":"ok"}`. Then `startCustodyFor(port, token)` starts the custody sidecar ([Custody](../../identity/custody.md)).
5. `startWithPortRetry` tries a taken port again on another port, up to 3 starts, before the window exists.
6. After an exit, `afterExecutorExit` reads the code (`EXIT`):

| Code                        | Action                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 `STOPPED`                 | `done`                                                                                                                                      |
| 75 `RESTART`                | `restart` on the same port, at once                                                                                                         |
| 78 `CONFIG_REFUSED`         | `refused`: show the refusal                                                                                                                 |
| 79 `DATA_FOLDER_BUSY`       | `busy`: another executor holds the data folder                                                                                              |
| 80 `PORT_TAKEN`, or a crash | `restart` on a new port: at once for 80, else after the `crashBackoff` delay (1 s to 30 s). After 6 restarts with no run of 60 s, `give-up` |

With `WE_EXTERNAL_AD4M_PORT` and `WE_EXTERNAL_AD4M_TOKEN` set, the app starts no executor and connects to that one.

</details>

<details><summary>Where in the code</summary>

- [electron/executorProcess.js](../../../../apps/we-electron/electron/executorProcess.js): `EXIT`, `afterExecutorExit`, `crashBackoff`, `startWithPortRetry`, `executorArgs`, `initialExecutorConfig`, `waitForExecutorReady`, `stopChild`.
- [electron/main.js](../../../../apps/we-electron/electron/main.js): `startExecutor`, `startExecutorOnce`, `ensureDataPathInitialised`, `ensureExecutorConfig`, `restartExecutorAndReload`, `showExecutorStopped`.
- [electron/ipcSender.js](../../../../apps/we-electron/electron/ipcSender.js): `executorSpawnEnv`; [electron/executorLog.js](../../../../apps/we-electron/electron/executorLog.js): the executor's log file.
- The executor and its exit codes: the AD4M repository's executor startup.

</details>
