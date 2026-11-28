# Identity

On the WE side, identity is three things: the **custody service** that keeps the person's master key on a desktop computer, the **identity window** that is the only page that runs a change to it, and the stores that show the identity, its key log and its devices in the app. The identity itself, its key log and the identity store belong to AD4M (ad4m-identity-client and the executor).

**Why:** The custody service holds every secret of a change, and the identity window holds only what a screen shows (`service.rs`). The main window only opens a change and learns how it ended. So the `IdentityStore` never sees the words, the passphrases or the keys.

**Parent:** [Hosts](../README.md)

## Parts

- [Custody](custody.md): `we-custody`, the vault, the flows and the sidecar.
- [Identity window](identity-window.md): `@we/identity-window`, the screens of a change and their transport.
- [Devices](devices.md): `IdentityStore`, `DeviceStore` and the rows that Settings draws.

<details><summary>How it works</summary>

```
main window ─ IdentityStore.open(change) ─► IdentityPort.change (backend-ad4m)
   └─ Ad4mCustodyHost.open(change)  (platform: Electron IPC or Tauri invoke)
        └─► host opens the identity window ─ IdentityTransport ─► custody service
                                              custody service ─ executor RPC (admin credential)
   ◄─ outcome only (done, failed or cancelled) ─ IdentityStore reads the identity again
```

The web target passes no custody host, and the port then offers reads only (`createAd4mIdentityPort`).

</details>

<details><summary>Where in the code</summary>

- [crates/custody/](../../../crates/custody/) and its [README.md](../../../crates/custody/README.md).
- [packages/identity-window/](../../../packages/identity-window/).
- [IdentityStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/IdentityStore.tsx), [DeviceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/DeviceStore.tsx).
- [identityPort.ts](../../../packages/backend-system/ad4m/src/identityPort.ts): `Ad4mCustodyHost`, `Ad4mCustodyState`; the `IdentityPort` contract: [Backend contract](../../data/backend/README.md).

</details>
