# WE Electron Development

## Development Workflow

To run in development mode:

```bash
pnpm electron:dev
```

This will:

1. Start the Vite dev server on an available port (typically 3002)
2. Wait for the dev server to be ready
3. Launch Electron which will:
   - Start the AD4M executor on a free port (12000-13000)
   - Generate a unique credential token
   - Load the Vite dev server in the Electron window
   - Open DevTools automatically

## Building for Production

To build for production:

```bash
pnpm electron:build
```

This will:

1. Build the renderer with Vite
2. Package the app with Electron Builder
3. Include the executor binary and any embedded apps (like Flux)
4. Output to `dist-electron/`

The production build creates:

- AppImage for Linux
- DMG and ZIP for macOS
- Can be configured for Windows (NSIS)

### Builds from CI

`.github/workflows/electron-package.yaml` runs when a release is tagged (`v0.1.0-alpha.1`, pushed
to `main` after `dev` is merged into it). It builds the executor from the commit the pinned
`@coasys/ad4m` was published from, packages the app, and publishes both as a GitHub release. The tag
must match the `version` in the root `package.json`, or the run stops before building anything.

It does not run on merges or pull requests. To package a branch, run the workflow manually from the
Actions tab: pick the branch, and optionally set `ad4m_ref` to build the executor from another AD4M
branch or commit. A manual run publishes nothing; download its builds from the run's **Artifacts**
section (signed-in GitHub account required). They are kept for 14 days.

Releases are Linux only for now. The executor cannot be compiled on macOS at the moment, because a
dependency downloads a prebuilt ONNX Runtime that is no longer published for macOS. A manual run can
still include macOS (the `mac` input) once that is fixed.

The macOS build is **unsigned**, so a downloaded copy is quarantined and macOS reports it as
damaged. Clear the quarantine flag after moving the app to Applications:

```bash
xattr -cr /Applications/WE.app
```

## The executor: how the app runs it

The app starts the person's AD4M executor as a child process and supervises it by the executor's
run contract (ad4m `rust-executor/src/exit.rs`, `docs-src/pages/developer-guides/executor-config.mdx`).
The arguments are `executorArgs` in `electron/executorProcess.js`:

- `--watch-stdin true`: stdin is a pipe the app holds open after writing one line to it, the custody
  credential (below). Closing it stops the
  executor gracefully (exit 0); that is how Quit, an account switch and a restart stop it. If the
  app dies, the OS closes the pipe and the executor stops with it. SIGTERM, then SIGKILL, only if it
  has not gone within 10 s (`stopChild`).
- `--config <data folder>/executor-config.json`: the executor's settings. The app creates the file
  the first time it starts an executor on a data folder, mode 0600, from the MCP and log settings an
  older build kept in the account registry, with `auto_permit_cap_requests: true` (what an executor
  without a config file does). After that the file is the executor's: the settings page writes it
  through `runtime.setConfig`, and a change takes effect at the next start. Port, data folder, log
  folder and the dapp server stay flags, so the executor reports them as pinned.
- `--log-dir <data folder>/logs`: the executor's own log, one file per run, five runs kept
  (`executor-0.log` is this run). `runtime.logTail` reads it. `ad4m.log` (below) keeps this app's
  `HOST` lines and what the executor still prints to stdout.
- `--custody-channel true`: opens `identity.custodyStatus` to the custody service beside it. That
  service connects with the **custody credential**, which the app makes afresh at every start beside
  the admin credential and which is never the same as it. The executor reads it from the first line
  of its stdin, which the app writes right after the spawn, before waiting for the executor to
  answer (`custodyCredentialLine`). It is never an argument and never in the environment: the window's
  admin credential could read an environment back through the executor (`/proc/<pid>/environ`), and
  the custody guard exists to keep the window away from `identity.takeMaster`. The executor refuses
  to start (78, not restarted) with `AD4M_CUSTODY_CREDENTIAL` or `AD4M_CUSTODY_CREDENTIAL_FILE` set,
  so the app strips both from every child's environment (`withoutCustodyCredential`).

What the app does when the executor exits (`afterExecutorExit`):

