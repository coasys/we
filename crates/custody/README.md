# we-custody: the desktop apps' master-key custody

The person's master key never rests in the executor or in a web view. Both desktop apps keep it
here: the Tauri app links this crate into its main process, and the Electron app runs it as the
`we-custody` sidecar beside the executor. One implementation of everything that matters — the vault,
the flows, the identity store settings — for both shells.

`DesktopVault` keeps master keys over the macOS keychain, or sealed under a passphrase (Argon2id,
XChaCha20-Poly1305) in the Linux Secret Service, or in `<data dir>/coasys/custody/<scid>.bin`
(mode 0600) — on Linux where there is no Secret Service (`$XDG_DATA_HOME`), and on macOS where the
build lacks the `keychain-access-groups` entitlement (`~/Library/Application Support`), which the
data-protection keychain requires: an unsigned or ad-hoc-signed build, as a dev build is (the app
asks the keychain once at start, and a file holds a new key behind a passphrase). The place is
decided per identity, not for the whole app: the folder (`host::custody_dir`) is shared by every
account and both desktop apps on the computer, so each key is used wherever it already rests — a
`<scid>.bin` stays in the file, opened with its passphrase, while another identity's key in the
keychain beside it asks for none — and only a new key goes to the keychain or the Secret Service
when this build can use one. Nothing moves on its own; a key kept on both sides, or a store that
cannot say whether it holds one, is refused rather than guessed at.

The crate runs the identity client's flows — make the identity, add a device, revoke one — and
reaches the executor only over its RPC with the admin credential. It is its own crate so nothing of
it links the executor; `tests/boundary.rs` keeps it so. No Windows: the desktop apps start there
without identity.

Only the **identity window** runs a flow. Its front end is shared too (`packages/identity-window`);
each app opens it, gates its calls to that window, and answers the main window with how a step
ended — never a screen. See each app's `DEVELOPMENT.md`.

## The sidecar

`we-custody --executor-port <port> [--custody-dir <dir>]`, with the executor's admin credential in
`AD4M_ADMIN_CREDENTIAL` (never an argument: `ps` shows arguments to every user) and the identity
store settings in the environment, as below. It speaks lines of JSON on stdin and stdout
(`src/sidecar.rs`):

```text
→ {"id": 1, "method": "start", "params": {"step": {"kind": "create"}}}
← {"id": 1, "result": {"screen": {"screen": "show-words", "words": […]}, "outcome": null}}
```

| Method        | Params    | Result                                        |
| ------------- | --------- | --------------------------------------------- |
| `publicState` |           | `CustodyPublic`                               |
| `start`       | `{step}`  | `{screen, outcome}` — the step's first screen |
| `step`        | `{input}` | `{screen, outcome}` — the next screen         |
| `cancel`      |           | `null`; the open step is ended and wiped      |

`outcome` is `done`, `failed` or `null` until a screen ends the step. Failures are
`{"id", "error": "<sentence>"}`, and a line that is not a request is answered with `"id": null`. No
error repeats what a request carried. Answers come as they are ready, not in order: a `wait-claim`
step can wait for minutes while `cancel` and `publicState` are answered. When stdin closes the open
step is cancelled and the process exits 0, so it never outlives its host; a bad configuration exits 2.
Log lines go to stderr and carry no secret.

## The identity store

The executor's identity store is two settings, named as the executor's own CLI names them:
`AD4M_IDENTITY_STORE_URL` (where the store is) and `AD4M_IDENTITY_STORE_KEYS` (the store's signing
keys, comma-separated multikeys — the executor accepts a head from the store only when one of these
signed it). `host::StoreSettings` reads them for both apps. The Tauri app also takes the values the
build was compiled with (`option_env!`), so a build handed to somebody carries them; the Electron
app passes its environment to the executor and the sidecar alike.

```sh
# A demo Tauri build that carries its store. Set both while compiling; cargo rebuilds when they change.
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm tauri:build

# Development, or to point either app at another store for one run:
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm tauri:dev
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm electron:dev
```

No store is deployed for the apps yet, so there are no values to give here; use those of the store
you run (`tests/live.rs` starts a local one).

**A build with no store key cannot make or change an identity, and says so.** The executor would
refuse every publish (it trusts no head the store could answer), so the custody service refuses
make, add-device and revoke before anything starts — before any words are made — and reports
`blocked` in its public state. The first-run screen then draws "Make my identity here" disabled with
the reason, and "Start now" is the way in. Without a URL the agent language keeps its own store
setting, and Add a device cannot make an offer link.

The executor's agent language has to serve identity: the default mainnet agent language answers a
publish with "the agent language does not serve identity-append". ad4m's identity suite, and
`tests/live.rs`, run the executor with the centralized agent language for that reason.

## Pending identities

`create` keeps the identity's incept in `<custody dir>/pending-incepts.json` until its publish is
confirmed, and the next attempt publishes it again. That folder is shared by every account on the
computer, so an account only finishes — or reports — an incept that lists its own executor's device
key. An incept that can never be published is not retried forever: one whose executor already
speaks for another identity is forgotten, and one the store refused for good (its key already in a
key log, a different log under its identifier, an event it calls invalid) is shown with its cause
when the person next makes an identity, with "Discard it" to forget it. Discarding forgets the
incept only; the master key stays where it rests.

## Testing

```sh
cd crates/custody
cargo test                       # vault, sealing, screens, the sidecar, command table, the executor boundary
```

It builds against the ad4m commit WE pins, by git (`Cargo.toml`; `tests/boundary.rs` fails if that
rev and `package.json`'s pin differ). Against a local ad4m checkout at that commit:

```sh
A=<ad4m>; P='patch."https://github.com/coasys/ad4m"'
cargo test --config "$P.ad4m-identity-client.path=\"$A/ad4m-identity-client\"" \
  --config "$P.ad4m-identity-core.path=\"$A/ad4m-identity-core\"" \
  --config "$P.ad4m-client.path=\"$A/rust-client\""
```

The end-to-end test runs the three flows against a real identity-store and two real executors; see
the header of `tests/live.rs` for what it needs:

```sh
CUSTODY_LIVE=1 AD4M_REPO=<ad4m> cargo test --features cheap-kdf --test live -- --nocapture
```

In the Tauri app build the generated `Cargo.toml` patches this crate's ad4m crates to the seed's
checkout (`apps/we-tauri/src-tauri/Cargo.toml.template`), so there is one ad4m in the binary.
