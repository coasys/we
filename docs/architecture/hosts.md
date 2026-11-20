# Hosts: a cloud device, a tenant, an operator

A **host** is an executor that takes more than one person (AR-05). One identity meets a host in
three ways, and each has one owner.

| The person is             | What they do                                     | Owned by                                                        |
| ------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Adding a host as a device | Joins with an invite, confirms a match code      | The custody service (`crates/custody`, step `add-cloud-device`) |
| A tenant of a host        | Sees usage, exports, imports, leaves             | `hostStore`, over `HostPort.tenant(url)`                        |
| The operator of a host    | Sets who may join, sends invites, removes people | `hostStore`, over `HostPort.operator`                           |

## Adding a cloud device

The person asks in Settings > Devices. The identity store offers it when the custody service says it
can (`IdentityCapabilities.cloudDevice`: the desktop custody service does, a phone does not) and the
person holds the master key. `addCloudDevice(address?)` opens the identity window on the step:
`{ kind: 'coasys' }` without an address, `{ kind: 'address', url }` with one. The master key never
leaves the person's devices. The custody README ("Cloud devices and hosts") says what the service
does on the way.

## Where Coasys cloud is

One value: `DEFAULT_CLOUD_URL` in `crates/custody/src/cloud.rs`, replaced by `WE_COASYS_CLOUD_URL`.
The custody service puts it in its public state as `cloudUrl`, and `IdentityCustodyView.cloudUrl`
carries it to the app. Nothing in TypeScript holds the address, so a change of domain is one edit.

## The tenant session

`HostPort` is a neutral port (`@we/backend-shared`). `@we/backend-ad4m` implements it
(`hostPort.ts`) when the backend has a custody service.

- **One session client.** The tenant session reuses `keySession.ts` (challenge, login with key,
  renew five minutes before expiry, retry every 30 seconds). Only the signer differs: the local
  executor's `agent.signSessionStatement`, where a browser tab signs with the device key it holds.
  There is no second session client.
- **Lazy.** `tenant(url)` asks nothing. The first call opens the session, so the app never signs in
  to a host the person did not ask about. `usage` is read when the person presses View usage.
- **In memory.** The token lives in the backend port's closure. It is not in a store, a template
  expression or any storage. `close()` ends the session and stops renewing it. `hostStore` keeps one
  session at a time and closes it when the host or the backend changes.

## The held state

A host can hold a tenant. It then answers every call except reading, exporting, `usage` and `leave`
with `not-admitted`. `isNotAdmitted(error)` recognises that refusal, and `hostStore.held` turns true
from it or from `usage.state === 'held'`. The tenant view then says the host holds the account and
offers Export data and Leave only. Any other failure is worded as "Can't reach <host>. Try again."

## Leaving, exporting, importing

- **Leave** keeps the data on the host by default. "Delete my data on this host" destroys the
  tenant's data key at once and is worded as final. "Export my data first" is on by default and
  leaves only once the file is saved.
- **Export** saves the host's gzip file (`.json.gz`, signatures kept) with the save dialog. The file
  is not encrypted, and the screen says so.
- **Import** loads a file into new private spaces. Links that fail the signature check are written
  and counted, and the notice says how many. Joining the spaces the file names
  (`neighbourhoodUrls`) is not done yet.

## The operator view

Where the local executor takes more than one person (`host.info().multiUser`), Settings > This
device shows Sign-ups (who may join, invites with a code shown once) and People (who is on the host,
Remove for someone who left). These calls go through the local executor's own client, so no tenant
session is involved. While the operator has never chosen who may join, `choiceNeeded` is true and the
view says so.

## Where it lives

| Piece                       | Path                                                            |
| --------------------------- | --------------------------------------------------------------- |
| Port types, `isNotAdmitted` | `packages/backend-system/shared/src/host.ts`                    |
| AD4M implementation         | `packages/backend-system/ad4m/src/hostPort.ts`, `keySession.ts` |
| Store                       | `packages/app-shell/src/frameworks/solid/stores/HostStore.tsx`  |
| Wording of rows             | `packages/app-shell/src/shared/hostRows.ts`                     |
| Settings cards              | `packages/templates/shell/src/CloudSettingsPages.ts`            |
| Custody step and address    | `crates/custody/src/cloud.rs`                                   |
