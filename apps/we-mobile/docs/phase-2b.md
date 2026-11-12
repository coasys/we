# Phase 2b: the phone as a full device (design)

This is a design, not a description of code. Phase 2a (see the README) gave the phone a device key
and an enc key sealed by the Android Keystore, a join through an offer link, and key login to a host
executor with renewal. Phase 2b covers the rest of what a device does in an identity: the linking
screens and the camera, the device inbox, taking and holding the master key, asking for it, and
acting as a holder for other devices.

The references are to the ad4m pin WE uses (`ab0038177`): `ad4m-identity-core` (the wire formats),
`ad4m-identity-client` (the flows), `rust-executor/src/api/identity_ws.rs` (the executor's identity
RPCs and their guards) and `identity-store` (the store's routes). They also cite WE's own
`crates/custody/src/service.rs`, the desktop's `IdentityStep` machine.

## The constraint that decides most of this

The phone has no executor of its own. It logs in to a host's executor, which has **its own** device
key in the same identity, or in another one. The executor's identity RPCs split by guard into two
kinds:

- **Operator-only and local-only:** `identity.claimOffer`, `prepareDevice`, `inbox`, `inboxAck`,
  `takeMaster`, `unwrapRecordKey`, `rekey`, `custodyStatus` and `resetLog`. Each acts for _the
  executor's_ device key: it reads the executor's inbox, opens with the executor's enc key, and signs
  with the executor's key. A phone session is neither the operator nor local, and even if it were,
  these calls would act for the wrong key.
- **Capability-guarded pass-throughs:** `status`, `log`, `keyOwner`, `resolve`, `offers`,
  `joinStatus`, `devices`, `record` and `requests` (READ); `openOffer`, `inboxPut`, `recordPut`,
  `postRequest` and `deleteRequest` (UPDATE); `publish`. Most of them carry something the caller
  already signed (`rust-executor/src/identity/types.rs`):
  - `publish` takes signed events (`PublishParams`).
  - `openOffer` takes a `SignedOffer`.
  - `offers`, `inboxPut` and `deleteRequest` take a master-signed `SignedRequest`.
  - `recordPut` takes a sealed record and, optionally, a request.

  The exceptions sign or read with the executor's own key: `postRequest` ("the agent's device key
  signs it") and `requests` ("read with the executor's device key").

So the rule for 2b: **whatever the phone's own key must sign or open, the phone does against the
store directly**, with `X-Coasys-Request` signed in `crates/phone-custody`. **What is already
signed, the phone may send either way.** It goes direct by default, so that one code path works
whichever host it is logged in to, and so that a host executor in another identity is never asked
to carry this identity's traffic.

## Who scans whom

| Situation                                   | Who shows                                                                 | Who scans                     | Flow                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A new phone joins; a computer holds master  | The computer shows its offer QR (`IdentityStep::AddDevice`)               | **The phone**, by camera      | The 2a join: `join({link})` claims, both show the match code, the computer adds                                                           |
| Same, but the camera is refused or broken   | The computer gives the offer link as text                                 | Nobody: the link is pasted    | The same `join`                                                                                                                           |
| The phone holds master; a computer joins    | The computer shows its device code `coasys:device:1:…` (`ShowCode`)       | **The phone**, by camera      | The phone opens an offer bound to that device key and puts an `OfferTicket` in the computer's pre-join inbox (`ScanDevice` on the phone)  |
| The phone holds master; another phone joins | Either way: the new phone shows its code, or the holder shows an offer QR | Whichever has the camera open | As above. The UI offers "show a code" on the joining side as the default, because the holder is the one whose person is already signed in |

A phone never needs to show its device code to a computer: computers rarely have a camera that
can be pointed at a phone. The phone's device code exists only for a phone-to-phone join. When it
is shown, the phone polls its pre-join inbox `pre:<pre_address(sign, r)>`, read with an
`X-Coasys-Inbox` (`PreInboxAuth`) signed by the phone's device key, until the `OfferTicket` arrives.
It then claims the offer the ticket names, exactly as `join` does today.

The camera is a Capacitor barcode plugin, run in Kotlin. It hands JS only the scanned string, and
JS passes that straight back to `DeviceKey.join` or `DeviceKey.addScanned`. The string is parsed and
checked in Rust (`claim::parse_offer`, and `DeviceString` for codes). JS never interprets it.

## The device inbox and taking the master key

**What arrives.** The joined inbox `<scid>/<keyId>` (16 messages, kept 30 days) holds `InboxBody`
messages. Each is signed by a master key under `coasys:inbox` and HPKE-sealed to the device's
X25519 `enc` key. Two bodies concern the phone: `OfferTicket` (pre-join only) and
`Master{did, index, secret}`.

**Reading it.** The phone signs a GET of `/v1/inbox/<scid>/<keyId>` with its device key and gets the
sealed messages. For each message, Rust in `phone-custody` does the following:

1. It unseals the message with the enc seed, which the Keystore opens just for this call.
2. It checks the master signature against the log as it folds it: the signer is a master listed
   at the message's head, and a rotation since then voids the message.
3. It hands the body back as public data with the secret taken out, for example
   `{kind: "master", did, index}`.

**Taking the master key.** This is the phone's version of `ad4m-identity-client`'s `take_master`
(`flows/master.rs:543`). It has the same checks, but over the store instead of `identity.takeMaster`:

1. The key's public half must be `state.masters[index].sign`, and that master must be current.
2. The 32-byte master seed is sealed under a **second** Keystore key,
   `org.coasys.app.master-seeds.v1`. That key is AES-256-GCM, in StrongBox where the phone has
   one and otherwise at the level the Keystore gives (reported, as 2a's is; see "Open questions"
   for `software`), with
   `setUserAuthenticationRequired(true)`, an auth-per-use timeout of 0 and
   `setInvalidatedByBiometricEnrollment(true)`. It is only usable through `BiometricPrompt` with a
   `CryptoObject`. The device-key sealer stays as 2a left it, with no user auth, so key login never
   prompts.
3. The sealed master is written to `no_backup/device-keys/`, beside the device key file.
4. The phone acks the message (`DELETE /v1/inbox/<scid>/<keyId>/<id>`, signed by the device key).
5. The phone writes `holds {keyId, index}` into the private record. See "The private record".

The vault order is the client's: store the key, then ack, then write the record. A crash between
any two steps is retried from the inbox.

**Using the master key.** Each use opens the seed under a fresh biometric prompt, signs inside Rust,
and wipes the seed. The uses are:

- signing an `add`, a revoke or a rotation;
- opening an offer;
- answering a request;
- writing a ticket to another device's inbox.

`Vault` (`ad4m-identity-client/src/vault.rs:235`) is the interface to match. `store_master`,
`master_index` and the staging calls that rotation needs map onto the sealed file plus the
biometric key, and `master_index` reads the authenticated index without a prompt. Each device's
custody note (`custody_note`, `swap_custody_note`) is kept in the same file as its serde JSON and
swapped whole, every layer of its stack compared, under the folder's lock; the vault's own note
(key id `"vault"`, `VAULT_NOTE`) is kept the same way. `vault_id` is 16 random bytes per identity,
drawn at the first ask and written in the same step under that lock, kept in the same file and
never dropped: the record names it beside each `holdsMaster: true`, so a vault counts as one copy.

**Asking for the master key.** The phone joins with `canKeepMaster: true` once 2b ships the
biometric key. 2a claims with `false`, and the holder's `Match` shows `can_keep: false`. A joined
phone without the master key can ask for it with a `DeviceRequestBody::SendMaster {}` posted to
`/v1/requests/<scid>`, signed by the phone's device key. The store refuses a master key here. It
must be posted direct: `identity.postRequest` would post as the host executor's key. A holder
answers it on the person's yes with an `inboxPut` of a `Master` body, and the phone takes it as
above.

## The private record

The record (`/v1/private/<scid>`) is sealed with a record key. Each device has its own entry, which
holds that key sealed to the device (`rust-executor/src/identity/record.rs:234-237`). On a computer the
executor opens its entry (`identity.unwrapRecordKey`, operator-only). The phone unwraps its copy in Rust with its own enc seed, reads and writes the
record over the store with a device-signed request, and never sends the record key to JS or to the
host.

## Acting as a holder

A phone that holds the master key can run the holder's side of `AddDevice` and `ScanDevice`, plus
answering requests, revoking and renaming. These are `ad4m-identity-client`'s flows (`flows/link.rs`,
`requests.rs`, `revoke.rs`), which today run only over `ExecutorRpc`. Each signed object is made on
the phone, and the store or the host's pass-through takes it from there:

