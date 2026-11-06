# we-custody: the desktop apps' master-key custody

The person's master key never rests in the executor or in a web view. Both desktop apps keep it
here: the Tauri app links this crate into its main process, and the Electron app runs it as the
`we-custody` sidecar beside the executor. One implementation of everything that matters — the vault,
the flows, reading the identity store from the executor — for both shells.

`DesktopVault` keeps master keys over the macOS keychain, or sealed under a passphrase (Argon2id,
XChaCha20-Poly1305) in the Linux Secret Service, or in `<data dir>/coasys/custody/<scid>.bin`
(mode 0600) — on Linux where there is no Secret Service (`$XDG_DATA_HOME`), and on macOS where the
build lacks the `keychain-access-groups` entitlement (`~/Library/Application Support`), which the
data-protection keychain requires: an unsigned or ad-hoc-signed build, as a dev build is (the app
writes and deletes a test item once at start: only a write shows the missing entitlement, a read
finds nothing; then a file holds a new key behind a passphrase). The place is
decided per identity, not for the whole app: the folder (`host::custody_dir`) is shared by every
account and both desktop apps on the computer, so each key is used wherever it already rests — a
`<scid>.bin` stays in the file, opened with its passphrase, while another identity's key in the
keychain beside it asks for none — and only a new key goes to the keychain or the Secret Service
when this build can use one. Nothing moves on its own; a key kept on both sides, or a store that
cannot say whether it holds one, is refused rather than guessed at.

The folder is shared; the macOS keychain is not, in practice. A key in the data-protection keychain
is readable only by a build signed with the same `keychain-access-groups` entitlement. The Electron
sidecar carries none, so it reads only the sealed files: a key a signed Tauri build put in the
keychain is not usable from the Electron app, and the identity it belongs to cannot be changed
there. A key in a sealed file opens from either app with its passphrase. On Linux both apps reach
the same Secret Service.

The crate runs the identity client's flows — make the identity, add a device, revoke one — and
reaches the executor only over its RPC with the admin credential. It is its own crate so nothing of
it links the executor; `tests/boundary.rs` keeps it so. No Windows: the desktop apps start there
without identity.

Only the **identity window** runs a flow. Its front end is shared too (`packages/identity-window`);
each app opens it, gates its calls to that window, and answers the main window with how a step
ended — never a screen. See each app's `DEVELOPMENT.md`.

## The sidecar

`we-custody --executor-port <port> [--custody-dir <dir>]`, with the executor's admin credential in
`AD4M_ADMIN_CREDENTIAL` (never an argument: `ps` shows arguments to every user). It takes no
identity store setting: it asks the executor which store it uses, as below. It speaks lines of JSON on stdin and stdout
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

**What is wiped, and what is not.** The master key, the seed and the words are held in `Secret`s and
`Zeroizing` buffers inside this crate, wiped when the step that made them ends. A word or a passphrase
the person types is copied before it gets here — by the window, the host's IPC, the JSON line and
serde — and those copies are not this crate's to wipe; it moves each into a `Secret` on arrival, so it
keeps no copy of its own past the step.

## The identity store

**The network names its identity store, not WE.** The executor's bootstrap seed carries
`identityStore: { url, keys }` — the store's URL and the keys that sign its heads — and the
executor uses that store unless it is given another. WE holds no store URL or key of its own; the
mainnet seed names `https://store.ad4m.dev` and its key, so an ordinary build makes, links and
revokes identities with no configuration. An account set up before seeds carried `identityStore`
keeps its old `mainnet_seed.seed` (both apps run `init` only when there is none); the executor
reads a seed without the field as its compiled-in network's store, so that account needs nothing
either.

A build on another store passes it to the executor as two settings, named as the executor's own CLI
names them: `AD4M_IDENTITY_STORE_URL` (where the store is) and `AD4M_IDENTITY_STORE_KEYS` (its
signing keys, comma-separated multikeys — the executor accepts a head from the store only when one
of these signed it). Given, they win over the seed's store. The Tauri app reads each from its
run-time environment, and otherwise from the value the build was compiled with (`option_env!` in
`apps/we-tauri/src-tauri/src/lib.rs`), so a build handed to somebody carries them; the Electron app
passes its environment to the executor it starts. Either app only passes them on: nothing in WE —
this crate and the sidecar included — reads them to decide anything.

```sh
# A demo Tauri build that carries its store. Set both while compiling; cargo rebuilds when they change.
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm tauri:build

# Development, or to point either app at another store for one run:
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm tauri:dev
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm electron:dev
```

`tests/live.rs` starts a local store and sets both.

**What store the executor uses, and whether it trusts it, is the executor's answer:**
`identity.status` reports `store: { url, trusted } | null`. The custody service asks it before every
step and for its public state (`status_and_store`, `trusted_store` in `src/service.rs`), in the Tauri
app and the sidecar alike; it restates no rule of the executor's. Add a device names `store.url` in
its offer link, which the claiming device publishes through.

**With no store, or one the executor trusts no key for, nothing can make or change an identity, and
the app says so.** That is a network whose seed names no store, or a build that names a store URL
without its key: the executor would refuse every publish (`no-store-keys`). So the custody service
refuses make, add-device and revoke before anything starts — before any words are made — and
reports `blocked` in its public state. The first-run screen then draws "Make my identity here"
disabled with the reason, and "Start now" is the way in. While the executor is not answering yet,
nothing is known and nothing is reported blocked; the step itself asks again.

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
