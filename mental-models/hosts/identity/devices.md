# Devices

Two app-shell stores show the identity in the app. `IdentityStore` reads the identity that this computer's device key speaks for, the person's key log and whether this computer can sign a change. `DeviceStore` reads the device keys that speak for the person, and adds or revokes one. `identityRows.ts` turns the key log and the device list into the rows that Settings draws.

**Why:** Both stores are in the chrome tier only (`keys` and `devices` in `templateSurface.ts`), so a space template never sees who the person is beyond their profile, or the person's devices. A schema cannot format text, so the default words of each row are made once in `identityRows.ts`. Each row also keeps the data that its words come from (`op`, `keys`, the sequence numbers), so a template can say it in different words without parsing a sentence.

**Parent:** [Identity](README.md)

<details><summary>How it works</summary>

1. `IdentityStore` reads `IdentityPort`: `status`, `did`, `keyId`, `keyLog` (as `KeyLogRow`s), `fork`, and `custody` (whether this computer can sign a change).
2. A change goes through `open(change)` or `makeIdentity()`. The store gets back only the outcome (`done`, `cancelled` or `failed`) in `lastOutcome`, then reads everything again. Words, passphrases and keys never reach it.
3. First run: on a computer that can sign changes, when the device key speaks for nobody, `needsFirstRun` asks the person to make an identity. `startWithoutIdentity()` remembers the other choice for that account on this computer.
4. `DeviceStore` reads `IdentityPort.devices`. `devices` lists valid keys first and this computer at the top. `addDevice()` and `revoke(keyId)` are changes like any other, and the list is read again when one ends.
5. `keyLogRows(events, thisKeyId)` and `deviceRows(devices)` name this computer's key `THIS_COMPUTER` ("This computer"). `keyLogRows` names each other key by its id, and `deviceRows` labels it `Device <keyId>`. A key log row's `op` is `incept`, `add`, `revoke` or `rotate`. `shortHash` and `shortDid` shorten what the rows show.

</details>

<details><summary>Where in the code</summary>

- [IdentityStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/IdentityStore.tsx): `IdentityStore`, `startWithoutIdentity`, `needsFirstRun`.
- [DeviceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/DeviceStore.tsx): `DeviceStore`, `addDevice`, `revoke`.
- [identityRows.ts](../../../packages/app-shell/src/shared/identityRows.ts): `KeyLogRow`, `DeviceRow`, `keyLogRows`, `deviceRows`.
- [templateSurface.ts](../../../packages/app-shell/src/shared/registries/templateSurface.ts): the `keys` and `devices` groups.
- The `IdentityPort` contract: [Backend contract](../../data/backend/README.md).

</details>
