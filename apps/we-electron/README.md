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
- **Renderer** (`src/`): SolidJS app using the shared `@we/app-shell`
- **Platform Adapter** (`src/platform/electronAdapter.ts`): Implements AD4M connection using Electron IPC

## How it Works

Unlike the Tauri app which embeds the Rust executor as a library, the Electron app:

1. Spawns the `ad4m-executor` binary as a separate child process
2. Passes configuration via command-line arguments (port, token, data path)
3. Communicates with the frontend via IPC to provide connection details
4. The renderer uses these details to connect to the executor's GraphQL API

## Embedding External Apps

This launcher can embed external apps (like Flux) via iframe. The embedded apps receive AD4M credentials through a postMessage protocol.

**See:** [`EMBEDDING.md`](../EMBEDDING.md) for the generic integration pattern.

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
