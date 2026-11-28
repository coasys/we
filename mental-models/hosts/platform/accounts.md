# Accounts

An **account** is a data directory that holds at most one agent's keys and data. A desktop target keeps a list of accounts, starts the executor against the selected one, and switches by restarting the executor. `AccountStore` is the Solid binding over `PlatformAdapter.accounts`. It reads nothing from the backend, so the boot screen can list accounts before an executor answers.

**Why:** The executor takes one data path at startup and keeps it until it stops, so a switch can only be a restart (`AccountHost` in `shared/platform/types.ts`). All accounts and the registry sit in one container, `<data>/we-accounts/` inside the default data directory. A rename of that one directory moves every account and its metadata together, and Electron and Tauri read the same list (`accounts.js`). The registry does not decide which accounts exist: `list()` scans the disk, and the registry adds names and pictures.

**Parent:** [Platform](README.md)

<details><summary>How it works</summary>

1. At startup the target resolves the data path: the env variable `WE_AD4M_DATA_PATH`, else the selected account, else the seed's default. `pruneAbandoned` first deletes the accounts that this app created and whose setup never finished, except the selected one.
2. `Account.hasAgent` is true when `<data>/ad4m/agent.json` exists, the executor's own marker. The boot screen uses it to choose between the sign-in step and the setup step.
3. `create()` makes an empty directory with a provisional name and no agent. After `applySelection()`, the setup screen asks for the name and the password together, as on a first run.
4. `setDisplay` copies the profile's name and picture to the registry, so the locked sign-in screen can show them.
5. `remove` refuses the active account, and it deletes only a directory that holds AD4M data.
6. `applySelection()` makes the choice take effect: Electron restarts the executor and reloads the window, and Tauri relaunches the app.

The web target has no `accounts`: `accountStore.canManageAccounts` is false and the boot screen shows no account controls.

</details>

<details><summary>Where in the code</summary>

- [shared/platform/types.ts](../../../packages/app-shell/src/shared/platform/types.ts): `Account`, `AccountHost`.
- [stores/AccountStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/AccountStore.tsx): `canManageAccounts`, `switchingTo`.
- [we-electron/electron/accounts.js](../../../apps/we-electron/electron/accounts.js): `createAccountRegistry`, `hasAgent`, `looksLikeAd4mData`, `pruneAbandoned`, `resolveActivePath`.
- [we-tauri/src-tauri/src/accounts.rs](../../../apps/we-tauri/src-tauri/src/accounts.rs): `AccountRegistry`, the same registry in Rust; [commands/accounts.rs](../../../apps/we-tauri/src-tauri/src/commands/accounts.rs).

</details>
