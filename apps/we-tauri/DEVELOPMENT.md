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

## The main window

The app makes the main window in code (`src-tauri/src/main_window.rs`). In `tauri.conf.json` the
window is `create: false`. Only a window made in code can have a navigation handler and a
new-window handler.

- **Commands.** `build.rs` declares every command in an app manifest. The capability
  `capabilities/main.json` gives the main window its own commands and two event calls
  (`core:event:allow-listen`, `core:event:allow-unlisten`). It gives no other part of the core API
  and no plugin. `capabilities/identity.json` gives the identity window its flow commands only.
  `custody/tests/commands.rs` fails when a window gets a command or a permission that is not on its
  list.
- **Content security policy.** Tauri sends a policy with each page it serves. The policy comes from
  `@we/csp`, the same builder that writes the page's `<meta>` tag. `scripts/generate-seed-config.cjs`
  writes it for the seed into `src-tauri/tauri.seed.conf.json`. `tauri.conf.json` holds the policy
  for WE's own seed; `scripts/tauriConfig.test.ts` keeps the two equal. Tauri does not change
  `style-src` (`dangerousDisableAssetCspModification`): a nonce there turns off `'unsafe-inline'`,
  and the design system needs inline styles.
- **Navigation.** The window stays on the app's pages and on `blob:` addresses of its own origin
  (the app saves a file through one). A frame can load what the policy's `frame-src` permits. On
  Linux and macOS the webview asks the navigation handler for frames too, so the handler lets those
  addresses through. On Windows it asks for the top-level page only, so the app gives the handler
  no `frame-src` address and the window itself can never go to one. The window opens no new
  window: a request for one (`window.open`, a link with `target="_blank"`) opens an `https`
  address in the OS browser. The app refuses all other addresses. The rules are `main_may_navigate` and `opens_in_browser` in `custody/src/window.rs`,
  with their tests.
- **Devtools.** A debug build has the web inspector. A release build has it only with the cargo
  feature `devtools`. `pnpm tauri:dev` turns that feature on; `pnpm tauri:build` does not.
- **Close and the tray icon.** Closing the main window hides it. The app and its executor continue
  to run. The tray icon's menu has "Open" and "Quit". On macOS the app leaves the Dock while the
  window is hidden, unless another of its windows (the identity window) is visible; it leaves the
  Dock when that window closes. On Linux the icon is a StatusNotifierItem, which needs
  `libayatana-appindicator3` (or `libappindicator3`) at run time. Without that library the app
  makes no tray icon and logs a warning. The window hides on close only while a tray host owns
  `org.kde.StatusNotifierWatcher` on the session bus. With no library, no tray host (GNOME without
  an AppIndicator extension) or no session bus, closing the window quits the app, as "Quit" does.
- **One copy.** `tauri-plugin-single-instance` stops a second copy of the same product. A second
  start shows the window of the copy that runs, then exits with code 0. It does nothing before
  that: the plugin decides while `Builder::build` initialises the plugins, and every side effect of
  a start (the log rotation, the webview folder move, the port, the custody service, the executor)
  is in `start`, the app's `setup`, which Tauri runs later. Keep it there; `startup_order` in
  `src/lib.rs` tests the order Tauri runs the two in. The plugin is keyed by the identifier; the
  custody folder and the keychain names are not. So a WE app and a Coasys app can run at the same
  time on the same custody folder.

### Product name and identifier

The seed sets them (`desktop` in the seed, `tauriOf` in `scripts/seed.cjs`). The identifier is
`<appId>.tauri`, or `desktop.tauriId` when the seed sets it. WE's own seed builds "WE",
`io.weco.we.tauri`. `seeds/coasys.seed.json` builds the Coasys app: "Coasys", `org.coasys.app`.

On Linux the webview keeps its data (local storage, IndexedDB, cookies) in
`$XDG_DATA_HOME/<identifier>`. An app with a `tauriId` moves that folder once from
`<appId>.tauri`, before it makes a window (`src-tauri/src/data_folder.rs`). The move is a rename. If
the new folder exists already, the app changes neither folder. Nothing else moves, because the
identifier names nothing else: the executor's data is at `ad4m.dataPath`, and the custody service
keeps the master key in `<data dir>/coasys/custody` and in keychain items with constant names.

## The identity: custody and the identity window

The person's master key never rests in the executor or in a web view. This app links the custody
crate (`crates/custody`, crate `we-custody`) into its main process: where keys rest, the flows, the
identity store, pending identities and how to test it are in `crates/custody/README.md`,
shared with the Electron app, which runs the same crate as a sidecar.

Only the **identity window** runs a flow. Its page is the shared window (`packages/identity-window`)
over the `identity_flow_*` commands, built from `identity/` by `vite.identity.config.ts` into
`dist/identity/` under a strict CSP, with its own capability (`src-tauri/capabilities/identity.json`).
The main window may only open it on a step and read public custody state (`identity_open`,
`identity_public_state`); `build.rs` declares every command in an app manifest so none is callable
without a capability.

The network names the identity store, not WE: the executor's bootstrap seed carries it, and the
mainnet seed's store serves an ordinary build with no configuration. A build on another store passes
`AD4M_IDENTITY_STORE_URL` and `AD4M_IDENTITY_STORE_KEYS` to the executor, from this app's run-time
environment or else from the value the build was compiled with (`option_env!` in
`src-tauri/src/lib.rs`), so a build handed to somebody carries them:

```sh
# A demo build that carries its store. Set both while compiling; cargo rebuilds when they change.
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm tauri:build
```

They are only passed on. Which store the executor uses, and whether it trusts it, the custody
service asks the executor (`identity.status`); with no store, or a store without its key, it
refuses every identity step and the app says why (`crates/custody/README.md`, "The identity
store").

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