- an offer, events (`add`, `revoke`), or an `inboxPut` request.

The match-code screen, which shows the claimer's hint and the code and asks for a name, is a WE
template fragment. The person's yes is a tap followed by a biometric prompt, and nothing else
confirms it.

## Where each step runs

| Step                                        | Phone: Kotlin                                         | Phone: Rust (`phone-custody`)                                                             | WebView JS (WE)                                    | Host executor                        | Store                                                   |
| ------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| Scan a QR                                   | Camera plugin, string to JS                           | —                                                                                         | Passes the string back to the plugin               | —                                    | —                                                       |
| Claim an offer (2a)                         | HTTP POST                                             | `prepare_claim`, `claim_answer`, co-signature                                             | Shows the match code                               | —                                    | `POST /v1/offers/{scid}/{id}/claim`                     |
| Wait for the `add` (2a)                     | HTTP GET                                              | Folds the log, finds its key                                                              | Progress                                           | —                                    | `GET /v1/offers/{scid}/{id}/state`, `/v1/logs/{scid}`   |
| Key login and renewal (2a)                  | Plugin call                                           | `sign_session`                                                                            | `sessionChallenge`, `loginWithKey`, `renewSession` | Checks the statement against the log | —                                                       |
| Show a device code, read the pre-join inbox | HTTP GET                                              | `DeviceString`, `PreInboxAuth`, unseal the `OfferTicket`                                  | Renders the QR                                     | —                                    | `GET /v1/inbox/pre/{address}`                           |
| Read the joined inbox                       | HTTP GET and DELETE                                   | Signs the request, unseals, checks the signer                                             | Shows "a master key is waiting"                    | —                                    | `GET`/`DELETE /v1/inbox/{scid}/{keyId}[/{id}]`          |
| Take the master key                         | `BiometricPrompt` + `CryptoObject`, sealed file write | Checks the key against the log; seed into the sealer                                      | The "keep it on this phone" yes                    | —                                    | Ack, as above                                           |
| Ask for the master key                      | HTTP POST                                             | Signs `SendMaster` with the device key                                                    | Button                                             | —                                    | `POST /v1/requests/{scid}`                              |
| Open an offer / scan a device               | Biometric prompt                                      | Builds and master-signs the `SignedOffer` and the ticket's request; HPKE-seals the ticket | The match-code screen                              | Optional: `openOffer`, `inboxPut`    | `POST /v1/offers/{scid}`, `PUT /v1/inbox/pre/{address}` |
| Add, revoke or rotate                       | Biometric prompt                                      | Builds and signs the events                                                               | Devices page                                       | Optional: `publish`                  | `POST /v1/logs/{scid}/events`                           |
| Answer a request                            | Biometric prompt                                      | Signs the answer (an `inboxPut` of `Master`, or the revoke events)                        | "Your laptop asks for…" screen                     | Optional: `inboxPut`, `publish`      | `GET`/`DELETE /v1/requests/{scid}[/{id}]`, inbox, logs  |
| Private record                              | HTTP GET and PUT                                      | Unwraps the record key, opens, edits and reseals                                          | Device names on the Devices page                   | —                                    | `GET`/`PUT /v1/private/{scid}`                          |