| Code               | Meaning                                | The app                                                                                                                                  |
| ------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0                  | stopped on request                     | nothing more                                                                                                                             |
| 75                 | `runtime.restart`                      | starts it again at once with the same arguments (port and credential), and reloads the window                                            |
| 78                 | config or a flag refused               | does not restart; shows the executor's last lines and the config file to fix                                                             |
| 79                 | another executor holds the data folder | does not restart; says so                                                                                                                |
| 80                 | port taken                             | starts it again on a new port                                                                                                            |
| other, or a signal | crash                                  | starts it again after 1 s, 2 s, 4 s … up to 30 s; the count starts over after a minute up; after 6 crashes in a row it stops and says so |

On the first start, before the window exists, 78 and 79 end in the "could not start" box with the
reason, and 80 tries another port up to three times.

### An executor already running (external mode)

With `WE_EXTERNAL_AD4M_PORT` and `WE_EXTERNAL_AD4M_TOKEN` set, the app starts no executor and uses
the one on that port with that admin credential. Identity needs a third value,
`WE_EXTERNAL_AD4M_CUSTODY_CREDENTIAL`, the credential that executor's custody channel admits; without
it identity is off. The app reads it once, deletes it from its own environment, strips it from every
child it starts, and hands it to the custody sidecar on the sidecar's stdin only. It never passes it
to the executor: **whoever runs that executor delivers the same value to it**, as the first line of
its stdin, with `--custody-channel true` and with neither `AD4M_CUSTODY_CREDENTIAL` nor
`AD4M_CUSTODY_CREDENTIAL_FILE` in its environment (it refuses to start otherwise). For example, with
a credential different from the admin one:

```bash
CUSTODY=$(uuidgen)
mkfifo /tmp/we-custody-in
( echo "$CUSTODY"; exec sleep infinity ) > /tmp/we-custody-in &   # holds stdin open
AD4M_ADMIN_CREDENTIAL=<admin> ad4m-executor run --custody-channel true --watch-stdin true … < /tmp/we-custody-in &
WE_EXTERNAL_AD4M_PORT=<port> WE_EXTERNAL_AD4M_TOKEN=<admin> WE_EXTERNAL_AD4M_CUSTODY_CREDENTIAL="$CUSTODY" pnpm electron:dev
```

External mode is for development. Its one weakness: the app's own initial environment
(`/proc/<pid>/environ` of the Electron main process) still holds the variable it was started with,
since deleting it changes only what children inherit. A started executor has no such leftover — the
app makes its custody credential itself and never puts it in an environment.

Settings → Devices → This computer → Advanced → **Executor settings** lists the config file's keys,
offers a control for each one the executor lets this machine change, says a change takes effect at
the next start, offers **Restart now** (`runtime.restart`), and shows the log tail. It goes through
`RuntimeAdminPort` (`executorConfig`, `setExecutorConfig`, `restartExecutor`, `executorLogTail`);
the MCP and log-level controls above it write the same file.

### The tray icon and closing the window

Closing the main window hides it; the app and its executor keep running. The tray icon's menu has
"Open <product>" and "Quit <product>"; Quit stops the executor (stdin closes) and quits. On macOS
the app leaves the Dock while the window is hidden, and a click on the Dock icon opens it again. On
Linux the icon is a StatusNotifierItem and shows only while a tray host owns
`org.kde.StatusNotifierWatcher` on the session bus; without one (GNOME without an AppIndicator
extension, no session bus) closing the window quits the app, as Quit does, and the app logs
`[tray] No tray host …`. See `electron/tray.js`.

## The identity: custody and the identity window

The person's master key never rests in the executor or in a web view. This app runs the custody
crate (`crates/custody`) as the `we-custody` sidecar: where keys rest, the flows, the sidecar's
protocol, the identity store settings and how to test it are in `crates/custody/README.md`, shared
with the Tauri app, which links the same crate.

- **The sidecar** (`electron/custodySidecar.js`) starts once the executor answers, against its port,
  with the custody credential as the first line of its stdin — never on its command line or in its
  environment, and the admin credential does not reach it at all. It stops with the
  executor (an account switch, a settings restart, quitting), and exits on its own when this process
  goes, because its stdin closes. In development it is the crate's release build
  (`crates/custody/target/release/we-custody`); packaged, `resources/we-custody` beside the executor.
  `pnpm electron:dev` and `pnpm electron:build` build it (`scripts/build-custody.mjs`, which needs
  Rust; in development a failed build only turns identity off).
