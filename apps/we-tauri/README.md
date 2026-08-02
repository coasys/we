# WE Tauri App

Tauri desktop application for the WE platform. This launcher uses the `@we/app-shell` package to provide a cross-platform AD4M-powered interface, with Tauri-specific platform adapters.

## What This App Does

The WE Tauri launcher:

- Embeds the AD4M executor as a Rust library (not a separate process)
- Provides a SolidJS-based interface using `@we/app-shell`
- Supports embedding external apps via iframe (e.g., Flux, custom apps)
- Handles platform-specific concerns like native IPC and resource bundling

## Architecture

- **Rust Backend** (`src-tauri/`):
  - Embeds `ad4m-rust-executor` as a library
  - Exposes Tauri commands for AD4M connection details
  - Handles resource bundling for embedded apps
- **Frontend** (`src/`): SolidJS app using the shared `@we/app-shell`
- **Platform Adapter** (`src/platform/tauriAdapter.ts`): Implements AD4M connection using Tauri commands

## How it Works

Unlike the Electron app which spawns the executor as a child process, the Tauri app:

1. Embeds the AD4M executor as a Rust library directly in the binary
2. Starts the executor on app initialization
3. Exposes connection details (port, token) via Tauri commands
4. The frontend calls these commands to get credentials and connect

## Embedding External Apps

This launcher can embed external apps (like Flux) via iframe. The embedded apps receive AD4M credentials through a postMessage protocol.

**See:** [`../EMBEDDING.md`](../EMBEDDING.md) for the generic integration pattern.

### Tauri-Specific Considerations

**Screen Sharing:** Works natively in Tauri - no polyfill required (unlike Electron).

**Resource Bundling:** Embedded apps are bundled into the Tauri app at build time:

- Configured in `src-tauri/tauri.conf.json` under `resources`
- Served via custom protocol or HTTP in development
- See `DEVELOPMENT.md` for setup details

## Prerequisites

Requires the AD4M Rust libraries from the ad4m monorepo:

- `ad4m/rust-client`
- `ad4m/rust-executor`

Paths are configured in `src-tauri/Cargo.toml`. Ensure the AD4M repo is cloned as a sibling directory (see DEVELOPMENT.md for details).

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for setup instructions and optional Flux integration example.