Only public keys, signatures, match codes, hints and progress cross into JS, as in 2a. No seed,
record key or unsealed `Master` body crosses.

## Changes needed in ad4m

1. **A store transport for the flows.** `ad4m-identity-client`'s flows speak only `ExecutorRpc`.
   Of its methods, the pass-throughs map one-to-one onto store routes. The device-key ones
   (`take_master`, `inbox_ack`, `requests`, `post_request`, `record`, `unwrap_record_key`) need a
   signer the caller supplies instead of "the executor's key". The smallest change is a second
   `ExecutorRpc` implementation in the client, `ViaStore`. It would take the store URL, an
   `HttpClient` port, the device-key signer and an enc-key opener, and phone-custody would supply
   those ports over Kotlin's HTTP and the Keystore. That way the flows, and their checks, are not
   rewritten on the phone. The client already has no clock, RNG or network of its own, which
   makes this possible.
2. **The client crate built for Android.** It must build for `aarch64-linux-android` and
   `x86_64-linux-android` without tokio's full runtime (phone-custody is synchronous today and has
   no async runtime). Either the flows get a blocking facade, or phone-custody takes a
   current-thread runtime.
3. **`Ad4mClient` token update on reconnect.** Done in the pin: `Ad4mClient.setToken`
   (`core/src/Ad4mClient.ts:152-155`) uses a token for every later call and the next socket, and
   replaces a socket opened with another. The phone's connector hands it each renewed token, so a
   WebSocket that drops after the first expiry reconnects with the current one.
4. **`--public-origin` on hosts.** With no public origin, an executor accepts login statements only
   for its own loopback origins. Any real host the phone logs in to over `https` must set it to the
   URL the phone dials. This is a deployment requirement to document, not a code change.
5. **Optional: a phone-facing operator view.** If hosts are to show "this phone's inbox has a
   master key waiting" without the phone being open, the executor would need a READ pass-through
   of another key's inbox _headers_. Nothing in 2b depends on it, and the store direct calls cover
   the phone.

## What 2b does not change

- The device key's sealer (no user auth), key login, and the `no_backup` file stay as they are.
- The store's wire formats stay the same: everything above uses the routes and bodies that
  `ad4m-identity-core` already defines.
- WE desktop's custody flows, in `crates/custody`, stay the same. The phone becomes one more
  device they can add, ask and answer.

## Open questions

- Which barcode plugin to use. It must scan in Kotlin with no cloud dependency, and ML Kit's
  bundled model qualifies.
- Whether a phone that has never held the master key should offer "show a code" at all, or only
  "scan".
- A key-host picker: hosts listed in the seed, or typed by URL as the connect screen does today.
- On an emulator the Keystore reports `software` protection (seen in the 2a run). 2b's biometric key
  should refuse to keep a master key under `software` protection unless the person agrees on a
  screen that says so.