- **The identity window** (`electron/identityWindow.js`, opened by `main.js`) is the only page that
  runs a flow. Its page is the shared window (`packages/identity-window`) built from `identity/` by
  `vite.identity.config.ts` into `dist/identity/`, under the window's strict CSP. It is served on its
  own scheme (`we-identity://window/`) in its own in-memory session, from the built bundle in
  development too, so it shares nothing with the app. It is sandboxed, has its own preload
  (`electron/identityPreload.js`) exposing only its four calls, may not navigate or open windows,
  and has no inspector in a packaged build.
- **The main window** may only open it on a step (`identity-open`, which resolves with how the step
  ended) and read public custody state (`identity-public-state`). One identity window at a time:
  asking again focuses it and starts nothing; closing it mid-step cancels the step. `ipcSender.js`
  answers each channel for its own window only. No word, passphrase or key reaches the main window.
- **The steps** it may open are the custody service's (`crates/custody/README.md`, "Devices and the
  master key"): make the identity, add a server by link, scan or paste a new device's code, show
  this computer's code, take or ask for the master key, answer another device's request, name a
  device, revoke one (and replace the master key with it), replace the master key with the 12
  words, restore the identity from them, remove the master key from this computer on log out.
  `identityWindow.js` refuses any other step, and a step that names a device or
  a request without one.

The network names the identity store, not WE: the executor's bootstrap seed carries it, and the
mainnet seed's store serves the app with no configuration. To use another store, set it in the
environment, which this app passes on to the executor it starts:

```bash
AD4M_IDENTITY_STORE_URL=<store url> AD4M_IDENTITY_STORE_KEYS=<store key> pnpm electron:dev
```

The sidecar reads neither. Which store the executor uses, and whether it trusts it, the sidecar asks
the executor (`identity.status`), as the Tauri app does; with no store, or a store URL without its
key, it reports identity `blocked` and the first-run screen says why (`crates/custody/README.md`,
"The identity store").

Linux and macOS only. On Windows the app starts without identity: the preload exposes none, so the
shell treats it as an app that keeps no master key, as it does the web. On macOS the sidecar is a separate executable, so a signed build
needs the keychain entitlement on it too; an unsigned one keeps keys in the sealed file.

## Optional: Embedding External Apps (e.g., Flux)

The Electron launcher can embed external apps via iframe. Here's how to set up Flux as an example:

### 1. Repository Structure

```
/path/to/projects/
├── we/           (this repo)
├── ad4m/         (AD4M monorepo - required)
└── flux/         (Flux monorepo - optional)
```

### 2. Build Flux

```bash
cd ../../../flux/app
pnpm install
pnpm build
```

This creates `flux/app/dist/` which the Electron app will serve.

### 3. Development with Flux

The Electron app automatically serves Flux in production builds from the bundled resources. In development, you can:

**Option A: Use Flux dev server**

```bash
# Terminal 1: Start Flux dev server
cd ../../../flux/app
pnpm dev  # Runs on port 3030

# Terminal 2: Start Electron
cd we/apps/we-electron
pnpm electron:dev
```

**Option B: Use Flux production build**
Just build Flux once and the Electron app will serve it from `dist/`.

### 4. How It Works

**Development:**

- Launcher: Uses Vite dev server on available port (set via `VITE_DEV_SERVER_URL`)
- Flux iframe: `http://localhost:3030` (Flux dev server, if running)

**Production:**

- Launcher: `http://localhost:9080` (Express server)
- Flux iframe: `http://localhost:8080` (Express server)

Both are served via HTTP (not `file://`) to avoid cross-origin issues.

### 5. Development vs Production Mode

The app automatically detects whether it's running in development or production:

- **Development:** Uses `import.meta.env.DEV` from Vite (true in dev server, false in build)
- **Platform adapter** exposes `isDevelopment` flag to the app
- **Flux URL** switches automatically based on this flag:
  - Dev: `http://localhost:3030` (expects Flux dev server)
  - Prod: `http://localhost:8080` (serves bundled Flux)

This is configured in `LauncherTemplate.schema.ts` using conditional rendering based on `adamStore.isDevelopment`.

### 6. Screen Sharing in Embedded Apps

