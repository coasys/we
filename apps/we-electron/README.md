# WE Electron App

Electron desktop application for the WE platform. This launcher uses the `@we/app-shell` package to provide a cross-platform AD4M-powered interface, with Electron-specific platform adapters.

## Installation

```bash
# Install dependencies (Electron binary downloads automatically via postinstall script)
pnpm install
```

**Note:** The `.npmrc` file in the workspace root enables lifecycle scripts for Electron binary download. The `postinstall` script in `package.json` ensures this works correctly in pnpm workspaces.

## What This App Does

The WE Electron launcher:

- Spawns and manages the AD4M executor as a child process
- Provides a SolidJS-based interface using `@we/app-shell`
- Supports embedding external apps via iframe (e.g., Flux, custom apps)
- Handles platform-specific concerns like IPC, screen sharing, and process management

## Architecture

- **Main Process** (`electron/main.js`):
  - Starts the AD4M executor as a child process
  - Manages HTTP servers for launcher and embedded apps
  - Handles IPC for AD4M connection details (port/token)
  - Implements screen sharing polyfill for embedded apps
- **Preload Script** (`electron/preload.js`): Exposes secure IPC bridge via `window.electron`
- **Renderer** (`src/`): SolidJS app using the shared `@we/app-shell`. It renders `BaseBoot` with the
  desktop host from `@we/app-coasys/hosts/desktop`: the deployment's app before a session (first run,
  where to connect, the executor starting or failed), then WE's app once a place is chosen
- **Platform Adapter** (`src/platform/electronAdapter.ts`): Implements AD4M connection using Electron IPC

## How it Works

Unlike the Tauri app which embeds the Rust executor as a library, the Electron app:

1. Spawns the `ad4m-executor` binary as a separate child process
2. Passes configuration via command-line arguments (port, token, data path)
3. Communicates with the frontend via IPC to provide connection details
4. The renderer uses these details to connect to the executor's GraphQL API

The window opens before the executor is up. The main process sends the executor's state to the
window (`executor-state`: `starting`, `ready`, or `failed` with a reason that names no path), and the
window asks for another try with `executor-start`. An executor that fails to start is a screen in the
app with "Try again", not a dialog and a quit. `main.executor-failed.test.js` covers this. The
reason's words come from `electron/executorWords.js`: a system error (a data folder it cannot write)
is told by its code, and any other message has its paths replaced (`executorWords.test.js`).

### The main agent, made and unlocked with no password (a stopgap until AR-06)

The identity window's steps run in custody against the executor's main agent, so it must exist and
be unlocked before the app before a session opens a door. Once the executor answers, the supervisor
makes sure of that (`electron/mainAgent.js`): on the first start it keeps a random passphrase in this
computer's keyring and makes the agent with it (`agent.generate`); on every start after, it reads the
passphrase and unlocks the agent (`agent.unlock`), with no prompt. The keyring is custody's own
(`we-custody wallet-passphrase`, `crates/custody/src/wallet.rs`): the Secret Service on Linux, with
the same 90 s bound on a locked keyring; the login keychain on macOS. There is one item per executor
data folder. `ready` then carries `agent: 'unlocked'`, and the desktop host opens the doors only then.

What it leaves alone, and what follows:

- **A locked keyring, or none**, fails the start, in words with no path and no secret; "Try again"
  asks again. Without a keyring the agent cannot be made or unlocked here, and making it under a
  passphrase nothing keeps would lose it.
- **An agent made before this, with a WE password**, has no item. It stays locked, and `ready`
  carries `agent: 'locked'`. WE's sign-in unlocks it as before, and the doors stay closed with a
  note until then.
- **Signing out** restarts the executor, which unlocks the agent again: on the desktop, sign-out no
  longer leaves it locked.
- **Windows, or a build with no `we-custody`**: identity is off and nothing is made; WE's own create
  and sign-in make and unlock the agent, as they always did.

This is a stopgap. Slice 3's AR-06 replaces it: the executor's storage is unlocked by a secret of its
own (`storage.unlock`), and `mainAgent.js`, the keyring item and `wallet-passphrase` go.
`electron/mainAgent.test.js` and `main.main-agent.test.js` cover it.

## Embedding External Apps

This launcher can embed external apps (like Flux) via iframe. The embedded apps receive AD4M credentials through a postMessage protocol.

**See:** [`embedding-external-apps.md`](../../docs/guides/embedding-external-apps.md) for the generic integration pattern.

### Electron-Specific Considerations

**Screen Sharing:** Electron requires a polyfill for `getDisplayMedia()` to work in iframes:

- The polyfill is injected into embedded apps' HTML at runtime
- Uses Electron's `desktopCapturer` API under the hood
- Requires `webSecurity: false` to allow iframe access to parent's Electron API
- See `electron/main.js` for implementation details

**HTTP Servers:** In production, both the launcher and embedded apps are served via Express:

- Launcher: `http://localhost:9080`
- Embedded apps (e.g., Flux): `http://localhost:8080`
- This avoids cross-origin issues between iframe and parent

## Prerequisites

The Electron app requires the AD4M executor binary to be built. Build it from the ad4m repo:

```bash
cd ../../ad4m/cli
cargo build --release
```

This will create the `ad4m-executor` binary at `ad4m/cli/target/release/ad4m-executor`.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for setup instructions and optional Flux integration example.
