# WE Tauri Development

## Prerequisites

### Required: AD4M Monorepo

This project uses relative paths to access the AD4M monorepo. The structure that works with the current paths is:

```
/path/to/projects/
├── we/           (this repo)
└── ad4m/         (AD4M monorepo - required)
```

**If your repositories are in a different location**, update the paths in `src-tauri/Cargo.toml`:

- `../../../../ad4m/rust-client`
- `../../../../ad4m/rust-executor`

## Development Workflow

### Running the Launcher

```bash
pnpm tauri:dev
```

This starts the Tauri app with AD4M integration.

## Building for Production

```bash
pnpm tauri:build
```

This creates a production build. If embedded apps (like Flux) are configured, they will be bundled using Tauri's resource system.

## Executor Logs

Every run is logged to `ad4m.log` in the active account's data directory — `~/.ad4m/ad4m.log` for the
default account, `~/.ad4m/we-accounts/<slug>/ad4m.log` for one WE created — keeping the last five runs
(`ad4m.log`, then `ad4m.1.log` … `ad4m.4.log`), each capped at 50 MB. The Electron host writes the same
files by the same rules.

The executor runs in this process, so the file is its logger's target rather than a copy of stdout: it
holds everything logged through the `log` crate (the executor, Holochain, JS `console.*`) plus panics,
and lines marked `HOST` from `src/lib.rs`. A bare `println!` reaches the terminal only. See
`src/executor_log.rs`.

## The identity: custody and the identity window

The person's master key never rests in the executor or in a web view. The shell keeps it in
`src-tauri/custody` (crate `we-custody`): `DesktopVault` over the macOS keychain, or sealed under a
passphrase (Argon2id, XChaCha20-Poly1305) in the Linux Secret Service, or in
`<data dir>/coasys/custody/<scid>.bin` (mode 0600) — on Linux where there is no Secret Service
(`$XDG_DATA_HOME`), and on macOS where the build lacks the `keychain-access-groups` entitlement
(`~/Library/Application Support`), which the data-protection keychain requires: an unsigned or
ad-hoc-signed build, as a dev build is (the app asks the keychain once at start, and a file holds
a new key behind a passphrase). The place is decided per identity, not for the whole app: the
folder is shared by every account on the computer, so each key is used wherever it already rests
— a `<scid>.bin` stays in the file, opened with its passphrase, while another identity's key in
the keychain beside it asks for none — and only a new key goes to the keychain or the Secret
Service when this build can use one. Nothing moves on its own; a key kept on both sides, or a
store that cannot say whether it holds one, is refused rather than guessed at. The crate runs the
identity client's flows — make the identity, add a device, revoke one — and reaches the executor only over
its RPC with the admin credential. It is its own crate so nothing of it links the executor;
`custody/tests/boundary.rs` keeps it so.

Only the **identity window** runs a flow. It is a separate bundle (`identity/`, built by
`vite.identity.config.ts` into `dist/identity/`) under a strict CSP, with its own capability
(`src-tauri/capabilities/identity.json`). The main window may only open it on a step and read public
custody state (`identity_open`, `identity_public_state`); `build.rs` declares every command in an app
manifest so none is callable without a capability.

### The identity store

The executor's identity store is two settings, named as the executor's own CLI names them:
`AD4M_IDENTITY_STORE_URL` (where the store is) and `AD4M_IDENTITY_STORE_KEYS` (the store's signing
keys, comma-separated multikeys — the executor accepts a head from the store only when one of
these signed it). The app reads each from its run-time environment, and otherwise from the value
the build was compiled with (`option_env!` in `src-tauri/src/lib.rs`), so a build handed to
somebody carries them:

```sh
# A demo build that carries its store. Set both while compiling; cargo rebuilds when they change.
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm tauri:build

# Development, or to point a built app at another store for one run (overrides what it carries):
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm tauri:dev
```

No store is deployed for the app yet, so there are no values to give here; use those of the store
you run (`custody/tests/live.rs` starts a local one).