Electron requires special handling for `getDisplayMedia()` in iframes:

- A polyfill is automatically injected into embedded apps
- The polyfill uses Electron's `desktopCapturer` API
- Works by accessing parent window's `window.electron` API
- Requires `webSecurity: false` in BrowserWindow config

## Troubleshooting

### Electron Binary Not Downloading

If Electron fails to download its binary after `pnpm install`, this is due to pnpm workspace behavior with lifecycle scripts.

The `postinstall` script in `package.json` handles this automatically:

```json
"postinstall": "cd ../../node_modules/.pnpm/electron@*/node_modules/electron 2>/dev/null && node install.js || true"
```

This workaround ensures Electron's install script runs even in pnpm workspaces. The `.npmrc` file in the workspace root also enables lifecycle scripts with `enable-pre-post-scripts=true`.

### Login Hangs After HMR Update (Dev Mode)

If login hangs with a timeout after Hot Module Reload updates in dev mode:

**Cause:** HMR can break the WebSocket connection to the AD4M executor while keeping stale connection references.

**Solution:** Refresh the browser (Ctrl+R / Cmd+R) instead of relying on HMR after code changes that affect the Apollo client or WebSocket connections.

See `electron/main.js` for implementation details.

### 6. Integration Protocol

Embedded apps receive AD4M credentials via postMessage. See [`embedding-external-apps.md`](../../docs/guides/embedding-external-apps.md) for the complete protocol.

## Troubleshooting

### Executor Logs

Every executor run is logged to `ad4m.log` in the active account's data directory — `~/.ad4m/ad4m.log`
for the default account, `~/.ad4m/we-accounts/<slug>/ad4m.log` for one WE created. The path is
printed at startup (`[main] Executor log: …`).

- The last five runs are kept: `ad4m.log` is the current one, `ad4m.1.log` the one before, down to `ad4m.4.log`.
- Lines marked `HOST` come from `electron/main.js` — the path and binary it chose, the stale files it
  cleaned up, the exit code — and sit beside the executor's own output.
- The app's trace lines (`we:trace …`) are copied in as `HOST` lines too. A development build traces
  `interpretation` by default: each auto-processor step and each settled watched pass. A production
  build traces nothing until `localStorage.setItem('we:trace', '<scopes>')` (scopes in
  `installConsoleTrace.ts`). The Electron host copies them; the Tauri host does not yet.
- Each file stops at 50 MB and says so. Raise detail with the per-crate log levels in Settings.
- The executor's own log is in `<data folder>/logs/executor-<n>.log` (see "The executor: how the
  app runs it").

The Tauri host writes the same files by the same rules. See `electron/executorLog.js`.

### Executor Binary Not Found

Make sure you've built the AD4M executor:

```bash
cd ../../ad4m/cli
cargo build --release
```

### Embedded App Not Loading

Check the console for errors. Common issues:

- Flux not built (run `pnpm build` in flux/app)
- Wrong port configuration
- Missing postMessage request (see embedding-external-apps.md (docs/guides))

### Login Hangs After HMR Update (Dev Mode)

If login hangs with a timeout after Hot Module Reload updates in dev mode:

**Cause:** HMR can break the WebSocket connection to the AD4M executor while keeping stale connection references.

**Solution:** Refresh the browser (Ctrl+R / Cmd+R) instead of relying on HMR after code changes that affect the Apollo client or WebSocket connections.

### Electron Binary Not Downloading

If Electron fails to download its binary after `pnpm install`, this is due to pnpm workspace behavior with lifecycle scripts.

The `postinstall` script in `package.json` handles this automatically:

```json
"postinstall": "cd ../../node_modules/.pnpm/electron@*/node_modules/electron 2>/dev/null && node install.js || true"
```

This workaround ensures Electron's install script runs even in pnpm workspaces. The `.npmrc` file in the workspace root also enables lifecycle scripts with `enable-pre-post-scripts=true`.

### Screen Sharing Not Working

- Check that the polyfill is being injected (look for logs in console)
- Verify `webSecurity: false` in main.js
- Check that `window.electron.getDesktopSources` exists

### Build Fails

If the build fails, check:

- `package.json` extraResources paths are correct
- AD4M executor binary exists
- Flux dist folder exists (if bundling Flux)
