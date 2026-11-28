# Custody

The **custody service** (`we-custody`, in `crates/custody`) keeps the person's master key on a desktop computer and runs the changes to the identity: make the identity, add a device, revoke a device. The Tauri app links it into its main process (`we_custody::spawn`). The Electron app runs it as a sidecar process beside the executor. It reaches the executor only over the executor's RPC with the admin credential.

**Why:** The service holds every secret of a step, and the main window gets only how the step ended and `CustodyPublic` (`service.rs`). Both desktop apps use this one crate for the vault and the flows. Nothing in the crate links the executor, and `tests/boundary.rs` keeps it so. The crate has no Windows version, and Electron starts no custody service on Windows.

**Parent:** [Identity](README.md)

<details><summary>How it works</summary>

1. `DesktopVault` keeps each master key in this computer's store: the macOS keychain behind Touch ID, or sealed under a passphrase (`seal`: Argon2id and XChaCha20-Poly1305) in the Linux Secret Service, or a 0600 file in `custody_dir`. The place is decided for each identity, and a key stays where it already is.
2. `PendingIncepts` keeps the incept of a new identity until its publish is confirmed. A create that did not finish is completed on the next start.
3. `service` runs an `IdentityStep` (`Create`, `AddDevice`, `Revoke {keyId}`) as a series of screens: `show-words`, `confirm-words`, `set-passphrase`, `enter-passphrase`, `identity-ready`, `offer`, `match`, `linked`, `revoke-confirm`, `revoked`, `pending-refused`, `failed`. Each screen comes with an outcome: `done`, `failed`, or none yet.
4. Before each step, the service asks the executor which identity store it uses and whether it trusts it (`identity.status`). With no trusted store, it refuses the step before it makes any words.
5. `CustodyPublic {did, holdsMaster, unlock, blocked}` is the only state that goes to the main window.
6. The sidecar: `we-custody --executor-port <port>`, with the credential in `AD4M_ADMIN_CREDENTIAL`. It reads and writes JSON lines on stdin and stdout with the methods `publicState`, `start`, `step` and `cancel`. When stdin closes, it cancels the open step and exits 0.
7. Electron: `startCustody` spawns it after the executor is ready, and `superviseCustody` restarts it, at most 3 times in 60 s. `custodyBinary()` is the packaged binary, else the crate's release build.

</details>

<details><summary>Where in the code</summary>

- [crates/custody/src/](../../../crates/custody/src/): `vault.rs` (`DesktopVault`), `store.rs`, `seal.rs`, `pending.rs` (`PendingIncepts`), `service.rs` (`IdentityStep`, `Screen`, `CustodyPublic`), `sidecar.rs`, `host.rs` (`custody_dir`), `window.rs`, `bin/we-custody.rs`.
- [crates/custody/tests/](../../../crates/custody/tests/): `boundary.rs`, `sidecar.rs`, `live.rs` (`CUSTODY_LIVE=1`).
- [custodySidecar.js](../../../apps/we-electron/electron/custodySidecar.js): `custodySpawn`, `custodyClient`, `startCustody`, `superviseCustody`.
- [lib.rs](../../../apps/we-tauri/src-tauri/src/lib.rs): `we_custody::spawn`; [commands/identity.rs](../../../apps/we-tauri/src-tauri/src/commands/identity.rs).
- Depth: [crates/custody/README.md](../../../crates/custody/README.md).

</details>