**A build with no store key cannot make or change an identity, and says so.** The executor would
refuse every publish (it trusts no head the store could answer), so the custody service refuses
make, add-device and revoke before anything starts — before any words are made — and reports
`blocked` in its public state. The first-run screen then draws "Make my identity here" disabled with
the reason, and "Start now" is the way in. Without a URL the agent language keeps its own store
setting, and Add a device cannot make an offer link.

### Pending identities

`create` keeps the identity's incept in `<custody dir>/pending-incepts.json` until its publish is
confirmed, and the next attempt publishes it again. That folder is shared by every account on the
computer, so an account only finishes — or reports — an incept that lists its own executor's device
key. An incept that can never be published is not retried forever: one whose executor already
speaks for another identity is forgotten, and one the store refused for good (its key already in a
key log, a different log under its identifier, an event it calls invalid) is shown with its cause
when the person next makes an identity, with "Discard it" to forget it. Discarding forgets the
incept only; the master key stays where it rests.

### Testing the custody crate

```sh
cd src-tauri/custody
cargo test                       # vault, sealing, screens, command table, the executor boundary
```

It builds against the ad4m commit WE pins, by git (`custody/Cargo.toml`; `tests/boundary.rs` fails
if that rev and `package.json`'s pin differ). Against a local ad4m checkout at that commit:

```sh
A=<ad4m>; P='patch."https://github.com/coasys/ad4m"'
cargo test --config "$P.ad4m-identity-client.path=\"$A/ad4m-identity-client\"" \
  --config "$P.ad4m-identity-core.path=\"$A/ad4m-identity-core\"" \
  --config "$P.ad4m-client.path=\"$A/rust-client\""
```

The end-to-end test runs the three flows against a real identity-store and two real executors; see
the header of `custody/tests/live.rs` for what it needs:

```sh
CUSTODY_LIVE=1 AD4M_REPO=<ad4m> cargo test --features cheap-kdf --test live -- --nocapture
```

In the app build the generated `Cargo.toml` patches the custody crate's ad4m crates to the seed's
checkout (`Cargo.toml.template`), so there is one ad4m in the binary.

## Optional: Embedding External Apps

The Tauri launcher can embed external apps via iframe. This section uses Flux as an example, but the pattern works for any app.

### 1. Repository Structure

```
/path/to/projects/
├── we/           (this repo)
├── ad4m/         (AD4M monorepo - required)
└── flux/         (Flux monorepo - optional example)
```

### 2. Configure Paths

Update these files to point to your embedded app:

**package.json** → `../../../flux/app/dist` (for dev server)
**src-tauri/tauri.conf.json** → `../../../../flux/app/dist` (for production bundle)

### 3. Build Your Embedded App

```bash
cd ../../../flux/app
pnpm install
pnpm build
```

### 4. Development

Simply run `pnpm tauri:dev` as shown above. The launcher will look for embedded apps in the configured paths.

### 5. Integration Protocol

Embedded apps receive AD4M credentials via postMessage. See [`embedding-external-apps.md`](../../docs/guides/embedding-external-apps.md) for the complete protocol and implementation details.

### 6. Tauri-Specific Notes

**Screen Sharing:** Works natively in Tauri without polyfills (unlike Electron).

**Resource Bundling:** Embedded apps are bundled at build time via `tauri.conf.json` resources configuration.

**Development:** The Tauri dev server will serve embedded apps from the configured paths. Make sure your embedded app is built before running `pnpm tauri:dev`.

## Embedding Your Own Apps

To embed your own app (not Flux):

1. Build your app to a `dist` directory
2. Update `package.json` scripts to serve your app on a local port (for dev)
3. Update `src-tauri/tauri.conf.json` resources to bundle your app (for production)
4. Implement the postMessage protocol in your app (see `../../docs/guides/embedding-external-apps.md`)
5. Update the launcher's routing to display your app's iframe
