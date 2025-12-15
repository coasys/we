# WE Electron App

Electron desktop application for the WE platform.

## Prerequisites

The Electron app requires the AD4M executor binary to be built. Build it from the ad4m repo:

```bash
cd ../../ad4m/cli
cargo build --release
```

This will create the `ad4m-executor` binary at `ad4m/cli/target/release/ad4m-executor`.

## Development

To run in development mode:

```bash
pnpm electron:dev
```

This will:

1. Start the Vite dev server on port 3002
2. Wait for the dev server to be ready
3. Launch Electron which will:
   - Start the AD4M executor on a free port (12000-13000)
   - Generate a unique credential token
   - Load the Vite dev server in the Electron window

## Building

To build for production:

```bash
pnpm electron:build
```

This will:

1. Build the renderer with Vite
2. Package the app with Electron Builder (including the executor binary)

## Architecture

This app uses the `@we/app-framework` package with an Electron-specific platform adapter:

- **Main Process** (`electron/main.js`):
  - Starts the AD4M executor as a child process
  - Handles IPC for AD4M connection details (port/token)
  - Manages window creation and lifecycle
- **Preload Script** (`electron/preload.js`): Exposes secure IPC bridge via `window.electron`
- **Renderer** (`src/`): SolidJS app using the shared `@we/app-framework`
- **Platform Adapter** (`src/platform/electronAdapter.ts`): Implements AD4M connection using Electron IPC

## How it Works

Unlike the Tauri app which embeds the Rust executor as a library, the Electron app:

1. Spawns the `ad4m-executor` binary as a separate child process
2. Passes configuration via command-line arguments (port, token, data path)
3. Communicates with the frontend via IPC to provide connection details
4. The renderer uses these details to connect to the executor's GraphQL API
